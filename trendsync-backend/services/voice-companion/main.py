"""
TrendSync Voice Design Companion Service
A voice-controlled design assistant using Google ADK with Gemini Live.

Tool logic for the 7 shared tools lives in shared/design_tools.py —
the SAME code used by the typing agent (design_agent.py).
Voice-only tools (ad video, navigation, collection gen) remain here.
Port 8002.
"""

import os
import sys
import json
import asyncio
import logging
import time
import httpx
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
except Exception:
    pass

# Allow imports from shared/
sys.path.append(os.path.join(os.path.dirname(__file__), "../.."))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google.genai import types
from google.adk.agents import Agent
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

from shared import design_tools

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

VOICE_MODEL = os.environ.get("VOICE_MODEL", "gemini-live-2.5-flash-native-audio")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
MAIN_BACKEND_URL = os.environ.get("MAIN_BACKEND_URL", "http://localhost:8000")

# Voice model needs us-central1 specifically; shared modules use global (from env).
# Shared modules (image_generator, trend_engine, etc.) already captured their LOCATION
# at import time above, so overriding os.environ HERE is safe — it only affects the
# ADK Runner which reads it when creating its internal Vertex AI client.
VOICE_LOCATION = "us-central1"
os.environ["GOOGLE_CLOUD_LOCATION"] = VOICE_LOCATION

# Module-level state for product context (voice tools are plain functions, no ToolContext)
_voice_sessions: dict[str, dict] = {}
# Pending images from tool calls — picked up by the downstream WS loop and sent to the frontend
_pending_images: dict[str, list[dict]] = {}  # session_id → list of {image_base64, ...}
# Pending status messages for the frontend — tool_started / tool_completed
_pending_status: dict[str, list[dict]] = {}  # session_id → list of {tool, status, message}

# Tool call deduplication — prevents duplicate execution when LLM re-issues slow tools
_tool_cache: dict[str, tuple[float, dict]] = {}  # "tool:key" → (timestamp, result)
_DEDUP_TTL = 30  # seconds — cache tool results for this long

def _dedup_get(tool_name: str, key: str) -> dict | None:
    """Return cached tool result if within TTL, else None."""
    cache_key = f"{tool_name}:{key}"
    if cache_key in _tool_cache:
        ts, result = _tool_cache[cache_key]
        if time.time() - ts < _DEDUP_TTL:
            logger.info(f"[DEDUP] Returning cached result for {cache_key}")
            return result
        del _tool_cache[cache_key]
    return None

def _dedup_set(tool_name: str, key: str, result: dict) -> None:
    """Cache a tool result for deduplication."""
    _tool_cache[f"{tool_name}:{key}"] = (time.time(), result)

# Shared async HTTP client (for voice-only tools that still need HTTP)
_http_client: httpx.AsyncClient | None = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    return _http_client

logger.info(f"[Voice Companion] Starting: location={VOICE_LOCATION}, model={VOICE_MODEL}")
logger.info(f"[Voice Companion] Main backend at: {MAIN_BACKEND_URL}")

app = FastAPI(title="TrendSync Voice Design Companion")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================================================
# Helpers
# ==========================================================================

def _get_session_data() -> dict:
    """Get the most recent voice session's data."""
    for sid, sdata in _voice_sessions.items():
        if sdata:
            return sdata
    return {}


def _queue_status(tool_name: str, status: str, message: str) -> None:
    """Queue a status update to be sent to the frontend via WebSocket."""
    for sid in _voice_sessions:
        _pending_status.setdefault(sid, []).append({
            "tool": tool_name,
            "status": status,
            "message": message,
        })
    logger.info("[Voice] Status queued: %s → %s (%s)", tool_name, status, message)


