"""
TrendSync — Lux Design Companion (ADK Agent)
An AI fashion design stylist powered by Google ADK with 6 tools.
Used by POST /adk/design-companion in main.py.

The agent receives the product image as a multimodal Part in the user message,
so Gemini can "see" the actual product and give specific visual feedback
— no direct genai.Client calls; everything goes through ADK on Vertex AI.
"""

import os
import sys
import json
import logging

# Allow imports from shared/
_backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import ToolContext

from shared.image_generator import edit_product_image as _edit_image, generate_product_image as _gen_image
from shared.brand_guardian import validate_prompt, get_compliance_badge
from shared.trend_engine import fetch_trends

logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
# Use Flash for the design companion — fast, cheap, multimodal, 1M context.
# Pro was causing 429 RESOURCE_EXHAUSTED rate limits and is unnecessarily expensive.
DESIGN_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")

# ADK Agent reads GOOGLE_CLOUD_LOCATION for its internal Vertex AI client.
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "us-central1")


# ==========================================================================
# External image store — keeps large base64 data OUT of ADK session state
# so it never gets serialized into the model prompt.
# main.py sets the image before each run_async(); tools read it here.
# ==========================================================================
_IMAGE_STORE: dict[str, str] = {}   # key → base64 string


def set_image(key: str, image_base64: str) -> None:
    """Store image base64 outside ADK state (called by main.py)."""
    _IMAGE_STORE[key] = image_base64


def get_image(key: str) -> str:
    """Retrieve stored image base64."""
    return _IMAGE_STORE.get(key, "")


def clear_image(key: str) -> None:
    """Remove image from store to free memory."""
    _IMAGE_STORE.pop(key, None)


# ==========================================================================
# Tool Implementations
# ==========================================================================

def analyze_product_image(question: str, tool_context: ToolContext) -> dict:
    """
    Retrieve product context for visual design analysis.
    The product image is visible to you in the conversation as a multimodal Part.
    Call this tool to get structured product metadata, then combine it with
    what you SEE in the image to give specific visual feedback.
    Examples: 'What do you think of this design?', 'How can I improve this?',
    'What would look good with this?', 'Should I change anything?',
    'Describe what you see', 'What color palette works here?'
    """
    logger.info(f"[TOOL: analyze_product_image] question='{question}'")

    product_context = tool_context.state.get("product_context", {})
    brand_style = tool_context.state.get("brand_style_json", {})
    img_key = tool_context.state.get("_image_key", "")
    has_image = bool(get_image(img_key)) if img_key else False

    ctx_summary = (
        f"Product: {product_context.get('name', 'Unknown')} | "
        f"Category: {product_context.get('category', '')} / {product_context.get('subcategory', '')} | "
        f"Colors: {json.dumps(product_context.get('colors', []))} | "
        f"Materials: {json.dumps(product_context.get('materials', []))}"
    )

    brand_colors = ""
    if brand_style.get("colorPalette"):
        brand_colors = ", ".join(
            f"{c['name']} ({c['hex']})" for c in brand_style["colorPalette"][:5]
        )

    return {
        "action": "design_advice",
        "status": "success",
        "has_image": has_image,
        "product_context": ctx_summary,
        "brand_colors": brand_colors,
        "question": question,
        "message": (
            f"Product context: {ctx_summary}. "
            f"{'Brand palette: ' + brand_colors + '. ' if brand_colors else ''}"
            f"Image attached: {'yes' if has_image else 'no'}. "
            f"Now give your visual analysis based on what you see in the image."
        ),
    }


def edit_product_image(edit_instruction: str, tool_context: ToolContext) -> dict:
    """
    Edit the current product image with a specific change.
    Call this when the user wants to modify the existing image.
    Examples: 'Make the collar wider', 'Change the color to navy blue',
    'Add a belt', 'Make it shorter', 'Change the fabric texture to linen'
    """
    logger.info(f"[TOOL: edit_product_image] instruction='{edit_instruction}'")

    img_key = tool_context.state.get("_image_key", "")
    image_base64 = get_image(img_key) if img_key else ""
    if not image_base64:
        return {
            "action": "image_updated",
            "status": "error",
            "message": "No product image available to edit. Please generate an image first.",
        }

    try:
        edited_b64 = _edit_image(image_base64, edit_instruction)
        # Store edited image externally — NEVER return base64 in tool response
        # because ADK serializes function_response into conversation content,
        # and multi-MB base64 strings blow past the 1M token limit.
        if img_key:
            set_image(img_key, edited_b64)
        return {
            "action": "image_updated",
            "status": "success",
            "message": f"Applied edit: {edit_instruction}",
        }
    except Exception as e:
        logger.error(f"[TOOL: edit_product_image] Error: {e}")
        return {"action": "image_updated", "status": "error", "message": str(e)}


