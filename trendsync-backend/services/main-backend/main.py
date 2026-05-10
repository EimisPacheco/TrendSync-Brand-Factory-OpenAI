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
import re
from urllib.parse import quote, unquote

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
    generate_techpack_docx,
    generate_full_techpack_pdf,
    get_merged_techpack_data,
    generate_lookbook as foxit_generate_lookbook,
)

from google.cloud import storage
from shared.image_utils import resize_image_b64
from design_agent import (
    run_design_agent,
    analyze_image_to_specs,
    set_image as design_set_image,
    get_image as design_get_image,
    clear_image as design_clear_image,
)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

BUCKET_NAME = os.environ.get("GCS_BUCKET", "trendsync-brand-factory-media")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
# GCS may live in a different GCP project / use a different SA than Vertex (Gemini APIs).
GCS_PROJECT = os.environ.get("GCS_PROJECT", PROJECT_ID)
GCS_CREDENTIALS_PATH = os.environ.get("GCS_CREDENTIALS")

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

        # Prefer GCS-specific credentials (different SA / project than Vertex).
        creds_path = GCS_CREDENTIALS_PATH or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds_path and os.path.exists(creds_path):
            credentials = service_account.Credentials.from_service_account_file(creds_path)
            client = storage.Client(project=GCS_PROJECT, credentials=credentials)
        else:
            client = storage.Client(project=GCS_PROJECT)

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
# Debug — inspect the last image-edit request artefacts
# --------------------------------------------------------------------------

@app.get("/debug/last-edit")
async def debug_last_edit(format: str = "json"):
    """Returns the last image-edit's input image (post-compression), output
    image, and the exact prompt sent to Gemini. Set ?format=json (default)
    for JSON-base64, or ?format=html for an inline browser preview."""
    artefacts: Dict[str, Any] = {}
    for label, path, mime in [
        ("input_jpg", "/tmp/last-edit-input.jpg", "image/jpeg"),
        ("output_png", "/tmp/last-edit-output.png", "image/png"),
        ("prompt_txt", "/tmp/last-edit-prompt.txt", "text/plain"),
    ]:
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            data = f.read()
        artefacts[label] = {
            "path": path,
            "size_bytes": len(data),
            "mime": mime,
            "content": data.decode("utf-8") if mime.startswith("text/") else base64.b64encode(data).decode("ascii"),
        }
    if not artefacts:
        return {"success": False, "message": "No edit has run yet — /tmp/last-edit-* files not present."}
    if format == "html":
        prompt = artefacts.get("prompt_txt", {}).get("content", "(no prompt captured)")
        in_b64 = artefacts.get("input_jpg", {}).get("content", "")
        out_b64 = artefacts.get("output_png", {}).get("content", "")
        html = (
            "<!doctype html><html><head><title>last-edit</title><style>"
            "body{font:14px/1.45 system-ui;padding:24px;max-width:1400px;margin:auto}"
            "img{max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px}"
            ".grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}"
            "pre{background:#f6f8fa;padding:16px;border-radius:8px;white-space:pre-wrap;font-size:12px}"
            "</style></head><body>"
            "<h1>Last image edit</h1>"
            "<div class='grid'>"
            f"<div><h3>INPUT (post-compression, what Gemini saw)</h3>"
            f"<img src='data:image/jpeg;base64,{in_b64}'></div>"
            f"<div><h3>OUTPUT (what Gemini returned)</h3>"
            f"<img src='data:image/png;base64,{out_b64}'></div>"
            "</div>"
            "<h3>Prompt sent to Gemini</h3>"
            f"<pre>{prompt}</pre>"
            "</body></html>"
        )
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html)
    return {"success": True, "artefacts": artefacts}


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
# Model + Product Composite (Company Models catalog)
# --------------------------------------------------------------------------

class GenerateModelCompositeRequest(BaseModel):
    model_image_url: str  # public GCS URL from company_models.image_url
    product_image_base64: str