def _queue_image_for_frontend(session_data: dict, image_base64: str, **extra: Any) -> None:
    """Queue an edited/generated image to be sent to the frontend via WebSocket."""
    session_data["image_base64"] = image_base64
    for sid, sdata in _voice_sessions.items():
        if sdata is session_data:
            _pending_images.setdefault(sid, []).append({
                "image_base64": image_base64,
                **extra,
            })
            break
    logger.info("[Voice] Image queued for frontend (%d chars base64)", len(image_base64))


# ==========================================================================
# SHARED TOOL WRAPPERS — call shared/design_tools.py directly
# Uses asyncio.to_thread() so sync Gemini calls don't block the event loop.
# ==========================================================================

async def analyze_product_image(question: str) -> dict:
    """
    Analyze the current product image visually and give specific design feedback.
    Call this when the user asks for opinions, suggestions, or creative direction
    about the product they are currently viewing.
    This tool can SEE the actual product image and comment on specific visual details
    like colors, fabric texture, silhouette, proportions, stitching, and overall aesthetic.
    Examples: 'What do you think of this design?', 'How can I improve this?',
    'Describe what you see', 'What color palette works here?', 'What would look good with this?'
    """
    logger.info(f"[TOOL: analyze_product_image] question='{question}'")

    cached = _dedup_get("analyze", question)
    if cached:
        return cached

    session_data = _get_session_data()
    has_image = bool(session_data.get("image_base64"))

    product_context = {
        "name": session_data.get("product_name", ""),
        "category": session_data.get("product_category", ""),
        "subcategory": session_data.get("product_subcategory", ""),
        "colors": session_data.get("product_colors", []),
        "materials": session_data.get("product_materials", []),
    }
    brand_style = session_data.get("brand_style", {})

    _queue_status("analyze_product_image", "started", "Analyzing product image...")
    result = design_tools.analyze_product(question, has_image, product_context, brand_style)
    _queue_status("analyze_product_image", "completed", "Analysis complete")
    _dedup_set("analyze", question, result)
    return result


async def edit_product_image(edit_instruction: str) -> dict:
    """
    Edit the current product image with a specific change.
    Call this when the user wants to modify the existing image.
    Examples: 'Make the collar wider', 'Change the color to navy blue',
    'Add a belt', 'Make it shorter', 'Change the fabric texture to linen'
    """
    logger.info(f"[TOOL: edit_product_image] instruction='{edit_instruction}'")

    cached = _dedup_get("edit", edit_instruction)
    if cached:
        return cached

    session_data = _get_session_data()
    image_base64 = session_data.get("image_base64", "")

    if not image_base64:
        return {
            "action": "image_updated",
            "status": "error",
            "message": "No product image available to edit. Please make sure you're viewing a product.",
        }

    _queue_status("edit_product_image", "started", f"Editing image: {edit_instruction[:60]}...")
    new_b64, result = await asyncio.to_thread(design_tools.edit_image, edit_instruction, image_base64)
    _queue_status("edit_product_image", "completed", "Image edit complete")

    if new_b64:
        _queue_image_for_frontend(session_data, new_b64, edit_instruction=edit_instruction)
        result["has_new_image"] = True

    _dedup_set("edit", edit_instruction, result)
    return result


async def make_brand_compliant() -> dict:
    """
    Automatically adjust the product image to match brand guidelines.
    Call this when the user asks to make the design on-brand or brand-compliant.
    Examples: 'Make it brand compliant', 'Align with our brand colors',
    'Apply brand guidelines', 'Fix brand compliance'
    """
    logger.info("[TOOL: make_brand_compliant]")

    cached = _dedup_get("comply", "brand")
    if cached:
        return cached

    session_data = _get_session_data()
    image_base64 = session_data.get("image_base64", "")
    brand_style = session_data.get("brand_style", {})
    product_context = {
        "name": session_data.get("product_name", ""),
        "category": session_data.get("product_category", ""),
    }

    _queue_status("make_brand_compliant", "started", "Adjusting for brand compliance...")
    new_b64, result = await asyncio.to_thread(
        design_tools.make_compliant, image_base64, brand_style, product_context
    )
    _queue_status("make_brand_compliant", "completed", "Brand compliance adjustment complete")

    if new_b64:
        _queue_image_for_frontend(
            session_data, new_b64,
            compliance_score=result.get("compliance_score"),
        )
        result["has_new_image"] = True

    _dedup_set("comply", "brand", result)
    return result


