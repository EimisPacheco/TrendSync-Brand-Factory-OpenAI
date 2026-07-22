"""
TrendSync Video Generation Service
Generates product advertisement videos with OpenAI Sora 2.
Port 8001.
"""

import os
import time
import base64
import io
import tempfile
import subprocess
import uuid
import logging
import shutil
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
except Exception:
    pass

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from google.cloud import storage  # type: ignore
    _GCS_AVAILABLE = True
except Exception:
    storage = None  # type: ignore
    _GCS_AVAILABLE = False

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
BUCKET_NAME = os.environ.get("GCS_BUCKET", "trendsync-brand-factory-media")
# GCS may live in a different GCP project / SA than Vertex.
GCS_PROJECT = os.environ.get("GCS_PROJECT", PROJECT_ID)
GCS_CREDENTIALS_PATH = os.environ.get("GCS_CREDENTIALS")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
SORA_VIDEO_MODEL = os.environ.get("OPENAI_VIDEO_MODEL", "sora-2-pro")
OPENAI_VIDEO_API = "https://api.openai.com/v1/videos"

# Polling config
POLL_INTERVAL_SECONDS = 10
MAX_POLL_SECONDS = 15 * 60  # Sora renders can take several minutes.

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
    # Retained for clients of the old video API. Sora audio is prompt-driven;
    # this value does not alter the Videos API request.
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


def upload_to_gcs(local_path: str, object_name: str) -> str:
    if not _GCS_AVAILABLE:
        raise RuntimeError("google-cloud-storage not installed")
    # Prefer GCS-specific credentials (different SA / project than Vertex).
    creds_path = GCS_CREDENTIALS_PATH or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path and os.path.exists(creds_path):
        from google.oauth2 import service_account
        credentials = service_account.Credentials.from_service_account_file(creds_path)
        client = storage.Client(project=GCS_PROJECT, credentials=credentials)
    else:
        client = storage.Client(project=GCS_PROJECT)
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(object_name)
    blob.upload_from_filename(local_path)
    return f"gs://{BUCKET_NAME}/{object_name}"


FFMPEG_PATH = os.environ.get(
    "FFMPEG_PATH",
    shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg",
)


def stitch_videos(video_paths: List[str], output_path: str) -> None:
    """FFmpeg concat-demuxer stitch (assumes uniform codec/container)."""
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
    parts.append(f"Avoid: {DEFAULT_NEGATIVE_PROMPT}")
    return "\n".join(parts)


def _openai_headers() -> Dict[str, str]:
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY environment variable is not set",
        )
    return {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }


def _sora_size_for_aspect_ratio(aspect_ratio: str) -> str:
    """Return a supported Sora render size for the requested orientation."""
    if aspect_ratio == "9:16":
        return "720x1280"
    if aspect_ratio == "1:1":
        # Sora has no square output. Use a portrait social-video crop for
        # square product photography rather than submitting an invalid size.
        return "720x1280"
    return "1280x720"


def _reference_image_file(image_base64: str, size: str) -> io.BytesIO:
    """Normalize an input reference to the exact Sora output dimensions."""
    try:
        from PIL import Image, ImageOps
        raw = image_base64.split(",", 1)[1] if image_base64.startswith("data:") else image_base64
        image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        width, height = (int(value) for value in size.split("x"))
        # Crop to Sora's exact required dimensions without stretching the
        # garment or changing its proportions.
        image = ImageOps.fit(image, (width, height), method=Image.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=95)
        output.seek(0)
        output.name = "product-reference.jpg"
        return output
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid style reference image: {error}") from error


