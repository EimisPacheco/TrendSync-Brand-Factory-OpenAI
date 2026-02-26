"""
TrendSync — Lux Design Companion (ADK Agent)
An AI fashion design stylist powered by Google ADK with 7 tools.
Used by POST /adk/design-companion in main.py.

The agent receives the product image as a multimodal Part in the user message,
so Gemini can "see" the actual product and give specific visual feedback
— no direct genai.Client calls; everything goes through ADK on Vertex AI.

Tool logic lives in shared/design_tools.py — same code used by the voice agent.
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

from shared import design_tools

logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
# Use Flash for the design companion — fast, cheap, multimodal, 1M context.
# Pro was causing 429 RESOURCE_EXHAUSTED rate limits and is unnecessarily expensive.
DESIGN_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")

# ADK Agent reads GOOGLE_CLOUD_LOCATION for its internal Vertex AI client.
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")


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
# ADK Tool Wrappers — thin shells around shared/design_tools.py
# Each tool extracts state from ToolContext and delegates to shared logic.
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

    return design_tools.analyze_product(question, has_image, product_context, brand_style)


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

    new_b64, result = design_tools.edit_image(edit_instruction, image_base64)

    # Store edited image externally — NEVER return base64 in tool response
    # because ADK serializes function_response into conversation content,
    # and multi-MB base64 strings blow past the 1M token limit.
    if new_b64 and img_key:
        set_image(img_key, new_b64)

    return result


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
    product_context = tool_context.state.get("product_context", {})

    new_b64, result = design_tools.make_compliant(image_base64, brand_style, product_context)

    if new_b64 and img_key:
        set_image(img_key, new_b64)

    return result


def fetch_trend_data(query: str, season: str = "", region: str = "global", demographic: str = "millennials") -> dict:
    """
    Fetch current real-time fashion trend data using Google Search grounding.
    Call this when the user asks about what's trending, popular colors, materials, or styles.
    Examples: 'What colors are trending?', 'Show me spring trends for Gen Z',
    'What materials are popular in Europe right now?'
    """
    logger.info(f"[TOOL: fetch_trend_data] query='{query}', season={season}, region={region}")
    return design_tools.get_trends(query, season, region, demographic)


def validate_brand_compliance(product_description: str, color_scheme: str, tool_context: ToolContext) -> dict:
    """
    Check how well a product design complies with brand guidelines.
    Call this when the user asks about brand compliance, validation, or guideline checks.
    Examples: 'Check if this is on-brand', 'What's the compliance score?',
    'Does this pass brand guidelines?', 'Validate this design'
    """
    logger.info(f"[TOOL: validate_brand_compliance] desc='{product_description[:50]}'")
    brand_style = tool_context.state.get("brand_style_json", {})
    return design_tools.check_compliance(product_description, color_scheme, brand_style)


def generate_image_variation(variation_description: str, category: str, tool_context: ToolContext) -> dict:
    """
    Generate a completely new product image from scratch based on a description.
    Call this when the user wants a new variation or a fresh image, not an edit.
    Examples: 'Generate a version in silk', 'Create a new variation with wider sleeves',
    'Show me what this would look like as a maxi dress'
    """
    logger.info(f"[TOOL: generate_image_variation] desc='{variation_description}'")
    brand_style = tool_context.state.get("brand_style_json", {})

    new_b64, result = design_tools.generate_variation(variation_description, category, brand_style)

    # Store generated image externally — NEVER return base64 in tool response
    if new_b64:
        img_key = tool_context.state.get("_image_key", "")
        if img_key:
            set_image(img_key, new_b64)

    return result


def save_design(tool_context: ToolContext) -> dict:
    """
    Save the current design modifications to the collection.
    Call this when the user says they want to save, keep, or finalize the current design.
    Examples: 'Save this design', 'Keep this version', 'I like it, save it',
    'Save my changes', 'Let's go with this one'
    """
    logger.info("[TOOL: save_design]")
    product_context = tool_context.state.get("product_context", {})
    return design_tools.save_design_signal(product_context.get("name", "this product"))


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