async def fetch_trend_data(query: str, season: str = "", region: str = "global", demographic: str = "millennials") -> dict:
    """
    Fetch current real-time fashion trend data using Google Search grounding.
    Call this when the user asks about what's trending, popular colors, materials, or styles.
    Examples: 'What colors are trending?', 'Show me spring trends for Gen Z',
    'What materials are popular in Europe right now?'
    """
    logger.info(f"[TOOL: fetch_trend_data] query='{query}', season={season}, region={region}")

    cached = _dedup_get("trends", query)
    if cached:
        return cached

    _queue_status("fetch_trend_data", "started", "Fetching latest trends...")
    result = await asyncio.to_thread(design_tools.get_trends, query, season, region, demographic)
    _queue_status("fetch_trend_data", "completed", "Trends loaded")
    _dedup_set("trends", query, result)
    return result


async def validate_brand_compliance(product_description: str = "", color_scheme: str = "") -> dict:
    """
    Check how well a product design complies with brand guidelines.
    Call this when the user asks about brand compliance, validation, or guideline checks.
    Examples: 'Check if this is on-brand', 'What's the compliance score?',
    'Does this pass brand guidelines?', 'Validate this design'
    """
    logger.info(f"[TOOL: validate_brand_compliance] desc='{product_description[:50] if product_description else ''}'")

    session_data = _get_session_data()
    brand_style = session_data.get("brand_style", {})

    result = await asyncio.to_thread(
        design_tools.check_compliance, product_description, color_scheme, brand_style
    )
    return result


async def generate_image_variation(variation_description: str, category: str = "apparel") -> dict:
    """
    Generate a completely new product image from scratch based on a description.
    Call this when the user wants a new variation or a fresh image, not an edit.
    Examples: 'Generate a version in silk', 'Create a new variation with wider sleeves',
    'Show me what this would look like as a maxi dress'
    """
    logger.info(f"[TOOL: generate_image_variation] desc='{variation_description}'")

    cached = _dedup_get("variation", variation_description)
    if cached:
        return cached

    session_data = _get_session_data()
    brand_style = session_data.get("brand_style", {})

    _queue_status("generate_image_variation", "started", "Generating new image variation...")
    new_b64, result = await asyncio.to_thread(
        design_tools.generate_variation, variation_description, category, brand_style
    )
    _queue_status("generate_image_variation", "completed", "Image variation ready")

    if new_b64:
        _queue_image_for_frontend(session_data, new_b64, description=variation_description)
        result["has_new_image"] = True

    _dedup_set("variation", variation_description, result)
    return result


def save_design() -> dict:
    """
    Save the current design modifications to the collection.
    Call this when the user says they want to save, keep, or finalize the current design.
    Examples: 'Save this design', 'Keep this version', 'I like it, save it',
    'Save my changes', 'Let's go with this one'
    """
    logger.info("[TOOL: save_design]")
    session_data = _get_session_data()
    product_name = session_data.get("product_name", "this product")
    return design_tools.save_design_signal(product_name)


# ==========================================================================
# VOICE-ONLY TOOLS — these don't exist in the typing agent
# They still use HTTP because they call endpoints that manage their own state.
# ==========================================================================

