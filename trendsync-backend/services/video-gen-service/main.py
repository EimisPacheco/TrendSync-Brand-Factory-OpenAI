"""
TrendSync Video Generation Service
Generates product advertisement videos using Veo 3.1.
Follows the same pattern as Imaginable's veo-service/main.py.
Port 8001.
"""

import os
import time
import base64
import tempfile
import subprocess
import uuid
import logging
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
except Exception:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from google.genai.types import VideoGenerationReferenceImage
from google.cloud import storage

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_REGION", "us-central1")
BUCKET_NAME = os.environ.get("GCS_BUCKET", "trendsync-brand-factory-media")
VIDEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-generate-preview")

DEFAULT_NEGATIVE_PROMPT = (
    "logos, watermarks, text overlays, low quality, blurry, "
    "distorted, ugly, deformed, noisy, grainy"
)

GLOBAL_STYLE_PROMPT = (
    "High-quality 3D product visualization with cinematic lighting. "
    "Professional commercial video quality. Clean, polished aesthetic. "
    "Smooth camera movement. Accurate color reproduction. "
    "Product must match the provided reference image EXACTLY across ALL scenes. "
    "Maintain identical product appearance, colors, materials, and proportions."
)

GLOBAL_VOICE_PROMPT = (
    "Use a professional, confident narrator voice. "
    "Tone: sophisticated, modern, aspirational. "
    "Clear articulation, smooth delivery. "
    "Consistent voice across all scenes."
)

# --------------------------------------------------------------------------
# FastAPI
# --------------------------------------------------------------------------

