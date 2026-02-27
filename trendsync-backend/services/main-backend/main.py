"""
TrendSync Brand Factory — Main Backend Service
API gateway for all platform functionality.
Port 8000.
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import sys
import base64
import time
import uuid
import asyncio
import json

import websockets

# Load environment BEFORE importing shared modules (they read env at import time)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
except Exception:
    pass

# Backend root: /app in Docker, or parent of "services" when run locally
_backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)
if "/app" not in sys.path:
    sys.path.append("/app")
# Allow importing design_agent.py from the same directory
_this_dir = os.path.dirname(os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)
from shared.trend_engine import fetch_trends, fetch_celebrity_list
from shared.brand_guardian import validate_prompt, get_compliance_badge
from shared import cache as redis_cache
from shared.collection_engine import generate_collection
from shared.image_generator import generate_product_image, edit_product_image
from shared.techpack_generator import generate_techpack
from shared.ad_video_engine import generate_complete_ad_video, generate_single_product_video
from shared.pipeline_orchestrator import run_full_pipeline
from shared.foxit_service import (
    generate_full_techpack_pdf,
    generate_lookbook as foxit_generate_lookbook,
)

from google.cloud import storage
from google.genai import types as genai_types
from shared.image_utils import resize_image_b64
from design_agent import (
    runner as design_runner,
    session_service as design_session_service,
    set_image as design_set_image,
    get_image as design_get_image,
    clear_image as design_clear_image,
)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

BUCKET_NAME = os.environ.get("GCS_BUCKET", "trendsync-brand-factory-media")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")

# In-memory stores (production would use Supabase)
COLLECTIONS: Dict[str, Any] = {}
COLLECTION_STATUS: Dict[str, Dict[str, Any]] = {}
AD_VIDEOS: Dict[str, Any] = {}
AD_VIDEO_STATUS: Dict[str, Dict[str, Any]] = {}
PIPELINES: Dict[str, Any] = {}
PIPELINE_STATUS: Dict[str, Dict[str, Any]] = {}
BRAND_STYLES: Dict[str, Any] = {}

# Lightweight text-only conversation memory per design-companion session.
# Each entry: {"role": "user"|"assistant", "text": "..."}
# We keep only the last MAX_HISTORY_TURNS turns to stay compact.
DESIGN_CHAT_HISTORY: Dict[str, List[Dict[str, str]]] = {}
MAX_HISTORY_TURNS = 6  # 3 user + 3 assistant = ~3k tokens of text


# --------------------------------------------------------------------------
# GCS helpers
# --------------------------------------------------------------------------

def upload_image_to_gcs(image_base64: str, object_name: str) -> str:
    """Upload base64 image to GCS and return signed URL."""
    try:
        from google.oauth2 import service_account
        from datetime import timedelta

        creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds_path and os.path.exists(creds_path):
            credentials = service_account.Credentials.from_service_account_file(creds_path)
            client = storage.Client(project=PROJECT_ID, credentials=credentials)
        else:
            client = storage.Client(project=PROJECT_ID)

        bucket = client.bucket(BUCKET_NAME)
        blob = bucket.blob(object_name)

        image_bytes = base64.b64decode(image_base64)
        blob.upload_from_string(image_bytes, content_type="image/png")

        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=24),
            method="GET",
        )
        return url
    except Exception as e:
        print(f"[GCS] Upload failed: {e}")
        return f"data:image/png;base64,{image_base64}"


# --------------------------------------------------------------------------
# FastAPI App
# --------------------------------------------------------------------------

app = FastAPI(title="TrendSync Brand Factory API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "main-backend", "project": PROJECT_ID}


@app.get("/cache/stats")
async def cache_stats():
    """Return Redis cache statistics."""
    return redis_cache.cache_stats()


@app.delete("/cache/{prefix}")
async def clear_cache(prefix: str):
    """Clear cached entries by prefix (e.g. 'trends', 'img_gen', 'celebrities')."""
    deleted = redis_cache.clear_prefix(prefix)
    return {"success": True, "prefix": prefix, "deleted": deleted}


# --------------------------------------------------------------------------
# Brand Style endpoints
# --------------------------------------------------------------------------

class BrandStyleRequest(BaseModel):
    brand_id: str
    style: Dict[str, Any]


@app.get("/brands/{brand_id}/style")
async def get_brand_style(brand_id: str):
    style = BRAND_STYLES.get(brand_id)
    if not style:
        raise HTTPException(status_code=404, detail="Brand style not found")
    return {"brand_id": brand_id, "style": style}


@app.post("/brands/{brand_id}/style")
async def save_brand_style(brand_id: str, request: BrandStyleRequest):
    BRAND_STYLES[brand_id] = request.style
    return {"success": True, "brand_id": brand_id}


# --------------------------------------------------------------------------
# Trend Intelligence
# --------------------------------------------------------------------------

class TrendRequest(BaseModel):
    season: str = ""
    region: str = "global"
    demographic: str = "millennials"
    trend_source: str = "regional"


@app.post("/trends")
async def get_trends(request: TrendRequest):
    try:
        insights = fetch_trends(
            season=request.season,
            region=request.region,
            demographic=request.demographic,
            trend_source=request.trend_source,
        )
        return {"success": True, "insights": insights}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trends/celebrities")
async def get_celebrities(demographic: str = "millennials"):
    try:
        celebrities = fetch_celebrity_list(demographic)
        return {"success": True, "celebrities": celebrities}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Collection Generation (background task)
# --------------------------------------------------------------------------

class CollectionRequest(BaseModel):
    brand_id: str
    season: str = ""
    region: str = "global"
    demographic: str = "millennials"
    categories: List[str] = ["tops", "bottoms", "dresses"]
    product_count: int = 6
    trend_source: str = "regional"


def generate_collection_background(collection_id: str, config: Dict[str, Any]):
    """Background task: generate collection + images."""
    try:
        COLLECTION_STATUS[collection_id]["status"] = "generating_plan"
        COLLECTION_STATUS[collection_id]["updated_at"] = time.time()

        brand_id = config.pop("brand_id", "")
        brand_style = BRAND_STYLES.get(brand_id, {})

        # Fetch trends
        COLLECTION_STATUS[collection_id]["status"] = "fetching_trends"
        COLLECTION_STATUS[collection_id]["message"] = "Analyzing fashion trends..."
        trend_insights = fetch_trends(
            season=config.get("season", ""),
            region=config.get("region", "global"),
            demographic=config.get("demographic", "millennials"),
            trend_source=config.get("trend_source", "regional"),
        )

        # Generate collection plan
        COLLECTION_STATUS[collection_id]["status"] = "generating_plan"
        COLLECTION_STATUS[collection_id]["message"] = "Planning collection with AI..."
        collection_data = generate_collection(config, brand_style, trend_insights)
        collection_data["collection_id"] = collection_id

        # Generate images for each product
        COLLECTION_STATUS[collection_id]["status"] = "generating_images"
        total = len(collection_data.get("products", []))
        COLLECTION_STATUS[collection_id]["total"] = total

        for i, product in enumerate(collection_data.get("products", [])):
            COLLECTION_STATUS[collection_id]["current"] = i + 1
            COLLECTION_STATUS[collection_id]["message"] = f"Generating image {i + 1}/{total}: {product.get('name', '')}"

            try:
                image_b64 = generate_product_image(
                    product_description=product.get("description", ""),
                    category=product.get("category", ""),
                    brand_style=brand_style,
                    trend_colors=trend_insights.get("colors"),
                    trend_materials=trend_insights.get("materials"),
                )
                # Upload to GCS
                obj_name = f"collections/{collection_id}/{product.get('product_id', f'prod_{i}')}.png"
                product["image_url"] = upload_image_to_gcs(image_b64, obj_name)
                product["image_base64"] = image_b64

                # Validate against brand
                validation = validate_prompt(
                    {"description": product.get("description", ""), "color_scheme": product.get("color_story", "")},
                    brand_style,
                )
                product["validation"] = validation

            except Exception as img_err:
                print(f"[Collection] Image generation failed for product {i}: {img_err}")
                product["image_url"] = None
                product["image_error"] = str(img_err)

        # Store
        COLLECTIONS[collection_id] = collection_data
        COLLECTION_STATUS[collection_id]["status"] = "complete"
        COLLECTION_STATUS[collection_id]["message"] = "Collection ready!"
        COLLECTION_STATUS[collection_id]["updated_at"] = time.time()
        print(f"[Collection] {collection_id} complete with {total} products")

    except Exception as e:
        print(f"[Collection] {collection_id} failed: {e}")
        COLLECTION_STATUS[collection_id]["status"] = "failed"
        COLLECTION_STATUS[collection_id]["error"] = str(e)
        COLLECTION_STATUS[collection_id]["updated_at"] = time.time()


@app.post("/generate-collection")
async def start_collection_generation(
    request: CollectionRequest,
    background_tasks: BackgroundTasks,
):
    collection_id = f"col_{int(time.time())}_{uuid.uuid4().hex[:8]}"

    COLLECTION_STATUS[collection_id] = {
        "status": "pending",
        "collection_id": collection_id,
        "created_at": time.time(),
        "updated_at": time.time(),
        "message": "Starting collection generation...",
        "current": 0,
        "total": 0,
        "error": None,
    }

    background_tasks.add_task(
        generate_collection_background,
        collection_id,
        request.model_dump(),
    )

    return {
        "success": True,
        "collection_id": collection_id,
        "status": "pending",
        "message": "Collection generation started. Poll GET /collections/{id} for status.",
    }


@app.get("/collections/{collection_id}")
async def get_collection(collection_id: str):
    # Check status
    if collection_id in COLLECTION_STATUS:
        status = COLLECTION_STATUS[collection_id]
        if status["status"] in ("pending", "fetching_trends", "generating_plan", "generating_images"):
            return {
                "collection_id": collection_id,
                "status": status["status"],
                "message": status.get("message", ""),
                "current": status.get("current", 0),
                "total": status.get("total", 0),
            }
        if status["status"] == "failed":
            return {
                "collection_id": collection_id,
                "status": "failed",
                "error": status.get("error", "Unknown error"),
            }

    # Return completed collection
    collection = COLLECTIONS.get(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Strip base64 from response to keep it light
    products_clean = []
    for p in collection.get("products", []):
        pc = {k: v for k, v in p.items() if k != "image_base64"}
        products_clean.append(pc)

    return {
        "collection_id": collection["collection_id"],
        "name": collection.get("name"),
        "description": collection.get("description"),
        "season": collection.get("season"),
        "status": "complete",
        "products": products_clean,
    }


@app.get("/collections")
async def list_collections():
    result = []
    for cid, col in COLLECTIONS.items():
        result.append({
            "collection_id": cid,
            "name": col.get("name"),
            "description": col.get("description"),
            "season": col.get("season"),
            "product_count": len(col.get("products", [])),
        })
    return {"collections": result}


# --------------------------------------------------------------------------
# Single Image Generation
# --------------------------------------------------------------------------

class ImageGenRequest(BaseModel):
    product_description: str
    category: str
    brand_id: str = ""
    trend_colors: Optional[List[Dict[str, Any]]] = None
    trend_materials: Optional[List[Dict[str, Any]]] = None


@app.post("/generate-image")
async def generate_image(request: ImageGenRequest):
    try:
        brand_style = BRAND_STYLES.get(request.brand_id, {})
        image_b64 = generate_product_image(
            product_description=request.product_description,
            category=request.category,
            brand_style=brand_style,
            trend_colors=request.trend_colors,
            trend_materials=request.trend_materials,
        )
        return {"success": True, "image_base64": image_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Image Editing
# --------------------------------------------------------------------------

class ImageEditRequest(BaseModel):
    image_base64: str
    edit_instruction: str


@app.post("/edit-image")
async def edit_image(request: ImageEditRequest):
    try:
        edited_b64 = edit_product_image(request.image_base64, request.edit_instruction)
        return {"success": True, "image_base64": edited_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Brand Guardian (Prompt Validation)
# --------------------------------------------------------------------------

class ValidateRequest(BaseModel):
    prompt: Dict[str, Any]
    brand_id: str


@app.post("/validate")
async def validate(request: ValidateRequest):
    brand_style = BRAND_STYLES.get(request.brand_id, {})
    if not brand_style:
        raise HTTPException(status_code=404, detail="Brand style not found")
    result = validate_prompt(request.prompt, brand_style)
    result["badge"] = get_compliance_badge(result["compliance_score"])
    return result


# --------------------------------------------------------------------------
# Design Chat (conversational design companion)
# --------------------------------------------------------------------------

class DesignChatRequest(BaseModel):
    product_context: Dict[str, Any]
    user_message: str
    conversation_history: Optional[List[Dict[str, str]]] = None


@app.post("/design/chat")
async def design_chat(request: DesignChatRequest):
    """Conversational design companion — routes through ADK agent (Vertex AI)."""
    try:
        # Route legacy /design/chat through the ADK agent for consistency
        # This ensures ALL Gemini calls go through ADK on Vertex AI
        session_id = f"chat-legacy-{uuid.uuid4().hex[:8]}"

        session = await design_session_service.create_session(
            app_name=design_runner.app_name,
            user_id="web",
            session_id=session_id,
        )

        state_delta = {
            "_image_key": "",
            "brand_style_json": {},
            "brand_id": "",
            "product_context": request.product_context,
        }

        new_message = genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=request.user_message)],
        )

        response_text = ""
        async for event in design_runner.run_async(
            user_id="web",
            session_id=session_id,
            new_message=new_message,
            state_delta=state_delta,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_text += part.text

        return {"success": True, "response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Tech Pack
# --------------------------------------------------------------------------

class TechPackRequest(BaseModel):
    product: Dict[str, Any]


@app.post("/generate-techpack")
async def gen_techpack(request: TechPackRequest):
    try:
        techpack = generate_techpack(request.product)
        return {"success": True, "techpack": techpack}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Ad Video Generation (background task)
# --------------------------------------------------------------------------

class AdVideoRequest(BaseModel):
    product: Dict[str, Any]
    brand_id: str
    product_image_base64: Optional[str] = None
    campaign_brief: str = ""
    ad_style: str = "cinematic"


def generate_ad_video_background(ad_id: str, params: Dict[str, Any]):
    try:
        AD_VIDEO_STATUS[ad_id]["status"] = "generating"
        AD_VIDEO_STATUS[ad_id]["message"] = "Creating ad storyboard..."
        AD_VIDEO_STATUS[ad_id]["updated_at"] = time.time()

        brand_style = BRAND_STYLES.get(params.get("brand_id", ""), {})

        ad_data = generate_complete_ad_video(
            product=params["product"],
            brand_style=brand_style,
            product_image_base64=params.get("product_image_base64"),
            campaign_brief=params.get("campaign_brief", ""),
            ad_style=params.get("ad_style", "cinematic"),
        )

        AD_VIDEOS[ad_id] = ad_data
        AD_VIDEO_STATUS[ad_id]["status"] = "complete"
        AD_VIDEO_STATUS[ad_id]["message"] = "Ad video ready!"
        AD_VIDEO_STATUS[ad_id]["updated_at"] = time.time()

    except Exception as e:
        print(f"[Ad Video] {ad_id} failed: {e}")
        AD_VIDEO_STATUS[ad_id]["status"] = "failed"
        AD_VIDEO_STATUS[ad_id]["error"] = str(e)
        AD_VIDEO_STATUS[ad_id]["updated_at"] = time.time()


@app.post("/generate-ad-video")
async def start_ad_video(request: AdVideoRequest, background_tasks: BackgroundTasks):
    ad_id = f"ad_{int(time.time())}_{uuid.uuid4().hex[:8]}"

    AD_VIDEO_STATUS[ad_id] = {
        "status": "pending",
        "ad_id": ad_id,
        "created_at": time.time(),
        "updated_at": time.time(),
        "message": "Starting ad video generation...",
        "error": None,
    }

    background_tasks.add_task(
        generate_ad_video_background,
        ad_id,
        request.model_dump(),
    )

    return {
        "success": True,
        "ad_id": ad_id,
        "status": "pending",
        "message": "Ad video generation started. Poll GET /ad-videos/{id} for status.",
    }


@app.get("/ad-videos/{ad_id}")
async def get_ad_video(ad_id: str):
    if ad_id in AD_VIDEO_STATUS:
        status = AD_VIDEO_STATUS[ad_id]
        if status["status"] in ("pending", "generating"):
            return {
                "ad_id": ad_id,
                "status": status["status"],
                "message": status.get("message", ""),
            }
        if status["status"] == "failed":
            return {
                "ad_id": ad_id,
                "status": "failed",
                "error": status.get("error"),
            }

    ad = AD_VIDEOS.get(ad_id)
    if not ad:
        raise HTTPException(status_code=404, detail="Ad video not found")

    return {"ad_id": ad_id, "status": "complete", **ad}


# --------------------------------------------------------------------------
# Single Product Video (on-demand, 10-second Veo advertisement)
# --------------------------------------------------------------------------

PRODUCT_VIDEO_STATUS: Dict[str, Dict[str, Any]] = {}
PRODUCT_VIDEOS: Dict[str, Any] = {}


class ProductVideoRequest(BaseModel):
    product: Dict[str, Any]
    brand_id: str = ""
    image_base64: Optional[str] = None


def generate_product_video_background(video_id: str, params: Dict[str, Any]):
    try:
        PRODUCT_VIDEO_STATUS[video_id]["status"] = "generating"
        PRODUCT_VIDEO_STATUS[video_id]["message"] = "Creating video prompt and generating with Veo..."
        PRODUCT_VIDEO_STATUS[video_id]["updated_at"] = time.time()

        brand_style = BRAND_STYLES.get(params.get("brand_id", ""), {})

        video_data = generate_single_product_video(
            product=params["product"],
            brand_style=brand_style,
            product_image_base64=params.get("image_base64"),
        )

        PRODUCT_VIDEOS[video_id] = video_data
        PRODUCT_VIDEO_STATUS[video_id]["status"] = "complete"
        PRODUCT_VIDEO_STATUS[video_id]["message"] = "Advertisement video ready!"
        PRODUCT_VIDEO_STATUS[video_id]["updated_at"] = time.time()

    except Exception as e:
        print(f"[Product Video] {video_id} failed: {e}")
        PRODUCT_VIDEO_STATUS[video_id]["status"] = "failed"
        PRODUCT_VIDEO_STATUS[video_id]["error"] = str(e)
        PRODUCT_VIDEO_STATUS[video_id]["updated_at"] = time.time()


@app.post("/generate-product-video")
async def start_product_video(request: ProductVideoRequest, background_tasks: BackgroundTasks):
    video_id = f"pvid_{int(time.time())}_{uuid.uuid4().hex[:8]}"

    PRODUCT_VIDEO_STATUS[video_id] = {
        "status": "pending",
        "video_id": video_id,
        "created_at": time.time(),
        "updated_at": time.time(),
        "message": "Starting video generation...",
        "error": None,
    }

    background_tasks.add_task(
        generate_product_video_background,
        video_id,
        request.model_dump(),
    )

    return {
        "success": True,
        "video_id": video_id,
        "status": "pending",
    }


@app.get("/product-videos/{video_id}")
async def get_product_video(video_id: str):
    status = PRODUCT_VIDEO_STATUS.get(video_id)
    if not status:
        raise HTTPException(status_code=404, detail="Video not found")

    if status["status"] in ("pending", "generating"):
        return {
            "video_id": video_id,
            "status": status["status"],
            "message": status.get("message", ""),
        }
    if status["status"] == "failed":
        return {
            "video_id": video_id,
            "status": "failed",
            "error": status.get("error"),
        }

    video = PRODUCT_VIDEOS.get(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video data not found")

    return {
        "video_id": video_id,
        "status": "complete",
        "video_base64": video.get("video_base64"),
        "video_url": video.get("video_url"),
        "video_prompt": video.get("video_prompt", ""),
    }


# --------------------------------------------------------------------------
# Full Pipeline Orchestrator (ADK-style multi-step agent pipeline)
# --------------------------------------------------------------------------

class PipelineRequest(BaseModel):
    brand_id: str = ""
    season: str = ""
    region: str = "global"
    demographic: str = "millennials"
    categories: List[str] = ["tops", "bottoms", "dresses"]
    product_count: int = 6
    trend_source: str = "regional"
    generate_ad_video: bool = False
    campaign_brief: str = ""
    ad_style: str = "cinematic"


def run_pipeline_background(pipeline_id: str, config: Dict[str, Any]):
    """Background task: run the full pipeline with status updates."""
    try:
        # Preserve config values for the result before popping
        original_region = config.get("region", "")
        original_demographic = config.get("demographic", "")
        brand_style = BRAND_STYLES.get(config.pop("brand_id", ""), {})
        gen_video = config.pop("generate_ad_video", False)

        def status_callback(step: str, message: str, data: Optional[Dict] = None):
            PIPELINE_STATUS[pipeline_id]["current_step"] = step
            PIPELINE_STATUS[pipeline_id]["message"] = message
            PIPELINE_STATUS[pipeline_id]["updated_at"] = time.time()
            if data:
                PIPELINE_STATUS[pipeline_id]["step_data"] = data
                # Also store per-step results so they don't get overwritten
                PIPELINE_STATUS[pipeline_id]["step_results"][step] = data
            # Track which steps are complete
            steps_order = ["trends", "collection", "images", "video"]
            if step in steps_order:
                idx = steps_order.index(step)
                PIPELINE_STATUS[pipeline_id]["completed_steps"] = steps_order[:idx]

        result = run_full_pipeline(
            config=config,
            brand_style=brand_style,
            status_callback=status_callback,
            upload_fn=upload_image_to_gcs,
            generate_ad_video=gen_video,
        )

        result["_config"] = {"region": original_region, "demographic": original_demographic}
        PIPELINES[pipeline_id] = result
        PIPELINE_STATUS[pipeline_id]["status"] = "complete"
        PIPELINE_STATUS[pipeline_id]["message"] = "Pipeline complete!"
        PIPELINE_STATUS[pipeline_id]["completed_steps"] = ["trends", "collection", "images", "video"]
        PIPELINE_STATUS[pipeline_id]["updated_at"] = time.time()

    except Exception as e:
        print(f"[Pipeline] {pipeline_id} failed: {e}")
        PIPELINE_STATUS[pipeline_id]["status"] = "failed"
        PIPELINE_STATUS[pipeline_id]["error"] = str(e)
        PIPELINE_STATUS[pipeline_id]["updated_at"] = time.time()


@app.post("/adk/pipeline")
async def start_pipeline(request: PipelineRequest, background_tasks: BackgroundTasks):
    pipeline_id = f"pipe_{int(time.time())}_{uuid.uuid4().hex[:8]}"

    PIPELINE_STATUS[pipeline_id] = {
        "status": "running",
        "pipeline_id": pipeline_id,
        "created_at": time.time(),
        "updated_at": time.time(),
        "current_step": "pending",
        "message": "Starting pipeline...",
        "completed_steps": [],
        "step_data": {},
        "step_results": {},
        "error": None,
    }

    background_tasks.add_task(
        run_pipeline_background,
        pipeline_id,
        request.model_dump(),
    )

    return {
        "success": True,
        "pipeline_id": pipeline_id,
        "status": "running",
        "message": "Full pipeline started. Poll GET /adk/pipeline/{id}/status for progress.",
    }


@app.get("/adk/pipeline/{pipeline_id}/status")
async def get_pipeline_status(pipeline_id: str):
    status = PIPELINE_STATUS.get(pipeline_id)
    if not status:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    response = {
        "pipeline_id": pipeline_id,
        "status": status["status"],
        "current_step": status.get("current_step", "pending"),
        "message": status.get("message", ""),
        "completed_steps": status.get("completed_steps", []),
        "step_data": status.get("step_data", {}),
        "step_results": status.get("step_results", {}),
        "error": status.get("error"),
    }

    # If complete, include full result data for persistence
    if status["status"] == "complete" and pipeline_id in PIPELINES:
        pipeline = PIPELINES[pipeline_id]
        collection = pipeline.get("collection", {})
        products = collection.get("products", [])
        trend_insights = pipeline.get("trend_insights", {})
        response["result"] = {
            "collection_id": collection.get("collection_id"),
            "collection_name": collection.get("name"),
            "collection_description": collection.get("description", ""),
            "season": collection.get("season", ""),
            "region": pipeline.get("_config", {}).get("region", ""),
            "demographic": pipeline.get("_config", {}).get("demographic", ""),
            "product_count": len(products),
            "products": [
                {
                    "name": p.get("name"),
                    "category": p.get("category"),
                    "description": p.get("description", ""),
                    "color_story": p.get("color_story", ""),
                    "material": p.get("material", ""),
                    "target_price": p.get("target_price", ""),
                    "image_url": p.get("image_url"),
                    "image_base64": p.get("image_base64"),
                    "product_id": p.get("product_id", ""),
                    "compliance_score": p.get("compliance_score", 0),
                    "video_base64": p.get("video_base64"),
                    "video_url": p.get("video_url"),
                }
                for p in products
            ],
            "trend_insights": {
                "summary": trend_insights.get("summary", ""),
                "colors": trend_insights.get("colors", []),
                "materials": trend_insights.get("materials", []),
                "silhouettes": trend_insights.get("silhouettes", []),
            },
            "ad_video": pipeline.get("ad_video"),
        }

    return response


# --------------------------------------------------------------------------
# Design Companion (ADK Agent — Lux)
# --------------------------------------------------------------------------

class DesignCompanionRequest(BaseModel):
    session_id: str
    user_message: str
    product_context: Dict[str, Any]
    image_base64: Optional[str] = None
    brand_id: str = ""


@app.post("/adk/design-companion")
async def design_companion(request: DesignCompanionRequest):
    """ADK-powered design companion: Lux decides which tool(s) to call.

    IMPORTANT — Token-limit fix:
    ADK replays ALL session history on each run_async(). Images in prior
    turns accumulate and quickly blow past the 1 048 576-token cap.
    Solution: create a **fresh session per request** and carry forward
    only a lightweight text summary of recent conversation turns.
    """
    try:
        # 1. Create a FRESH session for every request (prevents token accumulation)
        one_shot_id = f"dc-{uuid.uuid4().hex[:12]}"
        await design_session_service.create_session(
            app_name=design_runner.app_name,
            user_id="web",
            session_id=one_shot_id,
        )

        # 2. Store image in EXTERNAL store (NOT in ADK state — state gets
        #    serialized into the model prompt and a multi-MB base64 string
        #    blows past the 1M token limit).
        img_key = one_shot_id  # unique per request
        if request.image_base64:
            design_set_image(img_key, request.image_base64)

        brand_style = BRAND_STYLES.get(request.brand_id, {})
        state_delta = {
            "_image_key": img_key,          # lightweight key, not the actual bytes
            "brand_style_json": brand_style,
            "brand_id": request.brand_id,
            "product_context": request.product_context,
        }

        # 3. Build conversation context from prior turns (text only — no images)
        history = DESIGN_CHAT_HISTORY.get(request.session_id, [])
        context_block = ""
        if history:
            lines = []
            for turn in history[-MAX_HISTORY_TURNS:]:
                role = "User" if turn["role"] == "user" else "Lux"
                lines.append(f"{role}: {turn['text']}")
            context_block = (
                "[Previous conversation for context]\n"
                + "\n".join(lines)
                + "\n[End of previous conversation]\n\n"
            )

        # 4. Build multimodal user message (text + optional small image)
        full_text = context_block + request.user_message
        message_parts = [genai_types.Part(text=full_text)]

        if request.image_base64:
            resized_bytes = resize_image_b64(request.image_base64, max_size=256)
            message_parts.append(genai_types.Part.from_bytes(
                data=resized_bytes,
                mime_type="image/jpeg",
            ))

        new_message = genai_types.Content(
            role="user",
            parts=message_parts,
        )

        response_text = ""
        action_data = None

        async for event in design_runner.run_async(
            user_id="web",
            session_id=one_shot_id,
            new_message=new_message,
            state_delta=state_delta,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_text += part.text
                    if hasattr(part, "function_response") and part.function_response:
                        result = part.function_response.response
                        # ADK may return a proto Struct or a plain dict
                        if isinstance(result, dict):
                            tool_result = result
                        elif hasattr(result, "items"):
                            tool_result = dict(result)
                        else:
                            tool_result = None
                        if tool_result and tool_result.get("action"):
                            action_data = tool_result
                            print(f"[design-companion] Tool action: {tool_result.get('action')}, status: {tool_result.get('status')}")

        # 5. Extract the (possibly edited) image from external store.
        #    Tools store edited images there instead of returning base64
        #    in their response dict (which would blow past the token limit).
        result_image_b64 = design_get_image(img_key)
        original_image_b64 = request.image_base64 or ""
        image_was_modified = bool(result_image_b64 and result_image_b64 != original_image_b64)

        # If the image was modified by a tool, attach it to the response
        if image_was_modified:
            if action_data is None:
                action_data = {}
            action_data["image_base64"] = result_image_b64
            print(f"[design-companion] Image modified by tool — attaching {len(result_image_b64):,} chars to response")
        else:
            print(f"[design-companion] Image unchanged (action={action_data.get('action') if action_data else None})")

        # 6. Clean up the external image store (free memory)
        design_clear_image(img_key)

        # 7. Persist text-only turns for next request's context window
        if request.session_id not in DESIGN_CHAT_HISTORY:
            DESIGN_CHAT_HISTORY[request.session_id] = []
        DESIGN_CHAT_HISTORY[request.session_id].append(
            {"role": "user", "text": request.user_message}
        )
        if response_text:
            DESIGN_CHAT_HISTORY[request.session_id].append(
                {"role": "assistant", "text": response_text[:500]}  # cap to keep compact
            )
        # Trim to last N turns
        DESIGN_CHAT_HISTORY[request.session_id] = DESIGN_CHAT_HISTORY[request.session_id][-MAX_HISTORY_TURNS:]

        return {
            "success": True,
            "response": response_text,
            "action": action_data,
        }

    except Exception as e:
        # Clean up image store even on error
        try:
            design_clear_image(img_key)
        except Exception:
            pass
        print(f"[Design Companion] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Direct Image Edit — bypasses ADK for fast image edits (1 API call vs 3)
# --------------------------------------------------------------------------

class DirectEditRequest(BaseModel):
    image_base64: str
    edit_instruction: str


@app.post("/direct-edit-image")
async def direct_edit_image(request: DirectEditRequest):
    """Edit a product image directly without going through ADK.

    This skips the LLM routing (Flash deciding which tool) and the LLM response
    generation (Flash summarizing the result), cutting latency from 3 API calls to 1.
    """
    if not request.image_base64:
        raise HTTPException(status_code=400, detail="No image provided")
    if not request.edit_instruction:
        raise HTTPException(status_code=400, detail="No edit instruction provided")

    print(f"[Direct Edit] Instruction: {request.edit_instruction}")
    print(f"[Direct Edit] Image size: {len(request.image_base64):,} chars")

    try:
        edited_b64 = await asyncio.to_thread(
            edit_product_image, request.image_base64, request.edit_instruction
        )
        return {
            "success": True,
            "image_base64": edited_b64,
            "message": f"Applied: {request.edit_instruction}",
        }
    except Exception as e:
        error_msg = str(e)
        is_rate_limited = "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg
        print(f"[Direct Edit] Error: {error_msg}")
        if is_rate_limited:
            raise HTTPException(status_code=429, detail="Rate limited — please try again in a few seconds")
        raise HTTPException(status_code=500, detail=error_msg)


# --------------------------------------------------------------------------
# Save Design — analyze image and return updated specs for all tabs
# --------------------------------------------------------------------------

class SaveDesignRequest(BaseModel):
    image_base64: str
    product_context: Dict[str, Any]
    brand_id: str = ""


@app.post("/save-design")
async def save_design_analysis(request: SaveDesignRequest):
    """Analyze the current product image and return updated design_spec_json,
    fibo_prompt_json, and brand_compliance_score for DB persistence."""
    try:
        # 1. One-shot ADK session for image analysis
        session_id = f"save-analysis-{uuid.uuid4().hex[:8]}"
        await design_session_service.create_session(
            app_name=design_runner.app_name, user_id="web", session_id=session_id,
        )

        ctx = json.dumps(request.product_context, default=str)
        analysis_prompt = (
            "You are a fashion design specification engine. "
            "Analyze the product image and the product context below, "
            "then return ONLY a JSON object (no markdown, no explanation) with this exact structure:\n"
            "{\n"
            '  "design_spec": {\n'
            '    "silhouette": "...", "fit": "...",\n'
            '    "colors": [{"name":"...","hex":"#...","usage":"primary|accent|detail"}],\n'
            '    "materials": [{"name":"...","placement":"main|lining|trim"}],\n'
            '    "details": ["..."], "inspiration": "..."\n'
            "  },\n"
            '  "fibo_prompt": {\n'
            '    "description": "...", "objects": [{"name":"...","description":"...","attributes":{}}],\n'
            '    "background": "...", "lighting": "...", "aesthetics": "...",\n'
            '    "composition": "...", "color_scheme": "...", "mood_atmosphere": "...",\n'
            '    "depth_of_field": "...", "focus": "...", "camera_angle": "...",\n'
            '    "focal_length": "85mm", "aspect_ratio": "1:1"\n'
            "  }\n"
            "}\n\n"
            f"Product context: {ctx}\n\n"
            "Base your analysis on what you SEE in the image — actual colors, textures, "
            "silhouette shape, and details. Return ONLY valid JSON."
        )

        message_parts = [genai_types.Part(text=analysis_prompt)]
        if request.image_base64:
            resized_bytes = resize_image_b64(request.image_base64, max_size=256)
            message_parts.append(genai_types.Part.from_bytes(
                data=resized_bytes, mime_type="image/jpeg",
            ))

        # Keep image OUT of state_delta to avoid token blowup
        img_key = f"save-{session_id}"
        if request.image_base64:
            design_set_image(img_key, request.image_base64)
        state_delta = {
            "_image_key": img_key,
            "brand_style_json": BRAND_STYLES.get(request.brand_id, {}),
            "product_context": request.product_context,
        }

        new_message = genai_types.Content(role="user", parts=message_parts)

        response_text = ""
        async for event in design_runner.run_async(
            user_id="web", session_id=session_id,
            new_message=new_message, state_delta=state_delta,
        ):
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        response_text += part.text

        # Clean up external image store
        design_clear_image(img_key)

        # 2. Parse the JSON response
        clean = response_text.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1]
            clean = clean.rsplit("```", 1)[0].strip()

        specs = json.loads(clean)

        # 3. Run brand validation on the new fibo prompt
        brand_style = BRAND_STYLES.get(request.brand_id, {})
        compliance_score = 0
        if brand_style and specs.get("fibo_prompt"):
            try:
                validation_result = validate_prompt(specs["fibo_prompt"], brand_style)
                compliance_score = validation_result.get("compliance_score", 0)
            except Exception:
                pass

        return {
            "success": True,
            "design_spec_json": specs.get("design_spec", {}),
            "fibo_prompt_json": specs.get("fibo_prompt", {}),
            "brand_compliance_score": compliance_score,
        }

    except json.JSONDecodeError:
        # If JSON parsing fails, return partial data
        return {
            "success": False,
            "design_spec_json": {},
            "fibo_prompt_json": {},
            "brand_compliance_score": 0,
            "error": "Could not parse design analysis",
        }
    except Exception as e:
        print(f"[Save Design] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --------------------------------------------------------------------------
# Voice Companion WebSocket proxy
# --------------------------------------------------------------------------

@app.websocket("/ws/voice-companion/{session_id}")
async def voice_companion_proxy(websocket, session_id: str):
    """WebSocket proxy to standalone voice companion service."""
    from starlette.websockets import WebSocket
    await websocket.accept()

    voice_url = os.getenv("VOICE_COMPANION_URL", "ws://localhost:8002/ws/voice-companion")
    voice_ws_url = f"{voice_url}/{session_id}"

    try:
        async with websockets.connect(voice_ws_url) as voice_ws:
            async def forward_to_voice():
                try:
                    while True:
                        message = await websocket.receive()
                        if "text" in message:
                            await voice_ws.send(message["text"])
                        elif "bytes" in message:
                            await voice_ws.send(message["bytes"])
                except Exception:
                    pass

            async def forward_from_voice():
                try:
                    async for message in voice_ws:
                        await websocket.send_text(message)
                except Exception:
                    pass

            await asyncio.gather(forward_to_voice(), forward_from_voice(), return_exceptions=True)
    except Exception as e:
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass


# --------------------------------------------------------------------------
# Foxit Document Generation + PDF Services
# --------------------------------------------------------------------------

class TechPackPDFRequest(BaseModel):
    product: Dict[str, Any]
    techpack: Optional[Dict[str, Any]] = None  # Saved techpack from DB (single source of truth)
    brand_name: str = ""


class LookbookRequest(BaseModel):
    products: List[Dict[str, Any]]  # Each has "product" and optionally "techpack"
    brand_name: str = ""


@app.post("/generate-techpack-pdf")
async def gen_techpack_pdf(request: TechPackPDFRequest):
    """Generate a professional tech pack PDF.

    The techpack data MUST be saved in the DB first (via the Tech Pack tab).
    If no saved techpack is provided, the request fails.
    This ensures the PDF always matches what the user sees in the UI.
    """
    try:
        if request.techpack:
            # Use the saved techpack from DB — single source of truth
            techpack_data = request.techpack
            print(f"[Foxit] Using saved techpack from DB for: {request.product.get('name', '?')}")
        else:
            # No saved techpack — fail with a clear message
            raise HTTPException(
                status_code=400,
                detail="Tech pack has not been generated yet. Please go to the Tech Pack tab first to generate and save it before downloading the PDF.",
            )

        # Generate PDF via Foxit
        pdf_bytes = generate_full_techpack_pdf(
            product=request.product,
            techpack=techpack_data,
            brand_name=request.brand_name,
        )

        return {
            "success": True,
            "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
            "techpack": techpack_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Foxit] Tech pack PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-lookbook")
async def gen_lookbook(request: LookbookRequest):
    """Generate a collection lookbook by merging all product tech packs into one PDF."""
    try:
        items = []
        for entry in request.products:
            product = entry.get("product", entry)
            techpack = entry.get("techpack")
            if not techpack:
                techpack = generate_techpack(product)
            items.append({"product": product, "techpack": techpack})

        pdf_bytes = foxit_generate_lookbook(
            products_and_techpacks=items,
            brand_name=request.brand_name,
        )

        return {
            "success": True,
            "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
            "product_count": len(items),
        }
    except Exception as e:
        print(f"[Foxit] Lookbook generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