async def generate_ad_video(campaign_brief: str, ad_style: str = "cinematic") -> dict:
    """
    Execute ad video generation by calling the ad video endpoint.
    The voice agent calls this when the user says:
    'Create an ad video for summer campaign', 'Generate a cinematic product ad',
    'Make a video advertisement', 'I need a promotional video'

    This calls POST /generate-ad-video on the main backend (which starts a background task).
    """
    logger.info(f"[TOOL: generate_ad_video] brief='{campaign_brief}', style='{ad_style}'")

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/generate-ad-video",
            json={
                "product": {"name": "Current product", "description": campaign_brief},
                "brand_id": "default",
                "campaign_brief": campaign_brief,
                "ad_style": ad_style,
            },
        )

        if response.status_code == 200:
            result = response.json()
            ad_id = result.get("ad_id", "")

            return {
                "action": "generate_ad_video",
                "status": "started",
                "ad_id": ad_id,
                "campaign_brief": campaign_brief,
                "ad_style": ad_style,
                "message": (
                    f"I've started generating your {ad_style} ad video for: '{campaign_brief}'. "
                    f"This will take a few minutes. The video ID is {ad_id} — "
                    f"I'll let you know when it's ready, or you can check the Video Ad tab."
                ),
            }
        else:
            return {
                "action": "generate_ad_video",
                "status": "error",
                "message": "Could not start video generation. Please try again.",
            }
    except Exception as e:
        logger.error(f"[TOOL: generate_ad_video] Error: {e}")
        return {
            "action": "generate_ad_video",
            "status": "error",
            "message": f"Video generation failed: {str(e)}",
        }


def navigate_to_page(page_name: str) -> dict:
    """
    Navigate the user to a specific page in the app.
    The voice agent calls this when the user says:
    'Go to trends', 'Open brand editor', 'Show me the collection', 'Take me to settings'
    """
    logger.info(f"[TOOL: navigate_to_page] page='{page_name}'")

    page_map = {
        "dashboard": "/dashboard",
        "brand style": "/brand-style",
        "brand editor": "/brand-style",
        "brand guardian": "/brand-guardian",
        "validation": "/brand-guardian",
        "collection": "/collection",
        "collections": "/collection",
        "trends": "/trends",
        "trend intelligence": "/trends",
        "settings": "/settings",
    }

    page_lower = page_name.lower().strip()
    route = page_map.get(page_lower, None)

    if route:
        return {
            "action": "navigate",
            "status": "success",
            "page": page_name,
            "route": route,
            "message": f"Navigating to {page_name}.",
        }
    else:
        return {
            "action": "navigate",
            "status": "unknown_page",
            "page": page_name,
            "available_pages": list(page_map.keys()),
            "message": f"I don't recognize '{page_name}'. Available pages are: {', '.join(page_map.keys())}.",
        }


async def start_collection_generation(
    season: str = "",
    region: str = "Global",
    demographic: str = "Millennials",
    product_count: int = 6,
) -> dict:
    """
    Start generating a new fashion collection.
    The voice agent calls this when the user says:
    'Generate a new collection', 'Create a summer collection for Gen Z',
    'Start a new collection with 8 products'
    """
    logger.info(f"[TOOL: start_collection] season={season}, region={region}, count={product_count}")

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/generate-collection",
            json={
                "brand_id": "default",
                "season": season,
                "region": region,
                "demographic": demographic,
                "categories": ["tops", "bottoms", "dresses"],
                "product_count": product_count,
                "trend_source": "regional",
            },
        )

        if response.status_code == 200:
            result = response.json()
            collection_id = result.get("collection_id", "")

            return {
                "action": "start_collection",
                "status": "started",
                "collection_id": collection_id,
                "season": season,
                "region": region,
                "demographic": demographic,
                "product_count": product_count,
                "message": (
                    f"I've started generating a {season} collection for {demographic} in {region} "
                    f"with {product_count} products. Collection ID: {collection_id}. "
                    f"This will take a few minutes — I'll analyze trends, plan the collection, "
                    f"and generate images for each product."
                ),
            }
        else:
            return {
                "action": "start_collection",
                "status": "error",
                "message": "Could not start collection generation. Please try again.",
            }
    except Exception as e:
        logger.error(f"[TOOL: start_collection] Error: {e}")
        return {
            "action": "start_collection",
            "status": "error",
            "message": f"Collection generation failed: {str(e)}",
        }


