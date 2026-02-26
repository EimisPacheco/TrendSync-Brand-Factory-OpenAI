"""
Collection Engine
Uses Gemini 3 Pro with thinking levels to orchestrate collection generation.
Follows the same Phase A → Phase B → Validate → Repair pattern as
Imaginable's create_episode_engine.py.
"""

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

GEMINI_PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-3-pro-preview")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

MAX_VALIDATION_RETRIES = 3


def get_client() -> genai.Client:
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate_collection_schema(collection: Dict[str, Any], expected_count: int) -> tuple[bool, List[str]]:
    """Validate the collection JSON matches the required schema."""
    errors = []

    for field in ["collection_id", "name", "description", "season", "products"]:
        if field not in collection:
            errors.append(f"Missing required field: {field}")

    products = collection.get("products", [])
    if len(products) != expected_count:
        errors.append(f"Expected {expected_count} products, got {len(products)}")

    for i, product in enumerate(products):
        for field in ["name", "category", "description", "color_story", "material", "target_price"]:
            if field not in product:
                errors.append(f"Product {i + 1}: Missing required field '{field}'")

        if "image_prompt" not in product:
            errors.append(f"Product {i + 1}: Missing 'image_prompt' for image generation")

    return len(errors) == 0, errors


# --------------------------------------------------------------------------
# Phase A: Collection Plan (HIGH thinking)
# --------------------------------------------------------------------------