app = FastAPI(title="TrendSync Video Generation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

class AdScene(BaseModel):
    prompt: str
    dialogue: Optional[str] = None
    interaction: Optional[bool] = False


class GenerateAdRequest(BaseModel):
    scenes: List[AdScene]
    duration_seconds: int = 8
    aspect_ratio: str = "16:9"
    generate_audio: bool = True
    style_reference_image_base64: Optional[str] = None


class GenerateAdResponse(BaseModel):
    stitched_video_url: Optional[str] = None
    stitched_video_base64: Optional[str] = None
    scene_video_urls: List[str] = []


# --------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------

def get_public_url(bucket_name: str, blob_name: str) -> str:
    """Return a public HTTPS URL for the blob (bucket must allow public reads)."""
    return f"https://storage.googleapis.com/{bucket_name}/{blob_name}"


def gcs_object_name_from_uri(gcs_uri: str) -> str:
    gs_prefix = f"gs://{BUCKET_NAME}/"
    if gcs_uri.startswith(gs_prefix):
        return gcs_uri[len(gs_prefix):]
    https_prefix = f"https://storage.googleapis.com/{BUCKET_NAME}/"
    if gcs_uri.startswith(https_prefix):
        return gcs_uri[len(https_prefix):].split("?")[0]
    raise ValueError(f"Unexpected GCS URI format: {gcs_uri[:100]}")


def download_gcs_file(gcs_uri: str, local_path: str) -> None:
    client = storage.Client(project=PROJECT_ID)
    bucket_name, blob_path = gcs_uri.replace("gs://", "").split("/", 1)
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(local_path)


def upload_to_gcs(local_path: str, object_name: str) -> str:
    client = storage.Client(project=PROJECT_ID)
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(object_name)
    blob.upload_from_filename(local_path)
    return f"gs://{BUCKET_NAME}/{object_name}"


import shutil
FFMPEG_PATH = os.environ.get("FFMPEG_PATH", shutil.which("ffmpeg") or "/usr/bin/ffmpeg")


def stitch_videos(video_paths: List[str], output_path: str) -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        concat_file = f.name
        for path in video_paths:
            f.write(f"file '{path}'\n")

    cmd = [
        FFMPEG_PATH, "-y", "-f", "concat", "-safe", "0",
        "-i", concat_file, "-c", "copy", output_path,
    ]
    subprocess.run(cmd, check=True)
    os.remove(concat_file)


def build_prompt(scene_prompt: str, dialogue: Optional[str]) -> str:
    parts = [scene_prompt, f"Global style: {GLOBAL_STYLE_PROMPT}"]
    if dialogue:
        parts.append(f'Spoken voiceover: "{dialogue}"')
        parts.append(f"Voice style: {GLOBAL_VOICE_PROMPT}")
    return "\n".join(parts)


# --------------------------------------------------------------------------
# Generate Ad Endpoint
# --------------------------------------------------------------------------

@app.post("/generate-ad", response_model=GenerateAdResponse)
async def generate_ad(req: GenerateAdRequest) -> Dict[str, Any]:
    """Generate a multi-scene advertisement video using Veo 3.1."""

    logger.info(f"[VEO] Generating ad with {len(req.scenes)} scenes")

    if len(req.scenes) <= 0:
        raise HTTPException(status_code=400, detail="At least 1 scene required.")

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    ad_id = f"ad_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    scene_gcs_uris: List[str] = []
    local_video_files: List[str] = []

    # Asset reference (product image)
    asset_reference_config = None
    temp_asset_path = None
    if req.style_reference_image_base64:
        asset_bytes = base64.b64decode(req.style_reference_image_base64)
        fd, temp_asset_path = tempfile.mkstemp(suffix="_asset.png")
        with os.fdopen(fd, "wb") as tmp:
            tmp.write(asset_bytes)
        asset_reference_config = VideoGenerationReferenceImage(
            image=types.Image.from_file(location=temp_asset_path),
            reference_type="asset",
        )
        logger.info("[VEO] Loaded product reference image as asset")

    # Generate each scene
    for idx, scene in enumerate(req.scenes):
        logger.info(f"[VEO] Processing scene {idx + 1}/{len(req.scenes)}")
        final_prompt = build_prompt(scene.prompt, scene.dialogue)

        config_params = {
            "aspect_ratio": req.aspect_ratio,
            "number_of_videos": 1,
            "duration_seconds": req.duration_seconds,
            "generate_audio": req.generate_audio,
            "negative_prompt": DEFAULT_NEGATIVE_PROMPT,
        }

        if asset_reference_config:
            config_params["reference_images"] = [asset_reference_config]

        operation = client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=final_prompt,
            config=types.GenerateVideosConfig(**config_params),
        )

        # Poll
        max_polls = 60  # 8 min max per scene
        for poll_count in range(max_polls):
            time.sleep(8)
            operation = client.operations.get(operation)
            if operation.done:
                break
            logger.info(f"[VEO] Scene {idx + 1} still generating... (poll {poll_count + 1})")

        if not operation.done:
            logger.error(f"[VEO] Scene {idx + 1} timed out after {max_polls * 8}s")
            raise HTTPException(status_code=500, detail=f"Scene {idx + 1}: Veo timed out")

        # Log full operation for debugging
        logger.info(f"[VEO] Scene {idx + 1} operation done. Has result: {operation.result is not None}")
        if operation.result:
            logger.info(f"[VEO] Scene {idx + 1} generated_videos count: {len(operation.result.generated_videos) if operation.result.generated_videos else 0}")
        if hasattr(operation, 'error') and operation.error:
            logger.error(f"[VEO] Scene {idx + 1} operation error: {operation.error}")
        if hasattr(operation, 'metadata') and operation.metadata:
            logger.info(f"[VEO] Scene {idx + 1} metadata: {operation.metadata}")

        if not operation.result or not operation.result.generated_videos:
            # Try to extract useful error info
            error_detail = "Veo returned no video"
            if hasattr(operation, 'error') and operation.error:
                error_detail = f"Veo error: {operation.error}"
            elif operation.result and hasattr(operation.result, 'rai_media_filtered_count'):
                if operation.result.rai_media_filtered_count and operation.result.rai_media_filtered_count > 0:
                    error_detail = "Video was blocked by Veo safety filter (RAI). Try a different prompt."
            logger.error(f"[VEO] Scene {idx + 1}: {error_detail}. Full operation: {operation}")
            raise HTTPException(status_code=500, detail=f"Scene {idx + 1}: {error_detail}")

        video = operation.result.generated_videos[0].video
        logger.info(f"[VEO] Scene {idx + 1} done!")

        # Download video — try GCS URI first, then inline data
        local_path = tempfile.mktemp(suffix=f"_scene_{idx}.mp4")
        if video.uri:
            logger.info(f"[VEO] Downloading scene {idx + 1} from: {video.uri}")
            try:
                download_gcs_file(video.uri, local_path)
            except Exception as e:
                logger.error(f"[VEO] GCS download failed: {e}")
                if hasattr(video, 'video_bytes') and video.video_bytes:
                    with open(local_path, "wb") as f:
                        f.write(video.video_bytes)
                else:
                    raise HTTPException(status_code=500, detail=f"Scene {idx + 1}: Cannot download video")
        elif hasattr(video, 'video_bytes') and video.video_bytes:
            with open(local_path, "wb") as f:
                f.write(video.video_bytes)
        else:
            raise HTTPException(status_code=500, detail=f"Scene {idx + 1}: No video URI or bytes")

        local_video_files.append(local_path)

    # Stitch if multiple scenes, otherwise use single scene
    if len(local_video_files) > 1:
        stitched_path = tempfile.mktemp(suffix="_ad.mp4")
        stitch_videos(local_video_files, stitched_path)
    else:
        stitched_path = local_video_files[0]

    # Try GCS upload, fallback to base64
    stitched_url = None
    stitched_b64 = None
    try:
        stitched_obj = f"ads/{ad_id}/ad.mp4"
        upload_to_gcs(stitched_path, stitched_obj)
        stitched_url = get_public_url(BUCKET_NAME, stitched_obj)
        logger.info(f"[VEO] Uploaded stitched video to GCS")
    except Exception as e:
        logger.warning(f"[VEO] GCS upload failed ({e}), returning base64")
        with open(stitched_path, "rb") as f:
            stitched_b64 = base64.b64encode(f.read()).decode("utf-8")

    # Cleanup
    if temp_asset_path and os.path.exists(temp_asset_path):
        os.remove(temp_asset_path)
    for p in local_video_files:
        if os.path.exists(p):
            os.remove(p)
    if len(local_video_files) > 1 and os.path.exists(stitched_path):
        os.remove(stitched_path)

    return {
        "stitched_video_url": stitched_url,
        "stitched_video_base64": stitched_b64,
        "scene_video_urls": [],
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "video-gen-service", "model": VIDEO_MODEL}
