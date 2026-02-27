"""
Shared Design Tool Logic
Pure functions used by BOTH the typing agent (design_agent.py) and voice agent (voice-companion/main.py).
No ToolContext, no session state, no HTTP — just core logic calling shared modules.
"""

import json
import logging
import time
from typing import Optional

from shared.image_generator import (
    edit_product_image as _edit_image,
    generate_product_image as _gen_image,
)
from shared.brand_guardian import validate_prompt, get_compliance_badge
from shared.trend_engine import fetch_trends

logger = logging.getLogger(__name__)

_RATE_LIMIT_RETRIES = 3
_RATE_LIMIT_DELAY = 8  # seconds between retries


def _is_rate_limited(e: Exception) -> bool:
    """Check if an exception is a 429 / RESOURCE_EXHAUSTED error."""
    msg = str(e)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg


# --------------------------------------------------------------------------
# 1. Analyze product image (returns context for the LLM to use)
# --------------------------------------------------------------------------

def analyze_product(
    question: str,
    has_image: bool,
    product_context: dict,
    brand_style: dict,
) -> dict:
    """Return product metadata so the LLM can combine it with what it sees."""
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


# --------------------------------------------------------------------------
# 2. Edit product image
# --------------------------------------------------------------------------

def edit_image(edit_instruction: str, image_base64: str) -> tuple[Optional[str], dict]:
    """
    Edit a product image. Returns (new_base64 | None, result_dict).
    Caller is responsible for storing the new image in its own state.
    """
    if not image_base64:
        return None, {
            "action": "image_updated",
            "status": "error",
            "message": "No product image available to edit. Please generate an image first.",
        }
    for attempt in range(1, _RATE_LIMIT_RETRIES + 1):
        try:
            edited_b64 = _edit_image(image_base64, edit_instruction)
            return edited_b64, {
                "action": "image_updated",
                "status": "success",
                "message": f"Applied edit: {edit_instruction}",
            }
        except Exception as e:
            if _is_rate_limited(e) and attempt < _RATE_LIMIT_RETRIES:
                wait = _RATE_LIMIT_DELAY * attempt
                logger.warning(f"[edit_image] Rate limited (attempt {attempt}/{_RATE_LIMIT_RETRIES}), retrying in {wait}s...")
                time.sleep(wait)
                continue
            logger.error(f"[edit_image] Error (attempt {attempt}): {e}")
            return None, {"action": "image_updated", "status": "error", "message": str(e)}


# --------------------------------------------------------------------------
# 3. Make brand compliant
# --------------------------------------------------------------------------

def make_compliant(
    image_base64: str,
    brand_style: dict,
    product_context: dict,
) -> tuple[Optional[str], dict]:
    """
    Adjust image to match brand guidelines. Returns (new_base64 | None, result_dict).
    """
    if not image_base64:
        return None, {
            "action": "brand_compliant",
            "status": "error",
            "message": "No product image available to adjust.",
        }

    color_palette = brand_style.get("colorPalette", [])
    if not color_palette:
        return None, {
            "action": "brand_compliant",
            "status": "error",
            "message": "No brand colors configured. Please set up brand colors in the Brand Style Editor first.",
        }

    brand_colors = ", ".join(f"{c['name']} ({c['hex']})" for c in color_palette[:4])
    edit_instruction = (
        f"Adjust the colors of this product to match the brand palette: {brand_colors}. "
        f"Keep the same structure, silhouette, and design details."
    )

    for attempt in range(1, _RATE_LIMIT_RETRIES + 1):
        try:
            edited_b64 = _edit_image(image_base64, edit_instruction)

            validation = validate_prompt(
                {"description": product_context.get("name", ""), "color_scheme": brand_colors},
                brand_style,
            )

            return edited_b64, {
                "action": "brand_compliant",
                "status": "success",
                "compliance_score": validation.get("compliance_score", 0),
                "message": f"Design adjusted to brand palette ({brand_colors}). Compliance: {validation.get('compliance_score', 0)}%.",
            }
        except Exception as e:
            if _is_rate_limited(e) and attempt < _RATE_LIMIT_RETRIES:
                wait = _RATE_LIMIT_DELAY * attempt
                logger.warning(f"[make_compliant] Rate limited (attempt {attempt}/{_RATE_LIMIT_RETRIES}), retrying in {wait}s...")
                time.sleep(wait)
                continue
            logger.error(f"[make_compliant] Error (attempt {attempt}): {e}")
            return None, {"action": "brand_compliant", "status": "error", "message": str(e)}


# --------------------------------------------------------------------------
# 4. Fetch trend data
# --------------------------------------------------------------------------

def get_trends(
    query: str,
    season: str = "",
    region: str = "global",
    demographic: str = "millennials",
) -> dict:
    """Fetch real-time fashion trends via Gemini + Google Search grounding."""
    try:
        # Infer parameters from query text
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

        insights = fetch_trends(
            season=season,
            region=region,
            demographic=demographic,
            trend_source=trend_source,
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
        logger.error(f"[get_trends] Error: {e}")
        return {"action": "trend_data", "status": "error", "message": str(e)}


# --------------------------------------------------------------------------
# 5. Validate brand compliance
# --------------------------------------------------------------------------

def check_compliance(
    product_description: str,
    color_scheme: str,
    brand_style: dict,
) -> dict:
    """Check how well a product design complies with brand guidelines."""
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
        logger.error(f"[check_compliance] Error: {e}")
        return {"action": "validation", "status": "error", "message": str(e)}


# --------------------------------------------------------------------------
# 6. Generate image variation
# --------------------------------------------------------------------------

def generate_variation(
    description: str,
    category: str,
    brand_style: dict,
) -> tuple[Optional[str], dict]:
    """
    Generate a new product image from scratch. Returns (new_base64 | None, result_dict).
    """
    for attempt in range(1, _RATE_LIMIT_RETRIES + 1):
        try:
            image_b64 = _gen_image(
                product_description=description,
                category=category,
                brand_style=brand_style,
            )
            return image_b64, {
                "action": "image_updated",
                "status": "success",
                "message": f"Generated new variation: {description}",
            }
        except Exception as e:
            if _is_rate_limited(e) and attempt < _RATE_LIMIT_RETRIES:
                wait = _RATE_LIMIT_DELAY * attempt
                logger.warning(f"[generate_variation] Rate limited (attempt {attempt}/{_RATE_LIMIT_RETRIES}), retrying in {wait}s...")
                time.sleep(wait)
                continue
            logger.error(f"[generate_variation] Error (attempt {attempt}): {e}")
            return None, {"action": "image_updated", "status": "error", "message": str(e)}


# --------------------------------------------------------------------------
# 7. Save design (signal — actual persistence is on the frontend)
# --------------------------------------------------------------------------

def save_design_signal(product_name: str) -> dict:
    """Return a signal dict telling the frontend to persist the current design."""
    return {
        "action": "save_design",
        "status": "success",
        "product_name": product_name,
        "message": f"Design for '{product_name}' saved to the collection!",
    }
