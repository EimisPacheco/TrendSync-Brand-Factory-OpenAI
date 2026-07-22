"""
TrendSync — Lux Design Companion (OpenAI Agents SDK)

An AI fashion design stylist powered by the OpenAI Agents SDK with 7 tools.
Used by POST /adk/design-companion and POST /design/chat in main.py.

The product image is attached to the user message as an `input_image` part so
the model can "see" the actual product and give specific visual feedback.

Tool logic still lives in shared/design_tools.py — the same code used by the
Node voice agent (OpenAI Realtime).

Public API (consumed by main.py):
    run_design_agent(user_message, product_context, brand_style,
                     image_base64=None, history=None) -> dict
        Returns {"response": str, "action": dict | None}.

    set_image / get_image / clear_image — external image store helpers (kept
    intentionally to prevent multi-MB base64 payloads from bloating the chat
    transcript / model prompt).
"""

from __future__ import annotations

import os
import sys
import json
import logging
import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

# Allow imports from shared/
_backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

# OpenAI Agents SDK
from agents import Agent, Runner, function_tool, RunContextWrapper

from shared import design_tools

logger = logging.getLogger(__name__)

# Default model. Override with env var OPENAI_MODEL.
# GPT-5.6 Sol handles the companion's multimodal, tool-using design work;
# Terra is the current lower-cost fallback for the same Responses API contract.
DESIGN_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol")
DESIGN_MODEL_FALLBACK = "gpt-5.6-terra"


# ==========================================================================
# External image store — keeps large base64 data OUT of the agent transcript
# so it never gets serialized into the model prompt.
# main.py sets the image before each run; tools read it here.
# ==========================================================================
_IMAGE_STORE: dict[str, str] = {}  # key -> base64 string


def set_image(key: str, image_base64: str) -> None:
    """Store image base64 outside agent state (called by main.py)."""
    _IMAGE_STORE[key] = image_base64


def get_image(key: str) -> str:
    """Retrieve stored image base64."""
    return _IMAGE_STORE.get(key, "")


def clear_image(key: str) -> None:
    """Remove image from store to free memory."""
    _IMAGE_STORE.pop(key, None)


# ==========================================================================
# Run-scoped context. Passed into Runner.run(..., context=ctx) so each tool
# call can read brand_style / product_context / image key without globals.
# Edited / generated images are also stashed back here so main.py can pick
# them up after the run completes.
# ==========================================================================

@dataclass
class DesignRunContext:
    image_key: str = ""
    brand_style: dict = field(default_factory=dict)
    product_context: dict = field(default_factory=dict)
    last_action: dict | None = None  # most recent tool result, surfaced to caller


# ==========================================================================
# Tool wrappers — thin shells around shared/design_tools.py.
# `@function_tool` exposes them to the OpenAI model. Docstrings become the
# tool descriptions the LLM sees.
# ==========================================================================

@function_tool
def analyze_product_image(
    ctx: RunContextWrapper[DesignRunContext], question: str
) -> dict:
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
    state = ctx.context
    has_image = bool(get_image(state.image_key)) if state.image_key else False
    result = design_tools.analyze_product(
        question, has_image, state.product_context, state.brand_style
    )
    state.last_action = result
    return result


@function_tool
def edit_product_image(
    ctx: RunContextWrapper[DesignRunContext], edit_instruction: str
) -> dict:
    """
    Edit the current product image with a specific change.
    Call this when the user wants to modify the existing image.
    Examples: 'Make the collar wider', 'Change the color to navy blue',
    'Add a belt', 'Make it shorter', 'Change the fabric texture to linen'
    """
    logger.info(f"[TOOL: edit_product_image] instruction='{edit_instruction}'")
    state = ctx.context
    image_base64 = get_image(state.image_key) if state.image_key else ""

    new_b64, result = design_tools.edit_image(edit_instruction, image_base64)

    # Store edited image externally — NEVER return base64 in tool response,
    # because the SDK serializes function_response into conversation content
    # and a multi-MB base64 string blows past context limits.
    if new_b64 and state.image_key:
        set_image(state.image_key, new_b64)
    state.last_action = result
    return result


@function_tool
def make_brand_compliant(ctx: RunContextWrapper[DesignRunContext]) -> dict:
    """
    Automatically adjust the product image to match brand guidelines.
    Call this when the user asks to make the design on-brand or brand-compliant.
    Examples: 'Make it brand compliant', 'Align with our brand colors',
    'Apply brand guidelines', 'Fix brand compliance'
    """
    logger.info("[TOOL: make_brand_compliant]")
    state = ctx.context
    image_base64 = get_image(state.image_key) if state.image_key else ""

    new_b64, result = design_tools.make_compliant(
        image_base64, state.brand_style, state.product_context
    )
    if new_b64 and state.image_key:
        set_image(state.image_key, new_b64)
    state.last_action = result
    return result


