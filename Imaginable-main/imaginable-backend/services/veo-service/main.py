"""
Treehouse Generative Episode Engine

This service generates multi-scene videos using Veo, applies global voice and
style constraints, stitches scenes into a single episode, and returns signed URLs.

Architecture:
- Scene-level visual prompts + dialogue
- Global voice style policy
- Global negative prompt policy
- Veo video generation
- GCS storage + signed URLs
- FFmpeg stitching
"""

import os
import time
import base64
import tempfile
import subprocess
import uuid
import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from google.genai.types import VideoGenerationReferenceImage
from google.cloud import storage

import websockets
import asyncio

logger = logging.getLogger(__name__)

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger.setLevel(logging.INFO)


# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "toonlabs")
LOCATION = os.environ.get("GOOGLE_CLOUD_REGION", "us-central1")
BUCKET_NAME = os.environ.get("VEO_BUCKET", "veo-video-gen-interactive-episodes")
VIDEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-generate-preview")  # Supports asset reference images

# Scene count requirement for "Create Your Own Experience" flow
# Set to 0 to allow any positive number of scenes
REQUIRE_SCENE_COUNT = int(os.environ.get("REQUIRE_SCENE_COUNT", "0"))

# Global negative prompt (engine policy)
DEFAULT_NEGATIVE_PROMPT = (
    "logos, watermarks, text overlays, harsh tone, deep voice, scary mood, "
    "realistic humans, violence, dark lighting, horror, adult themes"
)

# Global voice style prompt (engine policy)
GLOBAL_VOICE_PROMPT = (
    "Use a cartoon-style male voice that is friendly, warm, and expressive. "
    "Use SAME VOICE across all scenes."
    "Tone should be light, energetic, and natural with clear articulation. "
    "Avoid deep, harsh, monotone, robotic, or overly dramatic delivery."
)

# Global animation / rendering style prompt (engine policy)
GLOBAL_STYLE_PROMPT = (
    "High-quality 3D animated cartoon style with vibrant color palette and bright lighting. "
    "Expressive character acting and clear facial expressions. "
    "Smooth, lively motion and clean composition with gentle depth of field. "
    "\n\n"
    "CRITICAL CHARACTER CONSISTENCY REQUIREMENTS:\n"
    "- The main character MUST match the provided reference image EXACTLY across ALL scenes\n"
    "- NO redesign, reinterpretation, or variation of the character\n"
    "- Keep IDENTICAL: face shape, eyes, mouth, fur/skin tone, markings, outfit, accessories, proportions, and style\n"
    "- The character should look like the SAME individual in every scene with NO random changes\n"
    "- Maintain exact facial features, clothing, and color palette from the reference image\n"
    "- Character appearance must be perfectly consistent from scene to scene\n"
    "\n"
    "Add light, upbeat instrumental background music at a low volume under the dialogue."
)


# ------------------------------------------------------------------------------
# FastAPI App
# ------------------------------------------------------------------------------