# ==========================================================================
# Voice Instruction Builder
# ==========================================================================

def _build_instruction(context: dict) -> str:
    """Build the system instruction for the voice companion."""
    parts = [
        "You are the Voice Design Companion for TrendSync Brand Factory — an AI-powered fashion design studio.",
        "",
        "You are a REAL assistant that EXECUTES actions. When you call a tool, it runs immediately.",
        "Every tool you have connects to a live backend service and produces real results.",
        "",
        "=== YOUR TOOLS (ALL execute real actions) ===",
        "",
        "1. analyze_product_image(question)",
        "   → EXECUTES: Uses Gemini vision to SEE the actual product image",
        "   → Examples: 'What do you think?', 'How can I improve this?', 'Describe what you see'",
        "",
        "2. edit_product_image(edit_instruction)",
        "   → EXECUTES: Calls Gemini Flash Image to modify the product image",
        "   → Examples: 'Make the collar wider', 'Change the fabric to silk', 'Use a deeper blue'",
        "",
        "3. make_brand_compliant()",
        "   → EXECUTES: Automatically adjusts the product to match brand guidelines",
        "   → Examples: 'Make it brand compliant', 'Apply brand colors', 'Fix brand compliance'",
        "",
        "4. fetch_trend_data(query, season, region, demographic)",
        "   → EXECUTES: Calls Gemini + Google Search for REAL-TIME fashion trend data",
        "   → Examples: 'What colors are trending in EU?', 'Spring 2025 trends for Gen Z'",
        "",
        "5. validate_brand_compliance(product_description, color_scheme)",
        "   → EXECUTES: Runs the Brand Guardian to check brand compliance",
        "   → Examples: 'Does this pass brand guidelines?', 'Check compliance'",
        "",
        "6. generate_image_variation(variation_description, category)",
        "   → EXECUTES: Generates a completely new product image from a description",
        "   → Examples: 'Generate this dress in blue', 'Show me a silk version'",
        "",
        "7. save_design()",
        "   → EXECUTES: Saves the current design modifications to the collection",
        "   → Examples: 'Save this design', 'Keep this version', 'I like it, save it'",
        "",
        "8. generate_ad_video(campaign_brief, ad_style)",
        "   → EXECUTES: Starts Veo 3.1 video generation (multi-scene animated ad)",
        "   → Examples: 'Create a cinematic ad for summer launch', 'Make a product video'",
        "",
        "9. navigate_to_page(page_name)",
        "   → EXECUTES: Navigates the app to a specific page",
        "   → Examples: 'Go to trends', 'Open the brand editor', 'Show me collections'",
        "",
        "10. start_collection_generation(season, region, demographic, product_count)",
        "   → EXECUTES: Starts full collection generation (trends → planning → images)",
        "   → Examples: 'Generate a summer collection', 'Create 8 products for Gen Z'",
        "",
        "=== CURRENT CONTEXT ===",
    ]

    if context.get("product_name"):
        parts.append(f"Currently viewing product: {context['product_name']}")
    if context.get("product_description"):
        parts.append(f"Product description: {context['product_description']}")
    if context.get("collection_name"):
        parts.append(f"Current collection: {context['collection_name']}")
    if context.get("brand_name"):
        parts.append(f"Brand: {context['brand_name']}")
    if context.get("current_page"):
        parts.append(f"User is on page: {context['current_page']}")

    parts.extend([
        "",
        "=== BEHAVIOR RULES ===",
        "",
        "0. For design opinions, feedback, or 'what do you think?' — call analyze_product_image to SEE the product first",
        "1. ALWAYS call a tool when the user asks for an action — don't just describe what you would do",
        "2. After a tool returns, SUMMARIZE the result in a natural, conversational voice response",
        "3. If a tool returns trend data, READ OUT the key highlights (top 3 colors, top 2 styles)",
        "4. If a tool returns a compliance score, TELL the user the score and any critical issues",
        "5. If a tool starts a background process (video, collection), CONFIRM it started and give the ID",
        "6. Be warm, professional, and use fashion industry language naturally",
        "7. Keep voice responses concise — 2-3 sentences max per turn",
        "8. If unsure what the user wants, ask a clarifying question rather than guessing",
        "9. When chaining actions (e.g., 'validate then adjust'), execute them in sequence",
        "10. NEVER say 'I would call' or 'I can call' — just DO IT by calling the tool",
    ])

    return "\n".join(parts)