@app.post("/generate-model-composite")
async def generate_model_composite_endpoint(request: GenerateModelCompositeRequest):
    """Composite a product image onto a model image (Gemini multi-image edit)."""
    try:
        # Fetch model image bytes (it's a public GCS URL)
        import requests
        from shared.model_composite import composite_model_with_product

        r = requests.get(request.model_image_url, timeout=15)
        r.raise_for_status()
        model_b64 = base64.b64encode(r.content).decode("utf-8")
        composite_b64 = await asyncio.to_thread(
            composite_model_with_product, model_b64, request.product_image_base64
        )
        return {"success": True, "image_base64": composite_b64}
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
    """Conversational design companion — routes through OpenAI Agents SDK (Lux)."""
    try:
        # Map the legacy {"role","content"} history to internal {"role","text"}.
        history = None
        if request.conversation_history:
            history = [
                {
                    "role": h.get("role", "user"),
                    "text": h.get("content", h.get("text", "")),
                }
                for h in request.conversation_history
            ]

        result = await run_design_agent(
            user_message=request.user_message,
            product_context=request.product_context,
            brand_style={},
            image_base64=None,
            history=history,
        )
        # Free the empty image slot for this run.
        design_clear_image(result.get("image_key", ""))
        return {"success": True, "response": result.get("response", "")}
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
    model_id: Optional[str] = None