app = FastAPI(title="Generative Interaction Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# Voice Reasoning Agent WebSocket Route
# ------------------------------------------------------------------------------

@app.websocket("/ws/voice-agent/{session_id}")
async def voice_agent_endpoint(websocket: WebSocket, session_id: str) -> None:
    """WebSocket proxy to standalone voice agent service."""
    await websocket.accept()
    
    voice_agent_url = os.getenv("VOICE_AGENT_URL", "ws://localhost:8002/ws/voice-agent")
    voice_agent_ws_url = f"{voice_agent_url}/{session_id}"
    
    logger.info(f"[Voice Agent Proxy] Connecting to {voice_agent_ws_url}")
    
    try:
        async with websockets.connect(voice_agent_ws_url) as voice_ws:
            # Bidirectional proxy
            async def forward_to_voice():
                try:
                    while True:
                        message = await websocket.receive()
                        if "text" in message:
                            await voice_ws.send(message["text"])
                        elif "bytes" in message:
                            await voice_ws.send(message["bytes"])
                except Exception as e:
                    logger.error(f"[Voice Agent Proxy] Error forwarding to voice service: {e}")
            
            async def forward_from_voice():
                try:
                    async for message in voice_ws:
                        await websocket.send_text(message)
                except Exception as e:
                    logger.error(f"[Voice Agent Proxy] Error forwarding from voice service: {e}")
            
            await asyncio.gather(
                forward_to_voice(),
                forward_from_voice(),
                return_exceptions=True
            )
    except Exception as e:
        logger.error(f"[Voice Agent Proxy] Connection error: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass


# ------------------------------------------------------------------------------
# Data Models
# ------------------------------------------------------------------------------

class Scene(BaseModel):
    """Represents a single video scene."""
    prompt: str
    dialogue: Optional[str] = None
    frame_image_base64: Optional[str] = None
    # Whether this scene should have an interaction checkpoint + feedback clips
    interaction: Optional[bool] = False
    # Optional structured interaction fields (only used when interaction=True)
    task: Optional[str] = None  # Clear description of what the learner should do
    expected_response: Optional[str] = None  # What constitutes a correct response
    interaction_mode: Optional[str] = "both"  # "draw_only" or "both" - controls which interaction methods are available


class GenerateEpisodeRequest(BaseModel):
    """Request payload for generating an episode."""
    scenes: List[Scene]
    duration_seconds: int = 8
    aspect_ratio: str = "16:9"
    generate_audio: bool = True
    style_reference_image_base64: Optional[str] = None  # Global style reference for all scenes


class SceneFeedbackUrls(BaseModel):
    """Signed URLs for per-scene feedback branches."""
    correct_url: str
    incorrect_url: str


class SceneMetadata(BaseModel):
    """Metadata for a scene."""
    scene_number: int
    interaction: bool
    dialogue: Optional[str] = None
    task: Optional[str] = None
    expected_response: Optional[str] = None
    interaction_mode: Optional[str] = "both"


class GenerateEpisodeResponse(BaseModel):
    """Response payload containing signed URLs."""
    stitched_video_url: str
    scene_video_urls: List[str]
    # One entry per scene; non-interactive scenes will have null feedback.
    scene_feedback_urls: List[Optional[SceneFeedbackUrls]]
    # One entry per scene; non-interactive scenes will typically be null.
    scene_idle_urls: List[Optional[str]]
    # Metadata for each scene including interaction_mode
    scene_metadata: List[SceneMetadata]


# ------------------------------------------------------------------------------
# Utility Functions
# ------------------------------------------------------------------------------

def get_signed_url(bucket_name: str, blob_name: str, expires_seconds: int = 3600) -> str:
    """Generates a signed URL for a GCS object using service account credentials."""
    from google.oauth2 import service_account
    from datetime import timedelta
    
    # Use service account credentials for signing
    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if credentials_path and os.path.exists(credentials_path):
        credentials = service_account.Credentials.from_service_account_file(credentials_path)
        client = storage.Client(project=PROJECT_ID, credentials=credentials)
    else:
        # Fallback to default credentials (won't work for signing)
        client = storage.Client(project=PROJECT_ID)
    
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expires_seconds),
        method="GET",
    )


def check_gcs_blob_exists(bucket_name: str, blob_name: str) -> bool:
    """Check if a GCS blob exists."""
    client = storage.Client(project=PROJECT_ID)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    return blob.exists()


def build_prompt(scene_prompt: str, dialogue: Optional[str]) -> str:
    """
    Composes the final Veo prompt by combining:
    - scene visual description
    - global animation style rules
    - dialogue (if present)
    - global voice style rules
    """
    parts = [scene_prompt]

    # Global visual/animation style
    parts.append(f"Global style rules: {GLOBAL_STYLE_PROMPT}")

    if dialogue:
        parts.append(f'Spoken dialogue: "{dialogue}"')

    # Global voice delivery style
    parts.append(f"Voice style rules: {GLOBAL_VOICE_PROMPT}")

    return "\n".join(parts)



def gcs_object_name_from_uri(gcs_uri: str) -> str:
    """Extracts the object name from a gs:// URI or signed HTTPS URL for this bucket."""
    # Handle gs:// URIs
    gs_prefix = f"gs://{BUCKET_NAME}/"
    if gcs_uri.startswith(gs_prefix):
        return gcs_uri[len(gs_prefix):]
    
    # Handle signed HTTPS URLs (e.g., from Veo service)
    https_prefix = f"https://storage.googleapis.com/{BUCKET_NAME}/"
    if gcs_uri.startswith(https_prefix):
        # Extract path before query parameters
        path_with_query = gcs_uri[len(https_prefix):]
        # Remove query parameters (everything after ?)
        path = path_with_query.split('?')[0]
        return path
    
    raise ValueError(f"Unexpected GCS URI format (expected gs:// or https://storage.googleapis.com/): {gcs_uri[:100]}")


