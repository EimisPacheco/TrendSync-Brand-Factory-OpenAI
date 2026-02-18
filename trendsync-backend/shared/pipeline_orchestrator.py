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
    status_callback("trends", "Trend analysis complete", {
        "colors": len(trend_insights.get("colors", [])),
        "materials": len(trend_insights.get("materials", [])),
    })

    # ------------------------------------------------------------------
    # Step 2: Collection Planning
    # ------------------------------------------------------------------
    status_callback("collection", "Generating collection plan with AI thinking...", None)

    collection_data = generate_collection(config, brand_style, trend_insights)
    collection_data["collection_id"] = f"col_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    result["collection"] = collection_data

    products = collection_data.get("products", [])
    status_callback("collection", "Collection plan ready", {
        "product_count": len(products),
        "name": collection_data.get("name", ""),
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
            image_b64 = generate_product_image(
                product_description=product.get("description", ""),
                category=product.get("category", ""),
                brand_style=brand_style,
                trend_colors=trend_insights.get("colors"),
                trend_materials=trend_insights.get("materials"),
            )
            product["image_base64"] = image_b64

            if upload_fn:
                obj_name = f"collections/{collection_data['collection_id']}/{product.get('product_id', f'prod_{i}')}.png"
                product["image_url"] = upload_fn(image_b64, obj_name)

        except Exception as e:
            print(f"[Pipeline] Image generation failed for product {i}: {e}")
            product["image_url"] = None
            product["image_error"] = str(e)

    status_callback("images", f"All {total} images generated", {"current": total, "total": total})

    # ------------------------------------------------------------------
    # Step 4: Ad Video (optional)
    # ------------------------------------------------------------------
    if generate_ad_video and products:
        hero = products[0]
        status_callback("video", "Generating 'Future You' ad video with Veo...", None)

        try:
            ad_data = generate_complete_ad_video(
                product=hero,
                brand_style=brand_style,
                product_image_base64=hero.get("image_base64"),
                campaign_brief=config.get("campaign_brief", ""),
                ad_style=config.get("ad_style", "cinematic"),
            )
            result["ad_video"] = ad_data
            status_callback("video", "Ad video generated!", {
                "ad_id": ad_data.get("ad_id"),
                "video_url": ad_data.get("stitched_video_url"),
            })
        except Exception as e:
            print(f"[Pipeline] Ad video generation failed: {e}")
            result["ad_video_error"] = str(e)
            status_callback("video", f"Ad video failed: {e}", None)
    else:
        status_callback("video", "Skipped (not requested)", None)

    # ------------------------------------------------------------------
    # Done
    # ------------------------------------------------------------------
    result["product_count"] = total
    result["status"] = "complete"
    return result