def _fetch_company_model_image_url(model_id: str) -> Optional[str]:
    """Look up a row in `company_models` via Supabase REST and return image_url."""
    try:
        import requests as _requests

        supabase_url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get(
            "SUPABASE_URL", ""
        )
        anon_key = os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get(
            "SUPABASE_ANON_KEY", ""
        )
        if not supabase_url or not anon_key:
            print("[Model Composite] Missing Supabase env; skipping model fetch")
            return None

        url = (
            f"{supabase_url.rstrip('/')}/rest/v1/company_models"
            f"?id=eq.{model_id}&select=image_url"
        )
        r = _requests.get(
            url,
            headers={
                "apikey": anon_key,
                "Authorization": f"Bearer {anon_key}",
            },
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return None
        return rows[0].get("image_url")
    except Exception as e:
        print(f"[Model Composite] fetch model failed: {e}")
        return None


def _maybe_composite_with_model(
    product_image_base64: Optional[str],
    model_id: Optional[str],
) -> Optional[str]:
    """If a model_id is provided, composite the product onto the model and
    return the composite base64. Otherwise return the original product image.
    On any failure, falls back to the original product image."""
    if not model_id or not product_image_base64:
        return product_image_base64
    try:
        import requests as _requests
        from shared.model_composite import composite_model_with_product

        image_url = _fetch_company_model_image_url(model_id)
        if not image_url:
            print(f"[Model Composite] No image_url for model_id={model_id}")
            return product_image_base64

        r = _requests.get(image_url, timeout=15)
        r.raise_for_status()
        model_b64 = base64.b64encode(r.content).decode("utf-8")

        print(f"[Model Composite] Compositing product onto model {model_id}...")
        return composite_model_with_product(model_b64, product_image_base64)
    except Exception as e:
        print(f"[Model Composite] failed, falling back to product image: {e}")
        return product_image_base64


def generate_ad_video_background(ad_id: str, params: Dict[str, Any]):
    try:
        AD_VIDEO_STATUS[ad_id]["status"] = "generating"
        AD_VIDEO_STATUS[ad_id]["message"] = "Creating ad storyboard..."
        AD_VIDEO_STATUS[ad_id]["updated_at"] = time.time()

        brand_style = BRAND_STYLES.get(params.get("brand_id", ""), {})

        # If a company-model is selected, composite the product onto the model
        # and use that image instead of the raw product photo.
        model_id = params.get("model_id")
        product_image_b64 = _maybe_composite_with_model(
            params.get("product_image_base64"), model_id
        )

        ad_data = generate_complete_ad_video(
            product=params["product"],
            brand_style=brand_style,
            product_image_base64=product_image_b64,
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
    model_id: Optional[str] = None
    # Clip length in seconds. None -> use the engine default (8s).
    # Frontend currently exposes 8 / 15 / 20.
    duration_seconds: Optional[int] = None


def generate_product_video_background(video_id: str, params: Dict[str, Any]):
    try:
        PRODUCT_VIDEO_STATUS[video_id]["status"] = "generating"
        PRODUCT_VIDEO_STATUS[video_id]["message"] = "Creating video prompt and generating with Veo..."
        PRODUCT_VIDEO_STATUS[video_id]["updated_at"] = time.time()

        brand_style = BRAND_STYLES.get(params.get("brand_id", ""), {})

        # If a company-model is selected, composite the product onto the model
        # and use that image instead of the raw product photo. The has_model
        # flag drives a different video prompt that keeps the model in-frame
        # instead of asking for a product-only shot.
        model_id = params.get("model_id")
        original_image_b64 = params.get("image_base64")
        product_image_b64 = _maybe_composite_with_model(original_image_b64, model_id)
        has_model = bool(model_id) and product_image_b64 != original_image_b64

        video_data = generate_single_product_video(
            product=params["product"],
            brand_style=brand_style,
            product_image_base64=product_image_b64,
            has_model=has_model,
            duration_seconds=params.get("duration_seconds"),
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
# Design Companion (OpenAI Agents SDK — Lux)
# --------------------------------------------------------------------------

class DesignCompanionRequest(BaseModel):
    session_id: str
    user_message: str
    product_context: Dict[str, Any]
    image_base64: Optional[str] = None
    brand_id: str = ""


@app.post("/adk/design-companion")
async def design_companion(request: DesignCompanionRequest):
    """OpenAI-Agents-SDK-powered design companion: Lux decides which tool(s) to call.

    IMPORTANT — Token-limit safety:
    Each request runs the agent stateless. The base64 product image is held
    in an external dict (design_set_image / design_get_image) so it never
    enters the model transcript / tool-response payloads. We carry forward
    only a lightweight text-only summary of recent conversation turns.
    """
    img_key = f"dc-{uuid.uuid4().hex[:12]}"
    _t_start = time.time()
    print(
        f"[design-companion] in: session={request.session_id} "
        f"user_message='{(request.user_message or '')[:120]}' "
        f"image_b64_chars={len(request.image_base64) if request.image_base64 else 0} "
        f"brand_id={request.brand_id or '(none)'}"
    )
    try:
        # 1. Resize image once on the way in (smaller payload to the model).
        resized_b64_for_model: Optional[str] = None
        if request.image_base64:
            # Stash the FULL-resolution image in the external store so tools
            # (edit / make-compliant / generate-variation) can operate on it.
            design_set_image(img_key, request.image_base64)
            resized_bytes = resize_image_b64(request.image_base64, max_size=256)
            resized_b64_for_model = base64.b64encode(resized_bytes).decode("utf-8")

        brand_style = BRAND_STYLES.get(request.brand_id, {})

        # 2. Build text-only history (no images) from prior turns.
        prior = DESIGN_CHAT_HISTORY.get(request.session_id, [])
        history = [
            {"role": turn["role"], "text": turn["text"]}
            for turn in prior[-MAX_HISTORY_TURNS:]
        ]

        # 3. Run Lux. The agent uses our DesignRunContext to read brand /
        #    product / image-key state inside each tool call.
        result = await run_design_agent(
            user_message=request.user_message,
            product_context=request.product_context,
            brand_style=brand_style,
            image_base64=resized_b64_for_model,
            history=history,
            image_key=img_key,
        )

        response_text: str = result.get("response", "") or ""
        action_data: Optional[Dict[str, Any]] = result.get("action")

        # 4. If a tool wrote a new image into the external store, attach it.
        result_image_b64 = design_get_image(img_key)
        original_image_b64 = request.image_base64 or ""
        image_was_modified = bool(
            result_image_b64 and result_image_b64 != original_image_b64
        )
        if image_was_modified:
            if action_data is None:
                action_data = {}
            action_data["image_base64"] = result_image_b64
            print(
                f"[design-companion] Image modified by tool — "
                f"attaching {len(result_image_b64):,} chars to response"
            )
        else:
            print(
                f"[design-companion] Image unchanged "
                f"(action={action_data.get('action') if action_data else None})"
            )

        # 5. Persist text-only turns for next request's context window.
        if request.session_id not in DESIGN_CHAT_HISTORY:
            DESIGN_CHAT_HISTORY[request.session_id] = []
        DESIGN_CHAT_HISTORY[request.session_id].append(
            {"role": "user", "text": request.user_message}
        )
        if response_text:
            DESIGN_CHAT_HISTORY[request.session_id].append(
                {"role": "assistant", "text": response_text[:500]}
            )
        DESIGN_CHAT_HISTORY[request.session_id] = DESIGN_CHAT_HISTORY[
            request.session_id
        ][-MAX_HISTORY_TURNS:]

        _img_b64_out = (action_data or {}).get("image_base64") if isinstance(action_data, dict) else None
        print(
            f"[design-companion] out: action={(action_data or {}).get('action') if isinstance(action_data, dict) else None} "
            f"response_chars={len(response_text)} "
            f"image_returned={'yes ('+str(len(_img_b64_out))+'ch)' if _img_b64_out else 'no'} "
            f"elapsed={time.time()-_t_start:.1f}s"
        )
        return {
            "success": True,
            "response": response_text,
            "action": action_data,
        }

    except Exception as e:
        print(f"[Design Companion] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always free the external image slot.
        try:
            design_clear_image(img_key)
        except Exception:
            pass


# --------------------------------------------------------------------------
# Direct Image Edit — bypasses the agent layer for fast image edits (1 API call vs 3)
# --------------------------------------------------------------------------

class DirectEditRequest(BaseModel):
    image_base64: str
    edit_instruction: str


@app.post("/direct-edit-image")
async def direct_edit_image(request: DirectEditRequest):
    """Edit a product image directly without going through the agent layer.

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
        # 1. Build the prompt and run a one-shot OpenAI agent for spec extraction.
        ctx = json.dumps(request.product_context, default=str)
        analysis_prompt = (
            "You are a fashion design specification engine. "
            "The IMAGE is the SINGLE SOURCE OF TRUTH for colours, materials, "
            "details, and inspiration. The product context below is historical "
            "metadata — it may be stale (e.g. an older palette). If anything in "
            "the context conflicts with what you see in the image, ignore the "
            "context and report what is actually in the image.\n\n"
            "Return ONLY a JSON object (no markdown, no explanation) with this exact structure:\n"
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

        # Resize image once for the model. 384 px keeps analysis cost low
        # while preserving enough fidelity for accurate colour extraction —
        # 256 px was muddying subtle palette swaps.
        resized_b64: Optional[str] = None
        if request.image_base64:
            resized_bytes = resize_image_b64(request.image_base64, max_size=384)
            resized_b64 = base64.b64encode(resized_bytes).decode("utf-8")

        response_text = await analyze_image_to_specs(
            analysis_prompt=analysis_prompt,
            image_base64=resized_b64,
        )

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
    """WebSocket proxy to standalone voice companion service.

    The voice service (Node.js, port 8002, OpenAI Realtime) emits both:
      • text frames (JSON events: transcripts, tool results, image_updated)
      • binary frames (raw 24 kHz PCM16 audio for direct playback)
    Forward each accordingly so the frontend protocol stays identical whether
    it connects directly to :8002 or via this proxy.
    """
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
                        # `websockets` returns str for text frames and bytes for binary
                        if isinstance(message, (bytes, bytearray, memoryview)):
                            await websocket.send_bytes(bytes(message))
                        else:
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


class TechPackMiroRequest(BaseModel):
    product: Dict[str, Any]
    techpack: Optional[Dict[str, Any]] = None  # Saved techpack from DB (single source of truth)
    brand_name: str = ""
    miro_url: str = ""  # Full board URL, e.g. https://miro.com/app/board/<board_id>/
    board_id: str = ""  # Optional direct board id override
    x: float = 0
    y: float = 0


class TechPackMiroBoardRequest(BaseModel):
    product: Dict[str, Any]
    techpack: Optional[Dict[str, Any]] = None  # Saved techpack from DB (single source of truth)
    brand_name: str = ""
    board_name: str = ""
    x: float = 0
    y: float = 0


def _extract_miro_board_id(miro_url: str) -> str:
    """Extract board id from a Miro board URL."""
    if not miro_url:
        return ""
    match = re.search(r"/board/([^/?#]+)", miro_url)
    if not match:
        return ""
    return unquote(match.group(1))


def _to_markdown_lines(value: Any, indent: int = 0) -> List[str]:
    prefix = "  " * indent
    if value is None:
        return [f"{prefix}- N/A"]
    if isinstance(value, dict):
        lines: List[str] = []
        for key, sub_val in value.items():
            label = str(key).replace("_", " ").strip().title()
            if isinstance(sub_val, (dict, list)):
                lines.append(f"{prefix}- **{label}**:")
                lines.extend(_to_markdown_lines(sub_val, indent + 1))
            else:
                lines.append(f"{prefix}- **{label}**: {sub_val}")
        return lines if lines else [f"{prefix}- N/A"]
    if isinstance(value, list):
        if not value:
            return [f"{prefix}- N/A"]
        lines: List[str] = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                lines.extend(_to_markdown_lines(item, indent + 1))
            else:
                lines.append(f"{prefix}- {item}")
        return lines
    return [f"{prefix}- {value}"]


def _extract_hex_color(value: Any) -> str:
    if value is None:
        return ""
    match = re.search(r"#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})\b", str(value))
    if not match:
        return ""
    raw = match.group(1).upper()
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    return f"#{raw}"


def _extract_palette(product: Dict[str, Any], merged: Dict[str, Any]) -> List[Dict[str, str]]:
    palette: List[Dict[str, str]] = []
    seen = set()

    raw_palette = product.get("color_palette")
    if isinstance(raw_palette, list):
        for idx, entry in enumerate(raw_palette):
            if isinstance(entry, dict):
                name = str(entry.get("name", "")).strip() or f"Color {idx + 1}"
                hex_color = _extract_hex_color(entry.get("hex") or entry.get("value"))
            else:
                name = str(entry).strip() or f"Color {idx + 1}"
                hex_color = _extract_hex_color(entry)
            if not hex_color:
                continue
            key = (name.lower(), hex_color)
            if key in seen:
                continue
            seen.add(key)
            palette.append({"name": name, "hex": hex_color})

    if not palette:
        colors_text = str(merged.get("colors", "") or "")
        # Matches entries like: "Powder Pink (#F2E0E6)"
        for m in re.finditer(r"([^,]+?)\s*\((#[0-9A-Fa-f]{3,6})\)", colors_text):
            name = m.group(1).strip()
            hex_color = _extract_hex_color(m.group(2))
            if not hex_color:
                continue
            key = (name.lower(), hex_color)
            if key in seen:
                continue
            seen.add(key)
            palette.append({"name": name, "hex": hex_color})

    return palette[:8]


def _build_techpack_markdown(product: Dict[str, Any], techpack: Dict[str, Any], brand_name: str = "") -> str:
    """Build Miro-doc markdown from the same merged data used for PDF generation."""
    merged = get_merged_techpack_data(product, techpack)
    product_name = merged.get("name") or product.get("name") or "Product"
    sku = merged.get("sku") or product.get("sku") or "N/A"
    brand_label = brand_name or "TrendSync Brand Factory"
    palette = _extract_palette(product, merged)
    image_url = str(product.get("image_url", "") or "").strip()
    video_url = str(product.get("video_url", "") or "").strip()
    has_image_url = image_url.startswith("http://") or image_url.startswith("https://")
    has_video_url = video_url.startswith("http://") or video_url.startswith("https://")

    lines: List[str] = [
        f"# Tech Pack - {product_name}",
        "",
        "## Metadata",
        f"- **Brand:** {brand_label}",
        f"- **SKU:** {sku}",
        f"- **Generated:** {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        "",
        "## Product Overview",
    ]

    color_summary = merged.get("colors", "N/A")
    if palette:
        color_summary = ", ".join(f"{p['name']} ({p['hex']})" for p in palette)

    lines.extend(_to_markdown_lines({
        "Category": merged.get("category", "N/A"),
        "Subcategory": merged.get("subcategory", "N/A"),
        "Price Tier": merged.get("price_tier", "N/A"),
        "Target Persona": merged.get("target_persona", "N/A"),
        "Season": merged.get("season", "Current"),
        "Colors": color_summary,
        "Silhouette": merged.get("silhouette", "N/A"),
        "Fit": merged.get("fit", "N/A"),
    }))

    lines.append("")
    lines.append("## Color Palette")
    if palette:
        for entry in palette:
            lines.append(f"- **{entry['name']}**: `{entry['hex']}`")
        lines.append("")
        lines.append("_Color swatches are also added as square board items next to this doc._")
    else:
        lines.append("- N/A")

    lines.append("")
    lines.append("## Media")
    if has_image_url:
        lines.append(f"- **Product Image:** [Open image]({image_url})")
        lines.append("")
        lines.append(f"![Product Image]({image_url})")
    else:
        lines.append("- **Product Image:** N/A")
    if has_video_url:
        lines.append(f"- **Video URL:** [Open video]({video_url})")
    else:
        lines.append("- **Video URL:** N/A")

    section_map = [
        ("Fabric & Materials", merged.get("fabric_details", {})),
        ("Measurements", merged.get("measurements", {})),
        ("Graphics & Details", merged.get("graphics_and_prints", {})),
        ("Adornments & Hardware", merged.get("adornments", {})),
        ("Construction Process", merged.get("construction", {})),
        ("Quality Control", merged.get("quality_control", {})),
        ("Packaging & Shipping", merged.get("packaging", {})),
    ]

    for title, content in section_map:
        lines.append("")
        lines.append(f"## {title}")
        lines.extend(_to_markdown_lines(content))

    return "\n".join(lines).strip()


def _create_miro_doc_item(
    access_token: str,
    board_id: str,
    markdown: str,
    x: float = 0,
    y: float = 0,
) -> Dict[str, Any]:
    """Create a Miro doc item on an existing board."""
    encoded_board_id = quote(board_id, safe="")
    miro_api_url = f"https://api.miro.com/v2/boards/{encoded_board_id}/docs"
    payload = {
        "data": {
            "contentType": "markdown",
            "content": markdown,
        },
        "position": {
            "x": x,
            "y": y,
        },
    }

    import requests as _requests
    resp = _requests.post(
        miro_api_url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=30,
    )
    if resp.status_code < 200 or resp.status_code >= 300:
        detail = f"Miro API {resp.status_code}: {resp.text[:1000]}"
        raise HTTPException(status_code=502, detail=detail)
    return resp.json()


def _safe_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _compute_doc_layout_anchor(
    doc_item: Dict[str, Any],
    fallback_x: float,
    fallback_y: float,
) -> Dict[str, float]:
    """Compute top/right doc anchor from created doc geometry and position.

    Miro doc_format responses may omit geometry; in that case, approximate
    using doc center and tuned offsets so palette starts near the doc container top.
    """
    position = doc_item.get("position") or {}
    geometry = doc_item.get("geometry") or {}
    center_x = _safe_float(position.get("x"), fallback_x)
    center_y = _safe_float(position.get("y"), fallback_y)
    width_raw = geometry.get("width")
    height_raw = geometry.get("height")
    width = max(800.0, _safe_float(width_raw, 1400.0))
    height = _safe_float(height_raw, 0.0)

    if height > 0:
        top_y = center_y - (height / 2.0)
    else:
        # No height available: align near the visible top of the doc container.
        top_y = center_y + 40.0

    return {
        "center_x": center_x,
        "center_y": center_y,
        "right_x": center_x + (width / 2.0),
        "top_y": top_y,
    }


def _create_miro_palette_swatches(
    access_token: str,
    board_id: str,
    palette: List[Dict[str, str]],
    doc_right_x: float,
    doc_top_y: float,
) -> List[str]:
    """Create color-square swatches plus labels on board. Best effort."""
    if not palette:
        return []

    import requests as _requests
    encoded_board_id = quote(board_id, safe="")
    shape_url = f"https://api.miro.com/v2/boards/{encoded_board_id}/shapes"
    text_url = f"https://api.miro.com/v2/boards/{encoded_board_id}/texts"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    created_ids: List[str] = []
    square_size = 52
    spacing = 28
    start_x = doc_right_x + 200
    start_y = doc_top_y + 60

    for idx, color in enumerate(palette):
        y = start_y + idx * (square_size + spacing)
        square_payload = {
            "data": {"shape": "rectangle", "content": ""},
            "style": {
                "fillColor": color["hex"],
                "fillOpacity": 1,
                "borderColor": "#CBD5E1",
                "borderWidth": 1,
            },
            "geometry": {"width": square_size, "height": square_size},
            "position": {"x": start_x, "y": y},
        }
        sq = _requests.post(shape_url, headers=headers, data=json.dumps(square_payload), timeout=20)
        if sq.status_code >= 200 and sq.status_code < 300:
            square_id = sq.json().get("id")
            if square_id:
                created_ids.append(square_id)

        label_payload = {
            "data": {"content": f"<p><strong>{color['name']}</strong> {color['hex']}</p>"},
            "position": {"x": start_x + 210, "y": y},
            "geometry": {"width": 320},
        }
        lb = _requests.post(text_url, headers=headers, data=json.dumps(label_payload), timeout=20)
        if lb.status_code >= 200 and lb.status_code < 300:
            label_id = lb.json().get("id")
            if label_id:
                created_ids.append(label_id)

    return created_ids


def _create_miro_product_image_item(
    access_token: str,
    board_id: str,
    image_url: str,
    doc_right_x: float,
    doc_top_y: float,
) -> Optional[str]:
    """Create image item from URL on board. Best effort."""
    if not image_url.startswith("http://") and not image_url.startswith("https://"):
        return None

    import requests as _requests
    encoded_board_id = quote(board_id, safe="")
    url = f"https://api.miro.com/v2/boards/{encoded_board_id}/images"
    payload = {
        "data": {"url": image_url},
        "position": {"x": doc_right_x + 380, "y": doc_top_y + 700},
        "geometry": {"width": 340},
    }
    resp = _requests.post(
        url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=25,
    )
    if resp.status_code >= 200 and resp.status_code < 300:
        return resp.json().get("id")
    return None


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


@app.post("/generate-techpack-docx")
async def gen_techpack_docx(request: TechPackPDFRequest):
    """Generate a professional tech pack DOCX.

    Uses the same saved techpack payload as the PDF endpoint so exported formats
    stay consistent with what the user sees in the UI.
    """
    try:
        if request.techpack:
            techpack_data = request.techpack
            print(f"[Foxit] Using saved techpack from DB for DOCX: {request.product.get('name', '?')}")
        else:
            raise HTTPException(
                status_code=400,
                detail="Tech pack has not been generated yet. Please go to the Tech Pack tab first to generate and save it before downloading the DOCX.",
            )

        docx_bytes = generate_techpack_docx(
            product=request.product,
            techpack=techpack_data,
            brand_name=request.brand_name,
        )

        return {
            "success": True,
            "docx_base64": base64.b64encode(docx_bytes).decode("utf-8"),
            "techpack": techpack_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Foxit] Tech pack DOCX generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/send-techpack-to-miro")
async def send_techpack_to_miro(request: TechPackMiroRequest):
    """Create a Miro Doc containing the tech pack using the same saved payload as PDF export."""
    try:
        if request.techpack:
            techpack_data = request.techpack
            print(f"[Miro] Using saved techpack from DB for: {request.product.get('name', '?')}")
        else:
            raise HTTPException(
                status_code=400,
                detail="Tech pack has not been generated yet. Please go to the Tech Pack tab first to generate and save it before sending to Miro.",
            )

        access_token = os.getenv("MIRO_ACCESS_TOKEN", "").strip()
        if not access_token:
            raise HTTPException(
                status_code=500,
                detail="MIRO_ACCESS_TOKEN is not configured on the backend.",
            )

        board_id = request.board_id.strip() or _extract_miro_board_id(request.miro_url.strip())
        if not board_id:
            board_id = os.getenv("MIRO_BOARD_ID", "").strip()
        if not board_id:
            raise HTTPException(
                status_code=400,
                detail="Missing board target. Provide a Miro board URL or board_id.",
            )

        markdown = _build_techpack_markdown(
            product=request.product,
            techpack=techpack_data,
            brand_name=request.brand_name,
        )

        body = _create_miro_doc_item(
            access_token=access_token,
            board_id=board_id,
            markdown=markdown,
            x=request.x,
            y=request.y,
        )
        doc_layout = _compute_doc_layout_anchor(body, request.x, request.y)
        item_id = body.get("id", "")
        doc_url = f"https://miro.com/app/board/{board_id}/"
        if item_id:
            doc_url = f"{doc_url}?moveToWidget={item_id}&cot=14"

        # Optional visual enhancements: color swatches and product image.
        swatch_ids: List[str] = []
        image_item_id: Optional[str] = None
        try:
            merged = get_merged_techpack_data(request.product, techpack_data)
            palette = _extract_palette(request.product, merged)
            swatch_ids = _create_miro_palette_swatches(
                access_token=access_token,
                board_id=board_id,
                palette=palette,
                doc_right_x=doc_layout["right_x"],
                doc_top_y=doc_layout["top_y"],
            )
            image_url = str(request.product.get("image_url", "") or "").strip()
            image_item_id = _create_miro_product_image_item(
                access_token=access_token,
                board_id=board_id,
                image_url=image_url,
                doc_right_x=doc_layout["right_x"],
                doc_top_y=doc_layout["top_y"],
            )
        except Exception as media_err:
            print(f"[Miro] Optional visual item creation skipped: {media_err}")

        return {
            "success": True,
            "board_id": board_id,
            "item_id": item_id,
            "doc_url": doc_url,
            "swatch_item_ids": swatch_ids,
            "image_item_id": image_item_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Miro] Send techpack failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/create-techpack-miro-board")
async def create_techpack_miro_board(request: TechPackMiroBoardRequest):
    """Create a new Miro board for the tech pack and return board/doc links."""
    try:
        if request.techpack:
            techpack_data = request.techpack
            print(f"[Miro] Using saved techpack from DB for board creation: {request.product.get('name', '?')}")
        else:
            raise HTTPException(
                status_code=400,
                detail="Tech pack has not been generated yet. Please go to the Tech Pack tab first to generate and save it before sending to Miro.",
            )

        access_token = os.getenv("MIRO_ACCESS_TOKEN", "").strip()
        if not access_token:
            raise HTTPException(status_code=500, detail="MIRO_ACCESS_TOKEN is not configured on the backend.")

        team_id = os.getenv("MIRO_TEAM_ID", "").strip()
        if not team_id:
            raise HTTPException(status_code=500, detail="MIRO_TEAM_ID is not configured on the backend.")

        product_name = str(request.product.get("name", "Product")).strip() or "Product"
        default_board_name = f"Tech Pack - {product_name}"
        board_name = (request.board_name or "").strip() or default_board_name

        import requests as _requests
        board_resp = _requests.post(
            "https://api.miro.com/v2/boards",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            data=json.dumps({
                "name": board_name[:60],
                "description": "Auto-created from TrendSync Tech Pack",
                "teamId": team_id,
            }),
            timeout=30,
        )
        if board_resp.status_code < 200 or board_resp.status_code >= 300:
            detail = f"Miro API {board_resp.status_code}: {board_resp.text[:1000]}"
            raise HTTPException(status_code=502, detail=detail)

        board_body = board_resp.json()
        board_id = board_body.get("id", "")
        view_link = board_body.get("viewLink") or f"https://miro.com/app/board/{board_id}/"
        if not board_id:
            raise HTTPException(status_code=502, detail="Miro create board response missing board id.")

        markdown = _build_techpack_markdown(
            product=request.product,
            techpack=techpack_data,
            brand_name=request.brand_name,
        )
        doc_body = _create_miro_doc_item(
            access_token=access_token,
            board_id=board_id,
            markdown=markdown,
            x=request.x,
            y=request.y,
        )
        doc_layout = _compute_doc_layout_anchor(doc_body, request.x, request.y)

        item_id = doc_body.get("id", "")
        doc_url = f"https://miro.com/app/board/{board_id}/"
        if item_id:
            doc_url = f"{doc_url}?moveToWidget={item_id}&cot=14"

        swatch_ids: List[str] = []
        image_item_id: Optional[str] = None
        try:
            merged = get_merged_techpack_data(request.product, techpack_data)
            palette = _extract_palette(request.product, merged)
            swatch_ids = _create_miro_palette_swatches(
                access_token=access_token,
                board_id=board_id,
                palette=palette,
                doc_right_x=doc_layout["right_x"],
                doc_top_y=doc_layout["top_y"],
            )
            image_url = str(request.product.get("image_url", "") or "").strip()
            image_item_id = _create_miro_product_image_item(
                access_token=access_token,
                board_id=board_id,
                image_url=image_url,
                doc_right_x=doc_layout["right_x"],
                doc_top_y=doc_layout["top_y"],
            )
        except Exception as media_err:
            print(f"[Miro] Optional visual item creation skipped: {media_err}")

        return {
            "success": True,
            "board_id": board_id,
            "board_url": view_link,
            "item_id": item_id,
            "doc_url": doc_url,
            "swatch_item_ids": swatch_ids,
            "image_item_id": image_item_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Miro] Create board failed: {e}")
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
