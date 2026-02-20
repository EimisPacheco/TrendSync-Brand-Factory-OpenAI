"""
Pipeline Orchestrator
Chains the full TrendSync workflow: Trends → Collection → Images → Ad Video.
Each step uses existing shared modules — no AI logic duplicated here.
"""

import time
import uuid
from typing import Any, Callable, Dict, Optional

from shared.trend_engine import fetch_trends
from shared.collection_engine import generate_collection
from shared.image_generator import generate_product_image
from shared.ad_video_engine import generate_complete_ad_video
from shared.brand_guardian import validate_prompt


# Type alias for the status callback
StatusCallback = Callable[[str, str, Optional[Dict[str, Any]]], None]


def _noop_callback(step: str, message: str, data: Optional[Dict[str, Any]] = None):
    print(f"[Pipeline] [{step}] {message}")


def run_full_pipeline(
    config: Dict[str, Any],
    brand_style: Dict[str, Any],
    status_callback: StatusCallback = _noop_callback,
    upload_fn: Optional[Callable[[str, str], str]] = None,
    generate_ad_video: bool = False,
) -> Dict[str, Any]:
    """
    Run the full TrendSync pipeline end-to-end.

    Steps:
        1. Fetch trend insights (Gemini Flash + Google Search)
        2. Generate collection plan (Gemini Pro with thinking)
        3. Generate product images (Gemini Flash Image, sequential)
        4. Generate ad video for hero product (optional, Veo 3.1)

    Args:
        config: Collection config dict (season, region, demographic, categories, product_count, trend_source)
        brand_style: Brand style dict (colorPalette, lightingConfig, cameraSettings, negativePrompts)
        status_callback: fn(step, message, data) called at each transition
        upload_fn: Optional fn(base64, object_name) → URL for GCS uploads
        generate_ad_video: Whether to run Step 4 (Veo video generation)

    Returns:
        Dict with trend_insights, collection, product_count, ad_video (if requested)
    """
    pipeline_id = f"pipe_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    result: Dict[str, Any] = {"pipeline_id": pipeline_id}

    # ------------------------------------------------------------------
    # Step 1: Trend Analysis
    # ------------------------------------------------------------------
    status_callback("trends", "Analyzing real-time fashion trends with Google Search...", None)

    trend_insights = fetch_trends(
        season=config.get("season", ""),
        region=config.get("region", "global"),
        demographic=config.get("demographic", "millennials"),
        trend_source=config.get("trend_source", "regional"),
    )
    result["trend_insights"] = trend_insights

    # Log full AI response for trends
    trend_colors = [f"{c.get('name','')} ({c.get('hex','')})" for c in trend_insights.get("colors", [])]
    trend_materials = [m.get("name", "") for m in trend_insights.get("materials", [])]
    trend_silhouettes = [s.get("name", "") for s in trend_insights.get("silhouettes", [])]
    print(f"[Pipeline] [Trends] AI Response Summary:")
    print(f"  Colors: {trend_colors}")
    print(f"  Materials: {trend_materials}")
    print(f"  Silhouettes: {trend_silhouettes}")
    print(f"  Summary: {trend_insights.get('summary', '')[:300]}")

    status_callback("trends", "Trend analysis complete", {
        "colors": len(trend_insights.get("colors", [])),
        "materials": len(trend_insights.get("materials", [])),
        "silhouettes": len(trend_insights.get("silhouettes", [])),
        "color_names": trend_colors[:6],
        "material_names": trend_materials[:6],
        "summary": trend_insights.get("summary", "")[:500],
    })

    # ------------------------------------------------------------------
    # Step 2: Collection Planning
    # ------------------------------------------------------------------
    status_callback("collection", "Generating collection plan with AI thinking...", None)

    collection_data = generate_collection(config, brand_style, trend_insights)
    collection_data["collection_id"] = f"col_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    result["collection"] = collection_data

    products = collection_data.get("products", [])

    # Log full AI response for collection
    print(f"[Pipeline] [Collection] AI Response:")
    print(f"  Name: {collection_data.get('name', '')}")
    print(f"  Description: {collection_data.get('description', '')[:300]}")
    print(f"  Season: {collection_data.get('season', '')}")
    print(f"  Products ({len(products)}):")
    for pi, prod in enumerate(products):
        print(f"    {pi+1}. {prod.get('name','')} ({prod.get('category','')}) — {prod.get('description','')[:120]}")
        print(f"       Material: {prod.get('material','')} | Color: {prod.get('color_story','')[:80]}")

    product_summaries = [
        {"name": p.get("name", ""), "category": p.get("category", ""), "material": p.get("material", "")}
        for p in products
    ]
    status_callback("collection", "Collection plan ready", {
        "product_count": len(products),
        "name": collection_data.get("name", ""),
        "description": collection_data.get("description", "")[:300],
        "products": product_summaries,
    })

    # ------------------------------------------------------------------
    # Step 3: Image Generation (sequential with per-product progress)
    # ------------------------------------------------------------------
    total = len(products)
    status_callback("images", f"Generating {total} product images...", {"current": 0, "total": total})

    for i, product in enumerate(products):
        status_callback("images", f"Generating image {i + 1}/{total}: {product.get('name', '')}", {
            "current": i + 1,
            "total": total,
        })

        try:
            # Use image_prompt (detailed) if available, fallback to description
            product_desc = product.get("image_prompt") or product.get("description", "")
            image_b64 = generate_product_image(
                product_description=product_desc,
                category=product.get("category", ""),
                brand_style=brand_style,
                trend_colors=trend_insights.get("colors"),
                trend_materials=trend_insights.get("materials"),
            )
            product["image_base64"] = image_b64
            b64_len = len(image_b64) if image_b64 else 0
            print(f"[Pipeline] [Images] Product {i+1} '{product.get('name','')}' — image generated ({b64_len} chars base64)")

            if upload_fn:
                obj_name = f"collections/{collection_data['collection_id']}/{product.get('product_id', f'prod_{i}')}.png"
                product["image_url"] = upload_fn(image_b64, obj_name)

        except Exception as e:
            print(f"[Pipeline] [Images] Product {i+1} '{product.get('name','')}' — FAILED: {e}")
            product["image_url"] = None
            product["image_error"] = str(e)

    # Run brand compliance validation for each product
    for i, product in enumerate(products):
        try:
            validation = validate_prompt(
                {"description": product.get("description", ""), "color_scheme": product.get("color_story", "")},
                brand_style,
            )
            product["compliance_score"] = validation.get("compliance_score", 0)
            print(f"[Pipeline] [Compliance] Product {i+1} '{product.get('name','')}' — score: {product['compliance_score']}")
        except Exception as e:
            print(f"[Pipeline] [Compliance] Product {i+1} validation failed: {e}")
            product["compliance_score"] = 0

    status_callback("images", f"All {total} images generated", {"current": total, "total": total})

    # ------------------------------------------------------------------
    # Step 4: Video — skipped (generated on-demand per product)
    # ------------------------------------------------------------------
    status_callback("video", "Videos available on-demand per product", None)

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    result["product_count"] = total
    result["status"] = "complete"
    return result