def _sora_generate_scene_video(
    scene_index: int,
    total_scenes: int,
    prompt: str,
    image_base64: Optional[str],
    duration_seconds: int,
    aspect_ratio: str,
) -> bytes:
    """Create, poll, and download one image-guided Sora video."""
    if not image_base64:
        raise HTTPException(
            status_code=400,
            detail=f"Scene {scene_index + 1}: Sora image-to-video requires style_reference_image_base64.",
        )

    size = _sora_size_for_aspect_ratio(aspect_ratio)
    seconds = duration_seconds
    reference = _reference_image_file(image_base64, size)
    data = {
        "model": SORA_VIDEO_MODEL,
        "prompt": prompt,
        "size": size,
        "seconds": str(seconds),
    }
    files = {"input_reference": ("product-reference.jpg", reference, "image/jpeg")}
    print(
        f"[SoraVideo] scene {scene_index + 1}/{total_scenes} submitting to {SORA_VIDEO_MODEL} "
        f"(size={size}, duration={seconds}s)"
    )
    submit_resp = requests.post(
        OPENAI_VIDEO_API,
        data=data,
        files=files,
        headers=_openai_headers(),
        timeout=90,
    )
    if submit_resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Scene {scene_index + 1}: Sora submit failed "
                f"({submit_resp.status_code}): {submit_resp.text[:500]}"
            ),
        )

    submit_json = submit_resp.json()
    video_id = submit_json.get("id")
    if not video_id:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Scene {scene_index + 1}: Sora submit response missing id: "
                f"{submit_json}"
            ),
        )

    print(f"[SoraVideo] scene {scene_index + 1}/{total_scenes} queued id={video_id}")
    deadline = time.time() + MAX_POLL_SECONDS
    last_status: Optional[str] = None
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_SECONDS)
        try:
            status_resp = requests.get(
                f"{OPENAI_VIDEO_API}/{video_id}", headers=_openai_headers(), timeout=60
            )
        except requests.RequestException as error:
            # A video job continues server-side when a status request has a
            # transient network timeout. Keep polling until the overall render
            # deadline instead of failing a completed or nearly-complete job.
            logger.warning(
                "[SoraVideo] scene %s/%s status poll transiently failed: %s",
                scene_index + 1,
                total_scenes,
                error,
            )
            continue
        if status_resp.status_code in {429, 500, 502, 503, 504}:
            logger.warning(
                "[SoraVideo] scene %s/%s status poll returned %s; retrying",
                scene_index + 1,
                total_scenes,
                status_resp.status_code,
            )
            continue
        if status_resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Scene {scene_index + 1}: Sora status poll failed "
                    f"({status_resp.status_code}): {status_resp.text[:500]}"
                ),
            )
        status_json = status_resp.json()
        status = (status_json.get("status") or "").lower()
        if status != last_status:
            print(f"[SoraVideo] scene {scene_index + 1}/{total_scenes} status={status}")
            last_status = status

        if status == "completed":
            break
        if status in {"failed", "error", "canceled", "cancelled"}:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Scene {scene_index + 1}: Sora job ended with status={status}: "
                    f"{str(status_json)[:500]}"
                ),
            )
    else:
        raise HTTPException(
            status_code=504,
            detail=f"Scene {scene_index + 1}: Sora job timed out after {MAX_POLL_SECONDS}s",
        )

    download_resp = requests.get(
        f"{OPENAI_VIDEO_API}/{video_id}/content", headers=_openai_headers(), timeout=300
    )
    if download_resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Scene {scene_index + 1}: Sora video download failed "
                f"({download_resp.status_code})"
            ),
        )

    return download_resp.content


# --------------------------------------------------------------------------
# Generate Ad Endpoint
# --------------------------------------------------------------------------

@app.post("/generate-ad", response_model=GenerateAdResponse)
async def generate_ad(req: GenerateAdRequest) -> Dict[str, Any]:
    """Generate a multi-scene advertisement video using OpenAI Sora."""

    logger.info(f"[SoraVideo] Generating ad with {len(req.scenes)} scenes")

    if len(req.scenes) <= 0:
        raise HTTPException(status_code=400, detail="At least 1 scene required.")
    if req.duration_seconds not in {4, 8, 12, 16, 20}:
        raise HTTPException(
            status_code=422,
            detail="Sora supports video durations of 4, 8, 12, 16, or 20 seconds.",
        )

    ad_id = f"ad_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    local_video_files: List[str] = []

    try:
        for idx, scene in enumerate(req.scenes):
            print(f"[SoraVideo] scene {idx + 1}/{len(req.scenes)} starting")
            final_prompt = build_prompt(scene.prompt, scene.dialogue)

            video_bytes = _sora_generate_scene_video(
                scene_index=idx,
                total_scenes=len(req.scenes),
                prompt=final_prompt,
                image_base64=req.style_reference_image_base64,
                duration_seconds=req.duration_seconds,
                aspect_ratio=req.aspect_ratio,
            )

            local_path = tempfile.mktemp(suffix=f"_scene_{idx}.mp4")
            with open(local_path, "wb") as f:
                f.write(video_bytes)
            local_video_files.append(local_path)
            print(f"[SoraVideo] scene {idx + 1}/{len(req.scenes)} saved -> {local_path}")

        # Stitch if multiple scenes, otherwise use the single scene file
        if len(local_video_files) > 1:
            stitched_path = tempfile.mktemp(suffix="_ad.mp4")
            print(f"[SoraVideo] stitching {len(local_video_files)} scenes -> {stitched_path}")
            stitch_videos(local_video_files, stitched_path)
        else:
            stitched_path = local_video_files[0]

        # Try GCS upload, fallback to base64
        stitched_url: Optional[str] = None
        stitched_b64: Optional[str] = None
        try:
            stitched_obj = f"ads/{ad_id}/ad.mp4"
            upload_to_gcs(stitched_path, stitched_obj)
            stitched_url = get_public_url(BUCKET_NAME, stitched_obj)
            print(f"[SoraVideo] uploaded stitched video to GCS: {stitched_url}")
        except Exception as e:
            logger.warning(f"[SoraVideo] GCS upload failed ({e}), returning base64")
            with open(stitched_path, "rb") as f:
                stitched_b64 = base64.b64encode(f.read()).decode("utf-8")

        return {
            "stitched_video_url": stitched_url,
            "stitched_video_base64": stitched_b64,
            "scene_video_urls": [],
        }

    finally:
        # Cleanup temp files
        for p in local_video_files:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass
        if len(local_video_files) > 1:
            try:
                # stitched_path is only distinct when there are multiple scenes
                if "stitched_path" in locals() and os.path.exists(stitched_path):  # type: ignore[name-defined]
                    os.remove(stitched_path)  # type: ignore[name-defined]
            except Exception:
                pass


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "video-gen-service",
        "model": SORA_VIDEO_MODEL,
        "provider": "openai",
    }