def generate_collection_plan(
    client: genai.Client,
    config: Dict[str, Any],
    brand_style: Dict[str, Any],
    trend_insights: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Phase A: Generate a complete collection plan using HIGH thinking level.
    """
    product_count = config.get("product_count", 6)
    categories = config.get("categories", ["tops", "bottoms", "dresses"])

    color_palette_text = ", ".join(
        f"{c['name']} ({c['hex']})" for c in brand_style.get("colorPalette", [])
    )

    trend_context = ""
    if trend_insights:
        trend_colors = ", ".join(
            f"{c['name']} ({c.get('hex', '')})"
            for c in trend_insights.get("colors", [])[:4]
        )
        trend_styles = ", ".join(
            s.get("name", "") for s in trend_insights.get("silhouettes", [])[:3]
        )
        trend_materials = ", ".join(
            m.get("name", "") for m in trend_insights.get("materials", [])[:3]
        )
        trend_context = f"""
TREND INSIGHTS (incorporate these):
- Trending colors: {trend_colors}
- Trending styles: {trend_styles}
- Trending materials: {trend_materials}
- Summary: {trend_insights.get('summary', '')}
"""

    planning_prompt = f"""You are an expert fashion collection designer.

COLLECTION BRIEF:
- Season: {config.get('season', 'current season')}
- Region: {config.get('region', 'global')}
- Demographic: {config.get('demographic', 'millennials')}
- Categories: {', '.join(categories)}
- Product count: {product_count}

BRAND STYLE:
- Color palette: {color_palette_text}
- Negative prompts (avoid): {', '.join(brand_style.get('negativePrompts', []))}

{trend_context}

Generate a complete fashion collection JSON with exactly {product_count} products.

REQUIRED JSON SCHEMA:
{{
  "collection_id": "unique_id",
  "name": "Collection Name",
  "description": "Brief collection description",
  "season": "{config.get('season', 'current season')}",
  "products": [
    {{
      "name": "Product Name",
      "category": "tops|bottoms|dresses|outerwear|accessories",
      "description": "Detailed product description including silhouette, fit, and key features",
      "color_story": "#1A2B3C Deep Navy primary, #F5E6D3 Cream accent — MUST include actual hex codes",
      "material": "Primary fabric/material",
      "target_price": "$XX - $XXX",
      "image_prompt": "Single product centered in a square frame against solid white background. Product fills 70-80% of frame. Front-facing view. No mannequin, no human model. Include: garment type, color, fabric texture, construction details."
    }}
  ]
}}

RULES:
1. Distribute products evenly across requested categories
2. Each product must have a unique, detailed image_prompt suitable for AI image generation
3. CRITICAL: color_story MUST always start with hex codes like "#1A2B3C Color Name, #F5E6D3 Color Name". Never omit hex codes.
4. Color story should blend brand palette with trend colors
5. Materials should reflect trend materials where possible
6. Descriptions should be detailed enough for a tech pack
7. Price ranges should be realistic for the demographic
8. CRITICAL IMAGE RULES: Each image_prompt MUST specify: exactly ONE single product, centered in square frame, solid white background, product fills 70-80% of frame, entire product visible with no cropping, front-facing view only, no mannequin, no human model, no multiple angles or side-by-side views
"""

    response = client.models.generate_content(
        model=GEMINI_PRO_MODEL,
        contents=planning_prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH,
                include_thoughts=False,
            ),
            response_mime_type="application/json",
        ),
    )

    print(f"[CollectionEngine] === RAW AI RESPONSE (Phase A: Collection Plan) ===")
    print(response.text[:5000])
    print(f"[CollectionEngine] === END RAW RESPONSE ===")

    plan = json.loads(response.text)
    # Handle list response
    if isinstance(plan, list) and len(plan) > 0:
        plan = plan[0]
    return plan


# --------------------------------------------------------------------------
# Phase B: Product Expansion (mixed thinking)
# --------------------------------------------------------------------------

def expand_product(
    client: genai.Client,
    product_stub: Dict[str, Any],
    collection_context: Dict[str, Any],
    brand_style: Dict[str, Any],
    is_hero_piece: bool = False,
) -> Dict[str, Any]:
    """Expand a product with detailed image prompt and specs."""

    thinking_level = types.ThinkingLevel.HIGH if is_hero_piece else types.ThinkingLevel.LOW

    color_palette_text = ", ".join(
        f"{c['name']} ({c['hex']})" for c in brand_style.get("colorPalette", [])
    )
    camera = brand_style.get("cameraSettings", {})
    lighting = brand_style.get("lightingConfig", {})

    prompt = f"""Enhance this fashion product with a production-ready image generation prompt.

COLLECTION: {collection_context.get('name', '')}
SEASON: {collection_context.get('season', '')}

PRODUCT STUB:
{json.dumps(product_stub, indent=2)}

BRAND GUIDELINES:
- Colors: {color_palette_text}
- Camera: {camera.get('defaultShot', 'front facing')}, FOV {camera.get('fovDefault', 50)}°
- Lighting: {lighting.get('colorTemperature', 5000)}K, key light {lighting.get('keyLightIntensity', 80)}%
- Avoid: {', '.join(brand_style.get('negativePrompts', []))}

Enhance the image_prompt to be 200-300 words with:
1. Exact garment details (seams, buttons, closures, stitching)
2. Precise fabric texture description
3. Color specification with hex codes
4. Studio setup (background, lighting setup, camera angle)
5. Commercial photography style directives
6. "No human model, product only, flat lay or ghost mannequin"

Return the complete product JSON with the enhanced image_prompt."""

    response = client.models.generate_content(
        model=GEMINI_PRO_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=thinking_level,
                include_thoughts=False,
            ),
            response_mime_type="application/json",
        ),
    )

    print(f"[CollectionEngine] === RAW AI RESPONSE (Phase B: Product '{product_stub.get('name', '')}') ===")
    print(response.text[:3000])
    print(f"[CollectionEngine] === END RAW RESPONSE ===")

    expanded = json.loads(response.text)
    if isinstance(expanded, list) and len(expanded) > 0:
        expanded = expanded[0]
    return expanded


def expand_all_products(
    client: genai.Client,
    collection_plan: Dict[str, Any],
    brand_style: Dict[str, Any],
) -> Dict[str, Any]:
    """Phase B: Expand all products with appropriate thinking levels."""
    expanded_products = []
    products = collection_plan.get("products", [])

    for i, product in enumerate(products):
        # First product in each category is a hero piece → HIGH thinking
        is_hero = i == 0 or (
            i > 0
            and product.get("category") != products[i - 1].get("category")
        )

        expanded = expand_product(
            client=client,
            product_stub=product,
            collection_context={
                "name": collection_plan.get("name"),
                "season": collection_plan.get("season"),
                "description": collection_plan.get("description"),
            },
            brand_style=brand_style,
            is_hero_piece=is_hero,
        )
        expanded_products.append(expanded)

    collection_plan["products"] = expanded_products
    return collection_plan


# --------------------------------------------------------------------------
# Repair
# --------------------------------------------------------------------------

def repair_collection(
    client: genai.Client,
    collection: Dict[str, Any],
    errors: List[str],
    expected_count: int,
) -> Dict[str, Any]:
    """Use Gemini to repair a failed collection based on validation errors."""
    prompt = f"""The following fashion collection JSON has validation errors. Fix them.

ERRORS:
{chr(10).join(f"- {e}" for e in errors)}

CURRENT JSON:
{json.dumps(collection, indent=2)}

REQUIREMENTS:
- Exactly {expected_count} products
- Each product must have: name, category, description, color_story, material, target_price, image_prompt

Return the corrected collection JSON."""

    response = client.models.generate_content(
        model=GEMINI_PRO_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH,
                include_thoughts=False,
            ),
            response_mime_type="application/json",
        ),
    )

    print(f"[CollectionEngine] === RAW AI RESPONSE (Repair) ===")
    print(response.text[:3000])
    print(f"[CollectionEngine] === END RAW RESPONSE ===")

    repaired = json.loads(response.text)
    if isinstance(repaired, list) and len(repaired) > 0:
        repaired = repaired[0]
    return repaired


# --------------------------------------------------------------------------
# Public pipeline
# --------------------------------------------------------------------------

def generate_collection(
    config: Dict[str, Any],
    brand_style: Dict[str, Any],
    trend_insights: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Full pipeline: Plan → Expand → Validate → Repair → Return.
    Same pattern as Imaginable's generate_complete_episode.
    """
    client = get_client()
    product_count = config.get("product_count", 6)

    # Phase A: Plan
    print("[Phase A] Generating collection plan with HIGH thinking...")
    plan = generate_collection_plan(client, config, brand_style, trend_insights)

    # Phase B: Expand
    print("[Phase B] Expanding products with mixed thinking levels...")
    complete = expand_all_products(client, plan, brand_style)

    # Assign IDs
    complete["collection_id"] = f"col_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    for i, product in enumerate(complete.get("products", [])):
        product["product_id"] = f"prod_{int(time.time())}_{uuid.uuid4().hex[:8]}_{i}"

    # Validate + repair loop
    for attempt in range(MAX_VALIDATION_RETRIES):
        print(f"[Validation] Attempt {attempt + 1}/{MAX_VALIDATION_RETRIES}")
        is_valid, errors = validate_collection_schema(complete, product_count)
        if is_valid:
            print("[Success] Collection validated!")
            return complete

        print(f"[Validation Failed] Errors: {errors}")
        if attempt < MAX_VALIDATION_RETRIES - 1:
            print("[Repair] Attempting repair...")
            complete = repair_collection(client, complete, errors, product_count)

    raise ValueError(f"Collection generation failed after {MAX_VALIDATION_RETRIES} attempts")