def download_gcs_file(gcs_uri: str, local_path: str) -> None:
    """Downloads a file from GCS to a local path."""
    client = storage.Client(project=PROJECT_ID)
    bucket_name, blob_path = gcs_uri.replace("gs://", "").split("/", 1)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(local_path)


def upload_to_gcs(local_path: str, object_name: str) -> str:
    """Uploads a local file to GCS and returns its URI."""
    client = storage.Client(project=PROJECT_ID)
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(object_name)
    blob.upload_from_filename(local_path)
    return f"gs://{BUCKET_NAME}/{object_name}"


def stitch_videos(video_paths: List[str], output_path: str) -> None:
    """Stitches multiple videos into a single output using ffmpeg."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        concat_file = f.name
        for path in video_paths:
            f.write(f"file '{path}'\n")

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file,
        "-c", "copy",
        output_path,
    ]
    subprocess.run(cmd, check=True)
    os.remove(concat_file)


def extract_last_frame(video_path: str, output_png_path: str) -> None:
    """Extracts a frame from near the end of a video using ffmpeg."""
    cmd = [
        "ffmpeg",
        "-y",
        "-sseof",
        "-0.15",  # ~150ms before the end
        "-i",
        video_path,
        "-vframes",
        "1",
        "-q:v",
        "2",
        output_png_path,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ------------------------------------------------------------------------------
# Generate Episode API Endpoint
# ------------------------------------------------------------------------------

@app.post("/generate-episode", response_model=GenerateEpisodeResponse)
async def generate_episode(req: GenerateEpisodeRequest) -> Dict[str, Any]:
    """
    Generates a multi-scene episode using Veo, stitches scenes together,
    and returns signed URLs for playback.
    """
    print(f"[VEO SERVICE] Received generate-episode request with {len(req.scenes)} scenes")
    logger.info(f"[VEO SERVICE] Starting episode generation for {len(req.scenes)} scenes")

    if REQUIRE_SCENE_COUNT > 0 and len(req.scenes) != REQUIRE_SCENE_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Exactly {REQUIRE_SCENE_COUNT} scenes are required.",
        )

    if len(req.scenes) <= 0:
        raise HTTPException(status_code=400, detail="At least 1 scene is required.")

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

    episode_id = f"ep_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    scene_gcs_uris: List[str] = []
    local_video_files: List[str] = []
    # Preallocate feedback + idle lists so indices align with scenes;
    # non-interactive scenes remain None.
    scene_feedback_signed_urls: List[Optional[SceneFeedbackUrls]] = [None] * len(req.scenes)
    scene_idle_signed_urls: List[Optional[str]] = [None] * len(req.scenes)
    scene_metadata_list: List[SceneMetadata] = []

    # Process global asset reference image if provided (Veo 3.1 compatible)
    # Asset images preserve character/subject appearance and infer style
    asset_reference_config = None
    temp_asset_ref_path = None
    if req.style_reference_image_base64:
        print("[ASSET REFERENCE] Processing global character reference image")
        asset_ref_bytes = base64.b64decode(req.style_reference_image_base64)
        fd, temp_asset_ref_path = tempfile.mkstemp(suffix="_asset_ref.png")
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(asset_ref_bytes)
        
        # Create VideoGenerationReferenceImage with asset type (Veo 3.1 compatible)
        asset_reference_config = VideoGenerationReferenceImage(
            image=types.Image.from_file(location=temp_asset_ref_path),
            reference_type="asset"  # Asset type preserves character appearance
        )
        print(f"[ASSET REFERENCE] Loaded character reference from: {temp_asset_ref_path}")
        print("[ASSET REFERENCE] Using asset type - compatible with Veo 3.1")

    # --------------------------------------------------------------------------
    # Generate individual scene videos
    # --------------------------------------------------------------------------

    for idx, scene in enumerate(req.scenes):
        print(f"[VEO SERVICE] Processing scene {idx+1}/{len(req.scenes)}")
        logger.info(f"[VEO SERVICE] Starting scene {idx+1}/{len(req.scenes)}")
        
        image_part = None
        temp_image_path = None

        # Optional frame conditioning
        if scene.frame_image_base64:
            image_bytes = base64.b64decode(scene.frame_image_base64)
            fd, temp_image_path = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(image_bytes)
            image_part = types.Image.from_file(location=temp_image_path)

        final_prompt = build_prompt(scene.prompt, scene.dialogue)

        # Build config with optional asset reference
        config_params = {
            "aspect_ratio": req.aspect_ratio,
            "number_of_videos": 1,
            "duration_seconds": req.duration_seconds,
            "generate_audio": req.generate_audio,
            "negative_prompt": DEFAULT_NEGATIVE_PROMPT,
            "output_gcs_uri": f"gs://{BUCKET_NAME}/episodes/{episode_id}/scenes/",
        }
        
        # Add asset reference if provided (preserves character appearance)
        if asset_reference_config:
            config_params["reference_images"] = [asset_reference_config]
        
        print(f"[VEO SERVICE] Calling Veo API for scene {idx+1}...")
        logger.info(f"[VEO SERVICE] Calling Veo API for scene {idx+1}")
        
        operation = client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=final_prompt,
            image=image_part,
            config=types.GenerateVideosConfig(**config_params),
        )

        print(f"[VEO SERVICE] Veo operation started for scene {idx+1}, polling for completion...")
        logger.info(f"[VEO SERVICE] Operation ID: {operation.name}")
        
        # Poll until completion
        poll_count = 0
        while not operation.done:
            time.sleep(8)
            poll_count += 1
            if poll_count % 10 == 0:  # Log every 80 seconds
                print(f"[VEO SERVICE] Still waiting for scene {idx+1}... ({poll_count * 8}s elapsed)")
                logger.info(f"[VEO SERVICE] Still polling scene {idx+1}, elapsed: {poll_count * 8}s")
            operation = client.operations.get(operation)

        print(f"[VEO SERVICE] Scene {idx+1} operation completed, checking result...")
        logger.info(f"[VEO SERVICE] Operation done: {operation.done}, has result: {operation.result is not None}")
        
        if not operation.result:
            error_msg = f"Scene {idx+1}: Operation completed but has no result"
            if hasattr(operation, 'error') and operation.error:
                error_msg += f" - Error: {operation.error}"
            print(f"[VEO SERVICE ERROR] {error_msg}")
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        
        if not operation.result.generated_videos:
            error_msg = f"Scene {idx+1}: Operation result has no generated_videos"
            print(f"[VEO SERVICE ERROR] {error_msg}")
            print(f"[VEO SERVICE ERROR] Operation result: {operation.result}")
            logger.error(f"{error_msg} - Result: {operation.result}")
            raise HTTPException(status_code=500, detail=error_msg)

        scene_video_uri = operation.result.generated_videos[0].video.uri
        print(f"[VEO SERVICE] Scene {idx+1} completed! URI: {scene_video_uri}")
        logger.info(f"[VEO SERVICE] Scene {idx+1} generated successfully: {scene_video_uri}")
        scene_gcs_uris.append(scene_video_uri)

        # Download locally for stitching
        print(f"[VEO SERVICE] Downloading scene {idx+1} from GCS...")
        local_scene_path = tempfile.mktemp(suffix=f"_scene_{idx}.mp4")
        download_gcs_file(scene_video_uri, local_scene_path)
        local_video_files.append(local_scene_path)
        print(f"[VEO SERVICE] Scene {idx+1} downloaded to {local_scene_path}")

        if temp_image_path and os.path.exists(temp_image_path):
            os.remove(temp_image_path)

        # ------------------------------------------------------------------
        # Feedback + idle clip generation per scene (only for interactive)
        # ------------------------------------------------------------------

        # Always generate feedback clips for interactive scenes, regardless of SKIP_FEEDBACK_CLIPS
        # This ensures the voice agent tool calling works properly
        if scene.interaction:
            print(f"[GENERATING] Scene {idx} has interaction=True, generating feedback clips and idle scene")
            
            # Define GCS output paths for feedback and idle clips
            feedback_prefix = f"gs://{BUCKET_NAME}/episodes/{episode_id}/scene_{idx:02d}/feedback/"
            idle_prefix = f"gs://{BUCKET_NAME}/episodes/{episode_id}/scene_{idx:02d}/idle/"
            
            # Extract a representative frame near the end of the scene
            last_frame_path = tempfile.mktemp(suffix=f"_scene_{idx}_last.png")
            extract_last_frame(local_scene_path, last_frame_path)

            feedback_global_rules = (
                "Create a short reaction clip that continues seamlessly from the provided reference frame. "
                "The character should deliver feedback naturally and clearly. "
                "Use facial expressions, body language, and simple sound effects to convey emotion. "
                "Keep the same character design, camera framing, and lighting as the reference frame. "
                "\n\n"
                "CRITICAL VOICE REQUIREMENTS - MUST FOLLOW EXACTLY:\n"
                "- Voice MUST be the EXACT SAME voice as the main scene\n"
                "- Voice quality: FRIENDLY, CHEERFUL, WARM, and INVITING\n"
                "- Voice clarity: CLEAR, SMOOTH, CLEAN audio - NO raspy quality, NO distortion, NO weird artifacts\n"
                "- Voice tone: NATURAL speaking voice - NO singing, NO musical delivery, NO pitch variations\n"
                "- Voice consistency: The SAME character narrator voice across ALL clips - main scene, correct feedback, incorrect feedback\n"
                "- Audio production: High-quality, professional children's narrator voice - like a friendly teacher or storyteller\n"
                "- NO robotic quality, NO mechanical sound, NO voice effects, NO filters\n"
                "- The voice should sound like ONE consistent, friendly character throughout the entire episode"
            )

            feedback_correct_prompt = (
                f"{feedback_global_rules}\n\n"
                "Emotion: joyful + proud. \n"
                "Spoken line: 'Awesome job! You got that spot on!' \n"
                "VOICE QUALITY: MUST use the EXACT SAME friendly, cheerful, smooth, clear narrator voice from the main scene. \n"
                "- Voice should be warm and encouraging but NOT overly excited or strained\n"
                "- NO raspy quality, NO distortion, NO weird vocal effects\n"
                "- Clean, professional children's narrator voice - friendly and natural\n"
                "- NO singing tone, NO musical delivery, just natural cheerful speaking\n"
                "Action during the line: big smile, bright eyes, subtle celebratory gesture (small fist pump or nod). \n"
                "Audio: light upbeat success sound effect (e.g., sparkle/chime) under the expressions, no more talking."
            )

            feedback_incorrect_prompt = (
                f"{feedback_global_rules}\n\n"
                "Emotion: gentle disappointment but encouraging. \n"
                "Spoken line: 'Oh no, that's not right. Maybe you should try again!' \n"
                "VOICE QUALITY: MUST use the EXACT SAME friendly, cheerful, smooth, clear narrator voice from the main scene. \n"
                "- Voice should be gentle and supportive, NOT harsh or critical\n"
                "- NO raspy quality, NO distortion, NO weird vocal effects\n"
                "- Clean, professional children's narrator voice - kind and reassuring\n"
                "- NO singing tone, NO musical delivery, just natural gentle speaking\n"
                "- Maintain the SAME voice character as the main scene and correct feedback\n"
                "Action during the line: concerned face, small head tilt, soft sigh, then reassuring smile at the end. \n"
                "Audio: soft 'oops' style sound effect under the expressions, no more talking."
            )

            feedback_negative_append = (
                "speech, talking, narration, words, mouth movements forming words, subtitles, captions, text overlays"
            )

            def generate_feedback_clip(*, reference_image_path: str, prompt: str) -> str:
                image_part_feedback = types.Image.from_file(location=reference_image_path)

                op = client.models.generate_videos(
                    model=VIDEO_MODEL,
                    prompt=prompt,
                    image=image_part_feedback,
                    config=types.GenerateVideosConfig(
                        aspect_ratio=req.aspect_ratio,
                        number_of_videos=1,
                        duration_seconds=4,
                        generate_audio=True,
                        negative_prompt=f"{DEFAULT_NEGATIVE_PROMPT}, {feedback_negative_append}",
                        output_gcs_uri=feedback_prefix,
                    ),
                )

                while not op.done:
                    time.sleep(8)
                    op = client.operations.get(op)

                if not op.result or not op.result.generated_videos:
                    raise HTTPException(status_code=500, detail="Veo failed to generate a feedback clip.")

                return op.result.generated_videos[0].video.uri

            def generate_idle_clip(*, reference_image_path: str) -> str:
                """Generate a short, loopable idle clip with no dialogue, just subtle motion."""
                image_part_idle = types.Image.from_file(location=reference_image_path)

                idle_prompt = (
                    "Create a very short looping idle animation that continues seamlessly from the provided reference frame. "
                    "The character should NOT speak any words and should not make any explicit vocal sounds or exclamations. "
                    "There must be no visible mouth movements that look like speech and no captions or text. "
                    "Show subtle idle motions only: gentle breathing, small head and body shifts, occasional blink or soft smile, tiny weight shifts. "
                    "Keep the same character design, camera framing, lighting, and color style as the reference frame. The camera must remain completely static with NO camera movement, pans, zooms, or cuts. "
                    "There should be no background music or sound effects; the clip should be completely silent except for the visual motion. "
                    "The scene should feel like the character is silently and patiently waiting for the viewer's response."
                )

                idle_negative_append = (
                    "speech, talking, narration, dialogue, words, mouth movements forming words, subtitles, captions, text overlays"
                )

                op_idle = client.models.generate_videos(
                    model=VIDEO_MODEL,
                    prompt=idle_prompt,
                    image=image_part_idle,
                    config=types.GenerateVideosConfig(
                        aspect_ratio=req.aspect_ratio,
                        number_of_videos=1,
                        # Shorter 4-second loop for idle animation
                        duration_seconds=4,
                        # No audio for idle clips; character should appear in complete silence
                        generate_audio=False,
                        negative_prompt=f"{DEFAULT_NEGATIVE_PROMPT}, {idle_negative_append}",
                        output_gcs_uri=idle_prefix,
                    ),
                )

                while not op_idle.done:
                    time.sleep(8)
                    op_idle = client.operations.get(op_idle)

                if not op_idle.result or not op_idle.result.generated_videos:
                    raise HTTPException(status_code=500, detail="Veo failed to generate an idle loop clip.")

                return op_idle.result.generated_videos[0].video.uri

            # Generate all feedback clips for interactive scenes
            correct_uri = generate_feedback_clip(
                reference_image_path=last_frame_path,
                prompt=feedback_correct_prompt,
            )
            logger.info(f"[FEEDBACK] Generated CORRECT feedback clip: {correct_uri}")

            incorrect_uri = generate_feedback_clip(
                reference_image_path=last_frame_path,
                prompt=feedback_incorrect_prompt,
            )
            logger.info(f"[FEEDBACK] Generated INCORRECT feedback clip: {incorrect_uri}")

            idle_uri = generate_idle_clip(reference_image_path=last_frame_path)
            logger.info(f"[FEEDBACK] Generated IDLE clip: {idle_uri}")

            if os.path.exists(last_frame_path):
                os.remove(last_frame_path)

            correct_obj = gcs_object_name_from_uri(correct_uri)
            incorrect_obj = gcs_object_name_from_uri(incorrect_uri)
            idle_obj = gcs_object_name_from_uri(idle_uri)

            scene_feedback_signed_urls[idx] = SceneFeedbackUrls(
                correct_url=get_signed_url(BUCKET_NAME, correct_obj),
                incorrect_url=get_signed_url(BUCKET_NAME, incorrect_obj),
            )

            scene_idle_signed_urls[idx] = get_signed_url(BUCKET_NAME, idle_obj)

    # --------------------------------------------------------------------------
    # Stitch scenes into a single episode
    # --------------------------------------------------------------------------

    stitched_local_path = tempfile.mktemp(suffix="_episode.mp4")
    stitch_videos(local_video_files, stitched_local_path)

    stitched_object_name = f"episodes/{episode_id}/episode.mp4"
    upload_to_gcs(stitched_local_path, stitched_object_name)

    stitched_signed_url = get_signed_url(BUCKET_NAME, stitched_object_name)

    # Signed URLs for individual scenes
    signed_scene_urls: List[str] = []
    for uri in scene_gcs_uris:
        signed_scene_urls.append(get_signed_url(BUCKET_NAME, gcs_object_name_from_uri(uri)))

    # Cleanup temporary asset reference image
    if temp_asset_ref_path and os.path.exists(temp_asset_ref_path):
        os.remove(temp_asset_ref_path)
        print("[ASSET REFERENCE] Cleaned up temporary asset reference file")

    # Build scene metadata list
    for idx, scene in enumerate(req.scenes):
        scene_metadata_list.append(SceneMetadata(
            scene_number=idx + 1,
            interaction=scene.interaction or False,
            dialogue=scene.dialogue,
            task=scene.task if scene.interaction else None,
            expected_response=scene.expected_response if scene.interaction else None,
            interaction_mode=scene.interaction_mode if scene.interaction else None,
        ))

    return {
        "stitched_video_url": stitched_signed_url,
        "scene_video_urls": signed_scene_urls,
        "scene_feedback_urls": [
            x.model_dump() if isinstance(x, SceneFeedbackUrls) else None
            for x in scene_feedback_signed_urls
        ],
        "scene_idle_urls": scene_idle_signed_urls,
        "scene_metadata": [meta.model_dump() for meta in scene_metadata_list],
    }