# ==========================================================================
# ADK Agent
# ==========================================================================

agent = Agent(
    name="voice_design_companion",
    model=VOICE_MODEL,
    tools=[
        analyze_product_image,
        edit_product_image,
        make_brand_compliant,
        fetch_trend_data,
        validate_brand_compliance,
        generate_image_variation,
        save_design,
        generate_ad_video,
        navigate_to_page,
        start_collection_generation,
    ],
    instruction=(
        "You are the Voice Design Companion for TrendSync Brand Factory. "
        "You EXECUTE real actions through tools — visual image analysis, image editing, brand compliance, "
        "trend queries, brand validation, image generation, video creation, navigation, and collection generation. "
        "When the user asks about the product image or wants design feedback, ALWAYS call analyze_product_image "
        "first so you can SEE the actual product and give specific visual feedback. "
        "Always call the appropriate tool when the user asks for an action."
    ),
    description=(
        "AI voice assistant that executes fashion design actions: "
        "analyzes designs visually, edits images, applies brand compliance, queries trends, "
        "validates designs, generates images and videos, navigates the app, and creates collections."
    ),
)


# ==========================================================================
# WebSocket Endpoint
# ==========================================================================

async def _fetch_brand_style(brand_id: str) -> dict:
    """Fetch brand style from main backend. Returns {} if not found."""
    if not brand_id:
        return {}
    try:
        client = _get_http_client()
        response = await client.get(f"{MAIN_BACKEND_URL}/brands/{brand_id}/style")
        if response.status_code == 200:
            data = response.json()
            return data.get("style", {})
    except Exception as e:
        logger.warning(f"[Voice] Could not fetch brand style for {brand_id}: {e}")
    return {}


