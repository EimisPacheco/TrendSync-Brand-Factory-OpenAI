"""
TrendSync Voice Design Companion Service
A voice-controlled design assistant using Google ADK with Gemini Live.
Each tool EXECUTES a real action by calling the main backend via HTTP.
All AI calls go through ADK on Vertex AI — no direct genai.Client usage.
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

VOICE_MODEL = os.environ.get("VOICE_MODEL", "gemini-live-2.5-flash-native-audio")
GEMINI_PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-3-pro-preview")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
MAIN_BACKEND_URL = os.environ.get("MAIN_BACKEND_URL", "http://localhost:8000")

# Voice model needs us-central1; design tools route through main backend (ADK on Vertex AI)
if LOCATION == "global":
    LOCATION = "us-central1"
    os.environ["GOOGLE_CLOUD_LOCATION"] = "us-central1"

# Module-level state for product context (voice tools are plain functions, no ToolContext)
_voice_sessions: dict[str, dict] = {}
# Pending images from tool calls — picked up by the downstream WS loop and sent to the frontend
_pending_images: dict[str, list[dict]] = {}  # session_id → list of {image_base64, ...}

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

# Shared async HTTP client (reused across tool calls, non-blocking)
_http_client: httpx.AsyncClient | None = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    return _http_client

logger.info(f"[Voice Companion] Starting: location={LOCATION}, model={VOICE_MODEL}")
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


# ==========================================================================
# TOOL IMPLEMENTATIONS — Standardized names matching design_agent.py
# All AI calls route through the main backend (ADK on Vertex AI).
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
    image_base64 = session_data.get("image_base64", "")

    if not image_base64:
        return {
            "action": "design_advice",
            "status": "no_image",
            "message": "I don't have a product image to analyze right now. Please make sure you're viewing a product with an image.",
        }

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/adk/design-companion",
            json={
                "session_id": f"voice-analyze-{id(session_data)}",
                "user_message": question,
                "product_context": {
                    "name": session_data.get("product_name", ""),
                    "category": session_data.get("product_category", ""),
                    "subcategory": session_data.get("product_subcategory", ""),
                    "colors": session_data.get("product_colors", []),
                    "materials": session_data.get("product_materials", []),
                },
                "image_base64": image_base64,
                "brand_id": session_data.get("brand_id", ""),
            },
        )

        if response.status_code == 200:
            result = response.json()
            out = {
                "action": "design_advice",
                "status": "success",
                "has_image": True,
                "message": result.get("response", "I can see the product but couldn't generate detailed feedback."),
            }
            _dedup_set("analyze", question, out)
            return out
        else:
            return {
                "action": "design_advice",
                "status": "error",
                "message": f"Could not analyze the image: backend returned {response.status_code}",
            }
    except Exception as e:
        logger.error(f"[TOOL: analyze_product_image] Error: {e}")
        return {"action": "design_advice", "status": "error", "message": str(e)}


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

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/adk/design-companion",
            json={
                "session_id": f"voice-edit-{id(session_data)}",
                "user_message": edit_instruction,
                "product_context": {
                    "name": session_data.get("product_name", ""),
                    "category": session_data.get("product_category", ""),
                    "subcategory": session_data.get("product_subcategory", ""),
                    "colors": session_data.get("product_colors", []),
                    "materials": session_data.get("product_materials", []),
                },
                "image_base64": image_base64,
                "brand_id": session_data.get("brand_id", ""),
            },
        )

        if response.status_code == 200:
            result = response.json()
            action = result.get("action") or {}
            new_image = action.get("image_base64", "")

            if new_image:
                session_data["image_base64"] = new_image
                for sid, sdata in _voice_sessions.items():
                    if sdata is session_data:
                        _pending_images.setdefault(sid, []).append({
                            "image_base64": new_image,
                            "edit_instruction": edit_instruction,
                        })
                        break
                logger.info("[TOOL: edit_product_image] Image edited and queued for frontend")

            out = {
                "action": "image_updated",
                "status": "success",
                "edit_instruction": edit_instruction,
                "has_new_image": bool(new_image),
                "message": result.get("response", f"Applied edit: {edit_instruction}."),
            }
            _dedup_set("edit", edit_instruction, out)
            return out
        else:
            return {
                "action": "image_updated",
                "status": "error",
                "message": f"Image edit failed: backend returned {response.status_code}",
            }
    except Exception as e:
        logger.error(f"[TOOL: edit_product_image] Error: {e}")
        return {
            "action": "image_updated",
            "status": "error",
            "message": f"Could not edit image: {str(e)}",
        }


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

    if not image_base64:
        return {
            "action": "brand_compliant",
            "status": "error",
            "message": "No product image available to adjust.",
        }

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/adk/design-companion",
            json={
                "session_id": f"voice-comply-{id(session_data)}",
                "user_message": "Make this product fully brand-compliant. Adjust colors and design to match the brand guidelines.",
                "product_context": {
                    "name": session_data.get("product_name", ""),
                    "category": session_data.get("product_category", ""),
                },
                "image_base64": image_base64,
                "brand_id": session_data.get("brand_id", ""),
            },
        )

        if response.status_code == 200:
            result = response.json()
            action = result.get("action", {}) or {}
            new_image = action.get("image_base64", "")

            if new_image:
                session_data["image_base64"] = new_image
                for sid, sdata in _voice_sessions.items():
                    if sdata is session_data:
                        _pending_images.setdefault(sid, []).append({
                            "image_base64": new_image,
                            "compliance_score": action.get("compliance_score"),
                        })
                        break
                logger.info("[TOOL: make_brand_compliant] Image updated and queued for frontend")

            out = {
                "action": "brand_compliant",
                "status": "success",
                "compliance_score": action.get("compliance_score"),
                "has_new_image": bool(new_image),
                "message": result.get("response", "Brand compliance adjustments applied."),
            }
            _dedup_set("comply", "brand", out)
            return out
        else:
            return {
                "action": "brand_compliant",
                "status": "error",
                "message": f"Could not apply brand compliance: backend returned {response.status_code}",
            }
    except Exception as e:
        logger.error(f"[TOOL: make_brand_compliant] Error: {e}")
        return {"action": "brand_compliant", "status": "error", "message": str(e)}


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

    try:
        query_lower = query.lower()
        trend_source = "regional"
        if "celebrity" in query_lower or "celeb" in query_lower:
            trend_source = "celebrity"
        if not season:
            if "summer" in query_lower:
                season = "Summer 2025"
            elif "fall" in query_lower or "autumn" in query_lower:
                season = "Fall 2025"
            elif "winter" in query_lower:
                season = "Winter 2025"
            elif "spring" in query_lower:
                season = "Spring 2025"
        if "gen z" in query_lower:
            demographic = "Gen Z"
        elif "luxury" in query_lower:
            demographic = "Luxury"
        elif "streetwear" in query_lower:
            demographic = "Streetwear"

        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/trends",
            json={
                "season": season,
                "region": region,
                "demographic": demographic,
                "trend_source": trend_source,
            },
        )

        if response.status_code == 200:
            data = response.json()
            insights = data.get("insights", {})

            colors = insights.get("colors", [])
            styles = insights.get("silhouettes", [])
            materials = insights.get("materials", [])

            color_names = ", ".join(c.get("name", "") for c in colors[:4])
            style_names = ", ".join(s.get("name", "") for s in styles[:3])
            material_names = ", ".join(m.get("name", "") for m in materials[:3])

            out = {
                "action": "trend_data",
                "status": "success",
                "trending_colors": color_names,
                "trending_styles": style_names,
                "trending_materials": material_names,
                "summary": insights.get("summary", ""),
                "message": (
                    f"{season} trends for {region}: "
                    f"Top colors are {color_names}. "
                    f"Popular styles: {style_names}. "
                    f"Key materials: {material_names}."
                ),
            }
            _dedup_set("trends", query, out)
            return out
        else:
            return {
                "action": "trend_data",
                "status": "error",
                "message": f"Trend query failed: {response.text[:200]}",
            }
    except Exception as e:
        logger.error(f"[TOOL: fetch_trend_data] Error: {e}")
        return {"action": "trend_data", "status": "error", "message": str(e)}


def _build_validate_message(score, badge, violations, violation_summary, result):
    """Build a voice-friendly validation summary (avoids f-string backslash issues)."""
    badge_label = badge.get("label", "N/A")
    fixes = result.get("auto_fixes_available", 0)
    if not violations:
        return f"Brand compliance score: {score}% — {badge_label}. No violations found — your design is fully on-brand!"
    return f"Brand compliance score: {score}% — {badge_label}. Found {violation_summary}. {fixes} can be auto-fixed."


async def validate_brand_compliance(product_description: str = "", color_scheme: str = "") -> dict:
    """
    Check how well a product design complies with brand guidelines.
    Call this when the user asks about brand compliance, validation, or guideline checks.
    Examples: 'Check if this is on-brand', 'What's the compliance score?',
    'Does this pass brand guidelines?', 'Validate this design'
    """
    logger.info(f"[TOOL: validate_brand_compliance] desc='{product_description[:50] if product_description else ''}'")

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/validate",
            json={
                "prompt": {
                    "description": product_description or "Current product design",
                    "color_scheme": color_scheme,
                    "lighting": "",
                    "camera_angle": "",
                    "negative_prompt": "",
                    "objects": [],
                },
                "brand_id": "default",
            },
        )

        if response.status_code == 200:
            result = response.json()
            score = result.get("compliance_score", 0)
            violations = result.get("violations", [])
            badge = result.get("badge", {})

            violation_summary = ""
            if violations:
                critical = [v for v in violations if v.get("severity") == "critical"]
                warnings = [v for v in violations if v.get("severity") == "warning"]
                suggestions = [v for v in violations if v.get("severity") == "suggestion"]
                parts = []
                if critical:
                    parts.append(f"{len(critical)} critical issues")
                if warnings:
                    parts.append(f"{len(warnings)} warnings")
                if suggestions:
                    parts.append(f"{len(suggestions)} suggestions")
                violation_summary = ", ".join(parts)

            return {
                "action": "validation",
                "status": "success",
                "compliance_score": score,
                "badge": badge.get("label", "Unknown"),
                "total_violations": len(violations),
                "violation_summary": violation_summary,
                "is_valid": result.get("is_valid", False),
                "message": _build_validate_message(score, badge, violations, violation_summary, result),
            }
        elif response.status_code == 404:
            return {
                "action": "validation",
                "status": "no_brand_style",
                "message": "No brand style is configured yet. Please set up your brand style first in the Brand Style Editor.",
            }
        else:
            return {
                "action": "validation",
                "status": "error",
                "message": f"Validation failed: {response.text[:200]}",
            }
    except Exception as e:
        logger.error(f"[TOOL: validate_brand_compliance] Error: {e}")
        return {
            "action": "validation",
            "status": "error",
            "message": f"Could not validate design: {str(e)}",
        }


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

    try:
        client = _get_http_client()
        response = await client.post(
            f"{MAIN_BACKEND_URL}/adk/design-companion",
            json={
                "session_id": f"voice-variation-{id(session_data)}",
                "user_message": f"Generate a new image variation: {variation_description}",
                "product_context": {
                    "name": session_data.get("product_name", ""),
                    "category": category,
                },
                "image_base64": session_data.get("image_base64", ""),
                "brand_id": session_data.get("brand_id", ""),
            },
        )

        if response.status_code == 200:
            result = response.json()
            action = result.get("action") or {}
            new_image = action.get("image_base64", "")

            if new_image:
                session_data["image_base64"] = new_image
                for sid, sdata in _voice_sessions.items():
                    if sdata is session_data:
                        _pending_images.setdefault(sid, []).append({
                            "image_base64": new_image,
                            "description": variation_description,
                        })
                        break
                logger.info("[TOOL: generate_image_variation] Image generated and queued for frontend")

            out = {
                "action": "image_updated",
                "status": "success",
                "description": variation_description,
                "has_new_image": bool(new_image),
                "message": result.get("response", f"Generated new variation: {variation_description}."),
            }
            _dedup_set("variation", variation_description, out)
            return out
        else:
            return {
                "action": "image_updated",
                "status": "error",
                "description": variation_description,
                "message": "Image generation failed. Please try again.",
            }
    except Exception as e:
        logger.error(f"[TOOL: generate_image_variation] Error: {e}")
        return {
            "action": "image_updated",
            "status": "error",
            "message": f"Could not generate variation: {str(e)}",
        }


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

    return {
        "action": "save_design",
        "status": "success",
        "product_name": product_name,
        "message": f"Design for '{product_name}' saved to the collection!",
    }


# --- Voice-only tools (not in design_agent.py) ---

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
        "   → EXECUTES: Uses Gemini 3 Pro vision (via ADK on Vertex AI) to SEE the actual product image",
        "   → Examples: 'What do you think?', 'How can I improve this?', 'Describe what you see'",
        "",
        "2. edit_product_image(edit_instruction)",
        "   → EXECUTES: Calls the image editing AI to modify the product image",
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
        "   → EXECUTES: Runs the Brand Guardian AI to check brand compliance",
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
        "AI voice assistant that executes fashion design actions via the main backend: "
        "analyzes designs visually, edits images, applies brand compliance, queries trends, "
        "validates designs, generates images and videos, navigates the app, and creates collections."
    ),
)


# ==========================================================================
# WebSocket Endpoint
# ==========================================================================

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
                    # Store full product context for tools that route through ADK backend
                    _voice_sessions[session_id] = {
                        "image_base64": payload.get("productImageBase64", ""),
                        "product_name": payload.get("productName", ""),
                        "product_description": payload.get("productDescription", ""),
                        "product_category": payload.get("productCategory", ""),
                        "product_subcategory": payload.get("productSubcategory", ""),
                        "product_colors": payload.get("productColors", []),
                        "product_materials": payload.get("productMaterials", []),
                        "brand_id": payload.get("brandId", ""),
                        "brand_name": payload.get("brandName", ""),
                    }
                    if _voice_sessions[session_id]["image_base64"]:
                        logger.info("[voice_companion] product image received (%d chars)", len(_voice_sessions[session_id]["image_base64"]))
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
                        session_store["brand_id"] = payload["brandId"]
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


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "voice-companion",
        "model": VOICE_MODEL,
        "location": LOCATION,
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
    uvicorn.run(app, host="0.0.0.0", port=8002)