def make_brand_compliant(tool_context: ToolContext) -> dict:
    """
    Automatically adjust the product image to match brand guidelines.
    Call this when the user asks to make the design on-brand or brand-compliant.
    Examples: 'Make it brand compliant', 'Align with our brand colors',
    'Apply brand guidelines', 'Fix brand compliance'
    """
    logger.info("[TOOL: make_brand_compliant]")

    img_key = tool_context.state.get("_image_key", "")
    image_base64 = get_image(img_key) if img_key else ""
    brand_style = tool_context.state.get("brand_style_json", {})

    if not image_base64:
        return {
            "action": "brand_compliant",
            "status": "error",
            "message": "No product image available to adjust.",
        }

    color_palette = brand_style.get("colorPalette", [])
    if not color_palette:
        return {
            "action": "brand_compliant",
            "status": "error",
            "message": "No brand colors configured. Please set up brand colors in the Brand Style Editor first.",
        }

    try:
        brand_colors = ", ".join(f"{c['name']} ({c['hex']})" for c in color_palette[:4])
        edit_instruction = (
            f"Adjust the colors of this product to match the brand palette: {brand_colors}. "
            f"Keep the same structure, silhouette, and design details."
        )

        edited_b64 = _edit_image(image_base64, edit_instruction)

        # Store edited image externally — NEVER return base64 in tool response
        if img_key:
            set_image(img_key, edited_b64)

        # Validate the result
        product_context = tool_context.state.get("product_context", {})
        validation = validate_prompt(
            {"description": product_context.get("name", ""), "color_scheme": brand_colors},
            brand_style,
        )

        return {
            "action": "brand_compliant",
            "status": "success",
            "compliance_score": validation.get("compliance_score", 0),
            "message": f"Design adjusted to brand palette ({brand_colors}). Compliance: {validation.get('compliance_score', 0)}%.",
        }
    except Exception as e:
        logger.error(f"[TOOL: make_brand_compliant] Error: {e}")
        return {"action": "brand_compliant", "status": "error", "message": str(e)}