@app.websocket("/ws/voice-companion/{session_id}")
async def voice_companion_endpoint(websocket: WebSocket, session_id: str) -> None:
    """Bidirectional streaming: mic audio → Gemini Live → tool execution → voice responses."""

    logger.info("[voice_companion] accept session_id=%s", session_id)
    await websocket.accept()

    if not hasattr(voice_companion_endpoint, "_session_service"):
        voice_companion_endpoint._session_service = InMemorySessionService()

    if not hasattr(voice_companion_endpoint, "_runner"):
        voice_companion_endpoint._runner = Runner(
            app_name="trendsync-voice-companion",
            agent=agent,
            session_service=voice_companion_endpoint._session_service,
        )

    runner: Runner = voice_companion_endpoint._runner
    session_service: InMemorySessionService = voice_companion_endpoint._session_service

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        session_resumption=types.SessionResumptionConfig(),
        # Prevent context overflow for long audio sessions (~25 tok/s audio)
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=types.SlidingWindow(target_tokens=80000),
        ),
    )

    live_request_queue = LiveRequestQueue()
    user_id = "web"

    session = await session_service.get_session(
        app_name=runner.app_name, user_id=user_id, session_id=session_id
    )
    if not session:
        await session_service.create_session(
            app_name=runner.app_name, user_id=user_id, session_id=session_id
        )

    started = False
    context: dict = {}
    session_ready = asyncio.Event()

    async def upstream_task() -> None:
        nonlocal started, context
        while True:
            try:
                message = await websocket.receive()
            except (WebSocketDisconnect, RuntimeError):
                logger.info("[voice_companion] upstream disconnected")
                return

            if "bytes" in message and message["bytes"] is not None:
                if not started:
                    continue
                audio_blob = types.Blob(mime_type="audio/pcm;rate=16000", data=message["bytes"])
                live_request_queue.send_realtime(audio_blob)
                continue

            if "text" in message and message["text"] is not None:
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    continue

                msg_type = payload.get("type")

                if msg_type == "start":
                    context = {
                        "product_name": payload.get("productName"),
                        "product_description": payload.get("productDescription"),
                        "collection_name": payload.get("collectionName"),
                        "brand_name": payload.get("brandName"),
                        "current_page": payload.get("currentPage"),
                    }

                    brand_id = payload.get("brandId", "")
                    brand_style = await _fetch_brand_style(brand_id)

                    # Store full product context for tools
                    _voice_sessions[session_id] = {
                        "image_base64": payload.get("productImageBase64", ""),
                        "product_name": payload.get("productName", ""),
                        "product_description": payload.get("productDescription", ""),
                        "product_category": payload.get("productCategory", ""),
                        "product_subcategory": payload.get("productSubcategory", ""),
                        "product_colors": payload.get("productColors", []),
                        "product_materials": payload.get("productMaterials", []),
                        "brand_id": brand_id,
                        "brand_name": payload.get("brandName", ""),
                        "brand_style": brand_style,
                    }
                    if _voice_sessions[session_id]["image_base64"]:
                        logger.info("[voice_companion] product image received (%d chars)", len(_voice_sessions[session_id]["image_base64"]))
                    if brand_style:
                        logger.info("[voice_companion] brand style loaded for %s", brand_id)
                    started = True
                    session_ready.set()
                    logger.info(
                        "[voice_companion] started session_id=%s context=%s",
                        session_id,
                        {k: v for k, v in context.items() if v},
                    )
                    try:
                        await websocket.send_text(json.dumps({"type": "ack", "event": "start"}))
                    except Exception:
                        pass
                    continue

                # Allow frontend to update context mid-session
                if msg_type == "update_context":
                    for key in ("product_name", "product_description", "collection_name", "brand_name", "current_page"):
                        if payload.get(key):
                            context[key] = payload[key]
                    # Update product context for tools
                    session_store = _voice_sessions.setdefault(session_id, {})
                    if payload.get("productImageBase64"):
                        session_store["image_base64"] = payload["productImageBase64"]
                        logger.info("[voice_companion] product image updated (%d chars)", len(payload["productImageBase64"]))
                    if payload.get("productName"):
                        session_store["product_name"] = payload["productName"]
                    if payload.get("productCategory"):
                        session_store["product_category"] = payload["productCategory"]
                    if payload.get("brandId"):
                        new_brand_id = payload["brandId"]
                        if new_brand_id != session_store.get("brand_id"):
                            session_store["brand_id"] = new_brand_id
                            session_store["brand_style"] = await _fetch_brand_style(new_brand_id)
                    logger.info("[voice_companion] context updated: %s", context)
                    continue

                if msg_type == "stop":
                    logger.info("[voice_companion] stop received")
                    live_request_queue.close()
                    return

    async def downstream_task() -> None:
        try:
            await asyncio.wait_for(session_ready.wait(), timeout=10)
        except Exception:
            logger.error("[voice_companion] session never started")
            try:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Voice companion did not receive start context.",
                }))
                await websocket.close(code=1008)
            except Exception:
                pass
            return

        try:
            # Send instruction + greeting as a SINGLE message (two messages = agent responds twice)
            async def send_instruction():
                await asyncio.sleep(0.2)
                product_name = context.get("product_name")
                instruction_text = _build_instruction(context)
                if product_name:
                    instruction_text += f"\n\nNow introduce yourself briefly as Lux and comment on the product '{product_name}' that the user is viewing."
                else:
                    instruction_text += "\n\nNow introduce yourself briefly as Lux, the voice design companion for TrendSync. Be warm and invite the user to try something."
                message = types.Content(
                    parts=[types.Part(text=instruction_text)]
                )
                live_request_queue.send_content(message)
                logger.info("[voice_companion] instruction + greeting sent, session_id=%s", session_id)

            asyncio.create_task(send_instruction())

            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                # Check if this event contains audio data
                has_audio = (
                    event.content
                    and event.content.parts
                    and any(
                        p.inline_data and p.inline_data.mime_type
                        and p.inline_data.mime_type.startswith("audio/")
                        for p in event.content.parts
                    )
                )

                if has_audio:
                    # Send raw PCM audio as binary WebSocket frame (no base64 overhead)
                    for part in event.content.parts:
                        if part.inline_data and part.inline_data.data:
                            await websocket.send_bytes(part.inline_data.data)
                else:
                    # Non-audio events: send as JSON text
                    event_json = event.model_dump_json(exclude_none=True, by_alias=True)

                    if "inputTranscription" in event_json:
                        try:
                            ed = json.loads(event_json)
                            text = ed.get("inputTranscription", {}).get("text", "")
                            if text:
                                logger.info("[voice_companion] USER SAID: %s", text)
                        except Exception:
                            pass

                    if "outputTranscription" in event_json:
                        try:
                            ed = json.loads(event_json)
                            text = ed.get("outputTranscription", {}).get("text", "")
                            if text:
                                logger.info("[voice_companion] AGENT SAID: %s", text)
                        except Exception:
                            pass

                    await websocket.send_text(event_json)

                # Deliver any pending status updates from tool calls to the frontend
                pending_statuses = _pending_status.pop(session_id, [])
                for status_msg in pending_statuses:
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "tool_status",
                            "tool": status_msg.get("tool", ""),
                            "status": status_msg.get("status", ""),
                            "message": status_msg.get("message", ""),
                        }))
                    except Exception as e:
                        logger.error("[voice_companion] Failed to send status: %s", e)

                # Deliver any pending images from tool calls to the frontend
                pending = _pending_images.pop(session_id, [])
                for img_data in pending:
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "image_updated",
                            "image_base64": img_data.get("image_base64", ""),
                            "compliance_score": img_data.get("compliance_score"),
                            "edit_instruction": img_data.get("edit_instruction"),
                            "description": img_data.get("description"),
                        }))
                        b64_len = len(img_data.get("image_base64", ""))
                        logger.info("[voice_companion] Sent image_updated to frontend (%d chars base64)", b64_len)
                    except Exception as e:
                        logger.error("[voice_companion] Failed to send image: %s", e)

            logger.info("[voice_companion] run_live completed session_id=%s", session_id)

        except Exception as e:
            # Code 1000 is a normal close (user stopped the session) — not an error
            err_str = str(e)
            if "1000" in err_str:
                logger.info("[voice_companion] Session closed normally (1000)")
            else:
                logger.exception("Voice companion session failed")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Voice session failed.",
                        "detail": repr(e),
                    }))
                except Exception:
                    pass

    try:
        await asyncio.gather(upstream_task(), downstream_task())
    except WebSocketDisconnect:
        logger.info("Voice companion client disconnected")
    finally:
        live_request_queue.close()
        _voice_sessions.pop(session_id, None)
        _pending_status.pop(session_id, None)
        _pending_images.pop(session_id, None)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "voice-companion",
        "model": VOICE_MODEL,
        "location": VOICE_LOCATION,
        "tools": [
            "analyze_product_image",
            "edit_product_image",
            "make_brand_compliant",
            "fetch_trend_data",
            "validate_brand_compliance",
            "generate_image_variation",
            "save_design",
            "generate_ad_video",
            "navigate_to_page",
            "start_collection_generation",
        ],
        "backend_url": MAIN_BACKEND_URL,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8002")))