@function_tool
def fetch_trend_data(
    query: str,
    season: str = "",
    region: str = "global",
    demographic: str = "millennials",
) -> dict:
    """
    Fetch current real-time fashion trend data using Google Search grounding.
    Call this when the user asks about what's trending, popular colors, materials, or styles.
    Examples: 'What colors are trending?', 'Show me spring trends for Gen Z',
    'What materials are popular in Europe right now?'
    """
    logger.info(
        f"[TOOL: fetch_trend_data] query='{query}', season={season}, region={region}"
    )
    return design_tools.get_trends(query, season, region, demographic)


@function_tool
def validate_brand_compliance(
    ctx: RunContextWrapper[DesignRunContext],
    product_description: str,
    color_scheme: str,
) -> dict:
    """
    Check how well a product design complies with brand guidelines.
    Call this when the user asks about brand compliance, validation, or guideline checks.
    Examples: 'Check if this is on-brand', 'What's the compliance score?',
    'Does this pass brand guidelines?', 'Validate this design'
    """
    logger.info(
        f"[TOOL: validate_brand_compliance] desc='{product_description[:50]}'"
    )
    state = ctx.context
    result = design_tools.check_compliance(
        product_description, color_scheme, state.brand_style
    )
    state.last_action = result
    return result


@function_tool
def generate_image_variation(
    ctx: RunContextWrapper[DesignRunContext],
    variation_description: str,
    category: str,
) -> dict:
    """
    Generate a completely new product image from scratch based on a description.
    Call this when the user wants a new variation or a fresh image, not an edit.
    Examples: 'Generate a version in silk', 'Create a new variation with wider sleeves',
    'Show me what this would look like as a maxi dress'
    """
    logger.info(f"[TOOL: generate_image_variation] desc='{variation_description}'")
    state = ctx.context

    new_b64, result = design_tools.generate_variation(
        variation_description, category, state.brand_style
    )
    if new_b64 and state.image_key:
        set_image(state.image_key, new_b64)
    state.last_action = result
    return result


@function_tool
def save_design(ctx: RunContextWrapper[DesignRunContext]) -> dict:
    """
    Save the current design modifications to the collection.
    Call this when the user says they want to save, keep, or finalize the current design.
    Examples: 'Save this design', 'Keep this version', 'I like it, save it',
    'Save my changes', 'Let's go with this one'
    """
    logger.info("[TOOL: save_design]")
    state = ctx.context
    result = design_tools.save_design_signal(
        state.product_context.get("name", "this product")
    )
    state.last_action = result
    return result


# ==========================================================================
# Agent definition — Lux personality + 7 tools.
# ==========================================================================

LUX_INSTRUCTION = (
    "You are Lux, a passionate AI fashion design stylist with a warm, confident personality. "
    "You have an eye for detail, love bold creative choices, and speak like a trusted creative partner. "
    "Keep responses SHORT (2-4 sentences max), stylish, and action-oriented.\n\n"
    "IMPORTANT — VISUAL ANALYSIS:\n"
    "The product image is attached to the user message as a multimodal image part — you can SEE it directly. "
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
)


def _build_agent(model: str) -> Agent[DesignRunContext]:
    return Agent[DesignRunContext](
        name="lux_design_companion",
        model=model,
        instructions=LUX_INSTRUCTION,
        tools=[
            analyze_product_image,
            edit_product_image,
            make_brand_compliant,
            fetch_trend_data,
            validate_brand_compliance,
            generate_image_variation,
            save_design,
        ],
    )


agent: Agent[DesignRunContext] = _build_agent(DESIGN_MODEL)


# ==========================================================================
# Public entry point used by main.py.
# Builds a multimodal user message (text + optional image), runs the agent,
# and returns {"response": str, "action": dict | None}.
# ==========================================================================

def _build_input_messages(
    user_message: str,
    image_base64: Optional[str],
    history: Optional[list[dict[str, str]]],
) -> list[dict[str, Any]]:
    """Convert text history + current message + optional image to the SDK
    message-list input shape (OpenAI Responses-API style)."""
    messages: list[dict[str, Any]] = []

    if history:
        for turn in history:
            role = turn.get("role", "user")
            text = turn.get("text", "")
            if not text:
                continue
            # Map our internal {"role": "assistant"|"user", "text": "..."}
            # to the SDK's input shape.
            messages.append(
                {
                    "role": "assistant" if role == "assistant" else "user",
                    "content": [{"type": "input_text", "text": text}]
                    if role != "assistant"
                    else text,
                }
            )

    # Current user turn — text + optional inline image.
    parts: list[dict[str, Any]] = [{"type": "input_text", "text": user_message}]
    if image_base64:
        parts.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{image_base64}",
            }
        )
    messages.append({"role": "user", "content": parts})
    return messages