def fetch_trend_data(query: str, season: str = "", region: str = "global", demographic: str = "millennials") -> dict:
    """
    Fetch current real-time fashion trend data using Google Search grounding.
    Call this when the user asks about what's trending, popular colors, materials, or styles.
    Examples: 'What colors are trending?', 'Show me spring trends for Gen Z',
    'What materials are popular in Europe right now?'
    """
    logger.info(f"[TOOL: fetch_trend_data] query='{query}', season={season}, region={region}")

    try:
        insights = fetch_trends(
            season=season,
            region=region,
            demographic=demographic,
            trend_source="regional",
        )

        colors = insights.get("colors", [])
        styles = insights.get("silhouettes", [])
        materials = insights.get("materials", [])

        color_names = ", ".join(c.get("name", "") for c in colors[:4])
        style_names = ", ".join(s.get("name", "") for s in styles[:3])
        material_names = ", ".join(m.get("name", "") for m in materials[:3])

        return {
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
    except Exception as e:
        logger.error(f"[TOOL: fetch_trend_data] Error: {e}")
        return {"action": "trend_data", "status": "error", "message": str(e)}


def validate_brand_compliance(product_description: str, color_scheme: str, tool_context: ToolContext) -> dict:
    """
    Check how well a product design complies with brand guidelines.
    Call this when the user asks about brand compliance, validation, or guideline checks.
    Examples: 'Check if this is on-brand', 'What's the compliance score?',
    'Does this pass brand guidelines?', 'Validate this design'
    """
    logger.info(f"[TOOL: validate_brand_compliance] desc='{product_description[:50]}'")

    brand_style = tool_context.state.get("brand_style_json", {})
    if not brand_style:
        return {
            "action": "validation",
            "status": "error",
            "message": "No brand style configured. Set up your brand in the Brand Style Editor.",
        }

    try:
        result = validate_prompt(
            {"description": product_description, "color_scheme": color_scheme},
            brand_style,
        )
        badge = get_compliance_badge(result["compliance_score"])

        violations = result.get("violations", [])
        violation_summary = ""
        if violations:
            critical = [v for v in violations if v.get("severity") == "critical"]
            warnings = [v for v in violations if v.get("severity") == "warning"]
            parts = []
            if critical:
                parts.append(f"{len(critical)} critical")
            if warnings:
                parts.append(f"{len(warnings)} warnings")
            violation_summary = ", ".join(parts) if parts else "minor suggestions only"

        return {
            "action": "validation",
            "status": "success",
            "compliance_score": result["compliance_score"],
            "badge": badge["label"],
            "is_valid": result["is_valid"],
            "violation_summary": violation_summary,
            "total_violations": len(violations),
            "message": f"Compliance: {result['compliance_score']}% ({badge['label']}). {violation_summary or 'No issues found.'}",
        }
    except Exception as e:
        logger.error(f"[TOOL: validate_brand_compliance] Error: {e}")
        return {"action": "validation", "status": "error", "message": str(e)}


def generate_image_variation(variation_description: str, category: str, tool_context: ToolContext) -> dict:
    """
    Generate a completely new product image from scratch based on a description.
    Call this when the user wants a new variation or a fresh image, not an edit.
    Examples: 'Generate a version in silk', 'Create a new variation with wider sleeves',
    'Show me what this would look like as a maxi dress'
    """
    logger.info(f"[TOOL: generate_image_variation] desc='{variation_description}'")

    brand_style = tool_context.state.get("brand_style_json", {})

    try:
        image_b64 = _gen_image(
            product_description=variation_description,
            category=category,
            brand_style=brand_style,
        )

        # Store generated image externally — NEVER return base64 in tool response
        img_key = tool_context.state.get("_image_key", "")
        if img_key:
            set_image(img_key, image_b64)

        return {
            "action": "image_updated",
            "status": "success",
            "message": f"Generated new variation: {variation_description}",
        }
    except Exception as e:
        logger.error(f"[TOOL: generate_image_variation] Error: {e}")
        return {"action": "image_updated", "status": "error", "message": str(e)}


def save_design(tool_context: ToolContext) -> dict:
    """
    Save the current design modifications to the collection.
    Call this when the user says they want to save, keep, or finalize the current design.
    Examples: 'Save this design', 'Keep this version', 'I like it, save it',
    'Save my changes', 'Let's go with this one'
    """
    logger.info("[TOOL: save_design]")

    product_context = tool_context.state.get("product_context", {})
    img_key = tool_context.state.get("_image_key", "")
    has_image = bool(get_image(img_key)) if img_key else False

    return {
        "action": "save_design",
        "status": "success",
        "product_name": product_context.get("name", ""),
        "has_image": has_image,
        "message": f"Design for '{product_context.get('name', 'this product')}' saved to the collection!",
    }


# ==========================================================================
# Safety: before_model_callback logs total content size and guards against
# token overflow.  If something sneaks large data into the request we'll
# catch it before Vertex AI rejects it with a 400.
# ==========================================================================

def _before_model(callback_context, llm_request):
    """Log total prompt size — catches any remaining token-limit issues."""
    total_chars = 0
    for content in (llm_request.contents or []):
        for part in (content.parts or []):
            if part.text:
                total_chars += len(part.text)
            if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                total_chars += len(part.inline_data.data)
            if hasattr(part, "function_response") and part.function_response:
                resp = part.function_response.response
                if isinstance(resp, dict):
                    total_chars += len(json.dumps(resp, default=str))
    est_tokens = total_chars // 4
    print(f"[before_model] ~{est_tokens:,} est. tokens ({total_chars:,} chars)")
    if est_tokens > 900_000:
        print(f"[before_model] WARNING — {est_tokens:,} est. tokens is close to the limit!")
    return None  # let ADK proceed normally


# ==========================================================================
# ADK Agent + Runner (all model calls go through Vertex AI via ADK)
# ==========================================================================

agent = Agent(
    name="lux_design_companion",
    model=DESIGN_MODEL,
    before_model_callback=_before_model,
    tools=[
        analyze_product_image,
        edit_product_image,
        make_brand_compliant,
        fetch_trend_data,
        validate_brand_compliance,
        generate_image_variation,
        save_design,
    ],
    instruction=(
        "You are Lux, a passionate AI fashion design stylist with a warm, confident personality. "
        "You have an eye for detail, love bold creative choices, and speak like a trusted creative partner. "
        "Keep responses SHORT (2-4 sentences max), stylish, and action-oriented.\n\n"
        "IMPORTANT — VISUAL ANALYSIS:\n"
        "The product image is attached to the user message as a multimodal image Part — you can SEE it directly. "
        "When the user asks for your opinion, feedback, or suggestions about the design, "
        "call analyze_product_image to get the product metadata, then combine that with "
        "what you actually SEE in the image to give specific visual feedback.\n\n"
        "RULES:\n"
        "1. ALWAYS call the appropriate tool when the user requests an action — don't just describe what you would do\n"
        "2. For opinions, feedback, or 'what do you think?' — call analyze_product_image for product context, then reference what you SEE\n"
        "3. For image edits (color changes, structural changes, fabric changes), call edit_product_image\n"
        "4. For brand compliance requests, call make_brand_compliant\n"
        "5. For trend questions, call fetch_trend_data\n"
        "6. For compliance checks, call validate_brand_compliance\n"
        "7. For generating entirely new variations, call generate_image_variation\n"
        "8. When the user wants to save or keep the current design, call save_design\n"
        "9. After a tool returns, summarize the result naturally as Lux\n"
        "10. Use fashion vocabulary naturally (drape, silhouette, palette, texture)\n"
        "11. NEVER say 'I would call' or 'I can call' — just DO IT by calling the tool\n"
        "12. Do NOT use bullet points, numbered lists, or markdown headers in your responses\n"
        "13. Sound like a real creative collaborator, never robotic\n"
        "14. Reference SPECIFIC visual details from the image "
        "(colors, textures, silhouette shape, proportions, details) — never be vague"
    ),
    description=(
        "Lux is an AI fashion design stylist that can SEE product images and executes real actions: "
        "analyzes designs visually, edits product images, applies brand compliance, queries live trends, "
        "validates designs, generates new image variations, and saves designs to the collection."
    ),
)

session_service = InMemorySessionService()
runner = Runner(
    app_name="lux-design-companion",
    agent=agent,
    session_service=session_service,
)