async def run_design_agent(
    user_message: str,
    product_context: dict,
    brand_style: dict,
    image_base64: Optional[str] = None,
    history: Optional[list[dict[str, str]]] = None,
    image_key: Optional[str] = None,
) -> dict:
    """
    Run Lux for a single user turn.

    Returns {"response": str, "action": dict | None, "image_key": str}.
    The caller (main.py) reads any modified image via get_image(image_key)
    after this returns, then calls clear_image(image_key) when done.
    """
    key = image_key or f"dc-{uuid.uuid4().hex[:12]}"
    if image_base64:
        set_image(key, image_base64)

    ctx = DesignRunContext(
        image_key=key,
        brand_style=brand_style or {},
        product_context=product_context or {},
    )

    messages = _build_input_messages(user_message, image_base64, history)

    response_text = ""
    try:
        result = await Runner.run(agent, messages, context=ctx)
        # `final_output` is the model's last text answer.
        if result.final_output is not None:
            response_text = (
                result.final_output
                if isinstance(result.final_output, str)
                else str(result.final_output)
            )
    except Exception as primary_err:
        logger.warning(
            f"[run_design_agent] primary model {DESIGN_MODEL} failed: "
            f"{primary_err}. Trying fallback {DESIGN_MODEL_FALLBACK}."
        )
        fallback_agent = _build_agent(DESIGN_MODEL_FALLBACK)
        result = await Runner.run(fallback_agent, messages, context=ctx)
        if result.final_output is not None:
            response_text = (
                result.final_output
                if isinstance(result.final_output, str)
                else str(result.final_output)
            )

    return {
        "response": response_text,
        "action": ctx.last_action,
        "image_key": key,
    }


async def analyze_image_to_specs(
    analysis_prompt: str, image_base64: Optional[str] = None
) -> str:
    """One-shot text-only run used by POST /save-design.
    Sends the prompt + (optionally) the product image to a no-tools agent
    and returns the raw model text (expected to be a JSON object).
    """
    bare_agent = Agent[DesignRunContext](
        name="lux_design_specs",
        model=DESIGN_MODEL,
        instructions="Return ONLY valid JSON. No markdown fences, no commentary.",
        tools=[],
    )
    parts: list[dict[str, Any]] = [{"type": "input_text", "text": analysis_prompt}]
    if image_base64:
        parts.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{image_base64}",
            }
        )
    messages = [{"role": "user", "content": parts}]

    ctx = DesignRunContext()
    try:
        result = await Runner.run(bare_agent, messages, context=ctx)
    except Exception as primary_err:
        logger.warning(
            f"[analyze_image_to_specs] primary model {DESIGN_MODEL} failed: "
            f"{primary_err}. Trying fallback {DESIGN_MODEL_FALLBACK}."
        )
        bare_agent_fallback = Agent[DesignRunContext](
            name="lux_design_specs",
            model=DESIGN_MODEL_FALLBACK,
            instructions="Return ONLY valid JSON. No markdown fences, no commentary.",
            tools=[],
        )
        result = await Runner.run(bare_agent_fallback, messages, context=ctx)

    if result.final_output is None:
        return ""
    return (
        result.final_output
        if isinstance(result.final_output, str)
        else str(result.final_output)
    )


def run_design_agent_sync(
    user_message: str,
    product_context: dict,
    brand_style: dict,
    image_base64: Optional[str] = None,
    history: Optional[list[dict[str, str]]] = None,
    image_key: Optional[str] = None,
) -> dict:
    """Synchronous helper around run_design_agent (rarely needed in FastAPI)."""
    return asyncio.run(
        run_design_agent(
            user_message=user_message,
            product_context=product_context,
            brand_style=brand_style,
            image_base64=image_base64,
            history=history,
            image_key=image_key,
        )
    )


# ==========================================================================
# Local smoke test
# ==========================================================================
# Run with:
#   cd trendsync-backend
#   OPENAI_API_KEY=sk-... python -m services.main-backend.design_agent
#
# This block only constructs the input shape and prints what would be sent
# to the model — it does NOT actually call OpenAI, so it is safe to run
# without burning credits.
# ==========================================================================

if __name__ == "__main__":
    sample = _build_input_messages(
        user_message="What do you think of this dress?",
        image_base64=None,
        history=[
            {"role": "user", "text": "Show me something elegant"},
            {"role": "assistant", "text": "Here's a navy gown with silk drape."},
        ],
    )
    print(json.dumps(sample, indent=2))
    print(f"\nAgent model: {DESIGN_MODEL} (fallback: {DESIGN_MODEL_FALLBACK})")
    print(f"Tools registered: {[t.name for t in agent.tools]}")
