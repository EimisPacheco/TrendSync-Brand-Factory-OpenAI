"""
Ad Video Engine
Uses Gemini 3 Pro with thinking levels to plan ad storyboards,
then delegates to Veo 3.1 for video generation.
Follows the same Phase A → Phase B → Validate → Generate pattern as
Imaginable's create_episode_engine.py.
"""

import json
import os
import time
import uuid
import requests
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types


GEMINI_PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "gemini-3-pro-preview")
GEMINI_FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

VIDEO_GEN_ENDPOINT = os.environ.get(
    "VIDEO_GEN_SERVICE_URL", "http://localhost:8001"
) + "/generate-ad"

REQUIRED_SCENE_COUNT = 5
MAX_VALIDATION_RETRIES = 3


def get_client() -> genai.Client:
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate_storyboard(storyboard: Dict[str, Any]) -> tuple[bool, List[str]]:
    errors = []
    for field in ["ad_id", "title", "description", "scenes"]:
        if field not in storyboard:
            errors.append(f"Missing required field: {field}")

    scenes = storyboard.get("scenes", [])
    if len(scenes) != REQUIRED_SCENE_COUNT:
        errors.append(f"Expected {REQUIRED_SCENE_COUNT} scenes, got {len(scenes)}")

    for i, scene in enumerate(scenes, 1):
        for field in ["scene_number", "scene_type", "prompt", "voiceover"]:
            if field not in scene:
                errors.append(f"Scene {i}: Missing '{field}'")

    return len(errors) == 0, errors


# --------------------------------------------------------------------------
# Phase A: Storyboard Planning (HIGH thinking)
# --------------------------------------------------------------------------

def generate_storyboard(
    client: genai.Client,
    product: Dict[str, Any],
    brand_style: Dict[str, Any],
    campaign_brief: str = "",
    ad_style: str = "cinematic",
) -> Dict[str, Any]:
    """Plan a 5-scene ad storyboard with HIGH thinking."""

    color_palette = ", ".join(
        f"{c['name']} ({c['hex']})" for c in brand_style.get("colorPalette", [])
    )
    negatives = ", ".join(brand_style.get("negativePrompts", []))

    prompt = f"""You are an expert fashion advertising creative director.

PRODUCT:
- Name: {product.get('name', '')}
- Category: {product.get('category', '')}
- Description: {product.get('description', '')}
- Color Story: {product.get('color_story', '')}
- Material: {product.get('material', '')}

BRAND STYLE:
- Colors: {color_palette}
- Avoid: {negatives}

CAMPAIGN BRIEF: {campaign_brief or 'Create a compelling product ad video'}
AD STYLE: {ad_style}

Generate a {REQUIRED_SCENE_COUNT}-scene ad video storyboard.

SCENE STRUCTURE:
1. HOOK — Dramatic attention-grabbing opening (fabric movement, light play)
2. HERO — Full product reveal with slow camera movement
3. DETAIL — Close-up of textures, stitching, fabric quality
4. LIFESTYLE — Product styled in an aspirational environment
5. CTA — Brand moment with logo/tagline, call to action

REQUIRED JSON SCHEMA:
{{
  "ad_id": "unique_id",
  "title": "Ad Title",
  "description": "Brief ad description",
  "target_duration_seconds": 40,
  "scenes": [
    {{
      "scene_number": 1,
      "scene_type": "hook|hero|detail|lifestyle|cta",
      "prompt": "Detailed Veo video generation prompt (150-250 words). Describe exact visuals, camera movement, lighting, mood. Product must match the reference image exactly.",
      "voiceover": "Marketing narration for this scene (1 sentence, speakable in 5-6 seconds)",
      "camera_movement": "slow zoom in|orbit|tracking|static|pull back",
      "mood": "dramatic|elegant|energetic|warm|bold|minimal",
      "duration_seconds": 6
    }}
  ]
}}

CRITICAL VEO PROMPT RULES:
- Every scene must reference the product by exact description
- Use terms: "3D product visualization", "cinematic lighting", "professional commercial"
- Specify camera movement in every prompt
- No text, logos, or watermarks in video prompts (those are overlaid later)
- Background and environment must match brand aesthetic
- Keep voiceover concise — max 2 sentences per scene, speakable in 6-8 seconds
"""

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

    print(f"[AdVideoEngine] === RAW AI RESPONSE (Storyboard Plan) ===")
    print(response.text[:5000])
    print(f"[AdVideoEngine] === END RAW RESPONSE ===")

    storyboard = json.loads(response.text)
    if isinstance(storyboard, list) and len(storyboard) > 0:
        storyboard = storyboard[0]
    return storyboard


# --------------------------------------------------------------------------
# Phase B: Scene Expansion
# --------------------------------------------------------------------------

def expand_scene(
    client: genai.Client,
    scene: Dict[str, Any],
    product: Dict[str, Any],
    brand_style: Dict[str, Any],
) -> Dict[str, Any]:
    """Expand a scene with more detailed Veo prompt."""

    is_hero = scene.get("scene_type") in ("hero", "detail")
    thinking_level = types.ThinkingLevel.HIGH if is_hero else types.ThinkingLevel.LOW

    prompt = f"""Enhance this ad scene with a production-ready Veo video generation prompt.

PRODUCT: {product.get('name', '')} - {product.get('description', '')}
MATERIAL: {product.get('material', '')}
COLOR: {product.get('color_story', '')}

SCENE:
{json.dumps(scene, indent=2)}

BRAND COLORS: {', '.join(f"{c['name']} ({c['hex']})" for c in brand_style.get('colorPalette', []))}

Enhance the prompt to 200-300 words with:
1. Exact visual composition and camera framing
2. Lighting setup (key light, fill, rim)
3. Material/fabric behavior (drape, sheen, texture)
4. Environment/background details
5. Camera movement specification
6. Mood and color grading direction

CRITICAL: The product must look IDENTICAL to the reference image across all scenes.
Use "high-quality 3D product visualization" style.
No text, no humans, product-focused.

Return the complete scene JSON with enhanced prompt."""

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

    print(f"[AdVideoEngine] === RAW AI RESPONSE (Scene Expand: {scene.get('scene_type', '')}) ===")
    print(response.text[:3000])
    print(f"[AdVideoEngine] === END RAW RESPONSE ===")

    expanded = json.loads(response.text)
    if isinstance(expanded, list) and len(expanded) > 0:
        expanded = expanded[0]
    return expanded


# --------------------------------------------------------------------------
# Repair
# --------------------------------------------------------------------------

def repair_storyboard(
    client: genai.Client,
    storyboard: Dict[str, Any],
    errors: List[str],
) -> Dict[str, Any]:
    prompt = f"""Fix these validation errors in the ad storyboard:

ERRORS:
{chr(10).join(f"- {e}" for e in errors)}

CURRENT JSON:
{json.dumps(storyboard, indent=2)}

REQUIREMENTS:
- Exactly {REQUIRED_SCENE_COUNT} scenes
- Each scene: scene_number, scene_type, prompt, voiceover, camera_movement, mood, duration_seconds

Return corrected JSON."""

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

    repaired = json.loads(response.text)
    if isinstance(repaired, list) and len(repaired) > 0:
        repaired = repaired[0]
    return repaired


# --------------------------------------------------------------------------
# Convert storyboard → Veo request
# --------------------------------------------------------------------------

def convert_to_veo_request(
    storyboard: Dict[str, Any],
    product_image_base64: Optional[str] = None,
) -> Dict[str, Any]:
    """Convert storyboard to Veo generation service request payload."""
    veo_scenes = []
    for scene in storyboard["scenes"]:
        veo_scenes.append({
            "prompt": scene["prompt"],
            "dialogue": scene.get("voiceover"),
            "interaction": False,  # Ad videos are non-interactive
        })

    request = {
        "scenes": veo_scenes,
        "duration_seconds": 6,
        "aspect_ratio": "16:9",
        "generate_audio": True,
    }

    if product_image_base64:
        request["style_reference_image_base64"] = product_image_base64

    return request


# --------------------------------------------------------------------------
# Public pipeline
# --------------------------------------------------------------------------

def _build_fallback_video_prompt(product: Dict[str, Any], brand_style: Dict[str, Any]) -> str:
    """Build a video prompt directly from product data (no LLM call needed)."""
    name = product.get("name", "fashion product")
    category = product.get("category", "garment")
    color_story = product.get("color_story", "")
    material = product.get("material", "premium fabric")
    color_palette = ", ".join(
        f"{c['name']}" for c in brand_style.get("colorPalette", [])
    )

    return (
        f"High-quality 3D product visualization of a {name} ({category}). "
        f"The product is made of {material} with colors: {color_story or color_palette or 'neutral tones'}. "
        f"Professional commercial video quality. Cinematic studio lighting with dramatic key light "
        f"and subtle rim light highlighting the fabric texture and material quality. "
        f"Slow, elegant 360-degree orbit camera movement around the product placed on a minimal "
        f"pedestal against a dark gradient background. "
        f"Soft bokeh in the background, gentle fabric motion from a light breeze. "
        f"Premium, aspirational feel — luxury fashion brand advertisement. "
        f"Clean, polished aesthetic with accurate color reproduction. "
        f"The product fills the frame and is the sole focus throughout. "
        f"No text, no logos, no watermarks, no human models. "
        f"Smooth camera movement, professional color grading. "
        f"The product must match the provided reference image EXACTLY — "
        f"same colors, same shape, same proportions, same design details."
    )


def generate_single_product_video(
    product: Dict[str, Any],
    brand_style: Dict[str, Any],
    product_image_base64: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate a single-scene 10-second Veo video for one product.
    The product image is passed as an asset reference so the video
    matches the generated product image exactly.
    """
    color_palette = ", ".join(
        f"{c['name']} ({c['hex']})" for c in brand_style.get("colorPalette", [])
    )

    # Try Gemini for a richer prompt; fall back to template if rate-limited
    # Attempt 1: Gemini Pro, Attempt 2: Gemini Flash, Attempt 3: fallback template
    video_prompt = None
    models_to_try = [GEMINI_PRO_MODEL, GEMINI_FLASH_MODEL]
    for attempt, model_id in enumerate(models_to_try):
        try:
            client = get_client()
            prompt = f"""Create a single cinematic advertisement video prompt for this fashion product.

PRODUCT:
- Name: {product.get('name', '')}
- Category: {product.get('category', '')}
- Description: {product.get('description', '')}
- Color Story: {product.get('color_story', '')}
- Material: {product.get('material', '')}

BRAND COLORS: {color_palette}

CRITICAL — The video MUST show the EXACT same product as the provided reference image.
Every detail must match: same colors, same shape, same fabric texture, same design.
The viewer must instantly recognize the product from the still image in the video.

Create a prompt for a 10-second luxury advertisement video:
1. The product from the reference image appears IDENTICALLY in the video — same colors, proportions, materials, details
2. Slow cinematic camera movement: orbit around the product or gentle dolly/zoom
3. Dramatic studio lighting — key light + rim light highlighting fabric texture
4. Clean, dark or neutral gradient background — premium, aspirational feel
5. Subtle atmospheric elements: soft bokeh, light rays, gentle fabric motion
6. Professional commercial quality — high-end fashion brand ad
7. No text, no logos, no watermarks, no human model, ONLY this one product
8. The product must fill the frame and be the sole focus throughout

Return ONLY the video prompt (200-300 words)."""

            print(f"[AdVideoEngine] Trying model: {model_id}")
            response = client.models.generate_content(
                model=model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(
                        thinking_level=types.ThinkingLevel.LOW,
                        include_thoughts=False,
                    ),
                ),
            )
            video_prompt = response.text.strip()
            print(f"[AdVideoEngine] Prompt OK ({model_id}) for '{product.get('name', '')}': {video_prompt[:200]}...")
            break

        except Exception as e:
            print(f"[AdVideoEngine] {model_id} failed: {e}")
            if attempt < len(models_to_try) - 1:
                wait = 5
                print(f"[AdVideoEngine] Retrying with next model in {wait}s...")
                time.sleep(wait)

    if not video_prompt:
        print("[AdVideoEngine] All Gemini attempts failed — using fallback prompt")
        video_prompt = _build_fallback_video_prompt(product, brand_style)

    # Send to Veo service — single scene, 10 seconds
    print(f"[AdVideoEngine] Sending to Veo service at {VIDEO_GEN_ENDPOINT}...")
    request_payload = {
        "scenes": [{"prompt": video_prompt, "dialogue": None, "interaction": False}],
        "duration_seconds": 8,
        "aspect_ratio": "16:9",
        "generate_audio": True,
    }

    # Pass the product image as an asset reference so Veo generates
    # a video that looks IDENTICAL to the still image
    if product_image_base64:
        request_payload["style_reference_image_base64"] = product_image_base64

    response = requests.post(
        VIDEO_GEN_ENDPOINT,
        json=request_payload,
        timeout=600,
    )

    if response.status_code != 200:
        raise ValueError(f"Veo video generation failed: {response.status_code}: {response.text[:500]}")

    veo_response = response.json()

    return {
        "video_url": veo_response.get("stitched_video_url"),
        "video_base64": veo_response.get("stitched_video_base64"),
        "video_prompt": video_prompt,
    }


def generate_ad_storyboard(
    product: Dict[str, Any],
    brand_style: Dict[str, Any],
    campaign_brief: str = "",
    ad_style: str = "cinematic",
) -> Dict[str, Any]:
    """
    Generate a validated ad storyboard (JSON plan, no videos yet).
    Same Plan → Expand → Validate → Repair pattern.
    """
    client = get_client()

    # Phase A
    print("[Ad Video Phase A] Planning storyboard with HIGH thinking...")
    storyboard = generate_storyboard(client, product, brand_style, campaign_brief, ad_style)

    # Phase B
    print("[Ad Video Phase B] Expanding scenes...")
    expanded_scenes = []
    for scene in storyboard.get("scenes", []):
        expanded = expand_scene(client, scene, product, brand_style)
        expanded_scenes.append(expanded)
    storyboard["scenes"] = expanded_scenes

    # Assign ID
    storyboard["ad_id"] = f"ad_{int(time.time())}_{uuid.uuid4().hex[:8]}"

    # Validate + repair
    for attempt in range(MAX_VALIDATION_RETRIES):
        is_valid, errors = validate_storyboard(storyboard)
        if is_valid:
            print("[Ad Video] Storyboard validated!")
            return storyboard
        print(f"[Ad Video] Validation failed: {errors}")
        if attempt < MAX_VALIDATION_RETRIES - 1:
            storyboard = repair_storyboard(client, storyboard, errors)

    raise ValueError(f"Storyboard generation failed after {MAX_VALIDATION_RETRIES} attempts")


def generate_complete_ad_video(
    product: Dict[str, Any],
    brand_style: Dict[str, Any],
    product_image_base64: Optional[str] = None,
    campaign_brief: str = "",
    ad_style: str = "cinematic",
) -> Dict[str, Any]:
    """
    Full pipeline: Storyboard → Veo videos → stitched ad.
    """
    # Step 1: Generate storyboard
    print("[Ad Pipeline] Step 1: Generating storyboard...")
    storyboard = generate_ad_storyboard(product, brand_style, campaign_brief, ad_style)

    # Step 2: Send to Veo service
    print("[Ad Pipeline] Step 2: Generating videos with Veo...")
    veo_request = convert_to_veo_request(storyboard, product_image_base64)

    response = requests.post(
        VIDEO_GEN_ENDPOINT,
        json=veo_request,
        timeout=7200,
    )

    if response.status_code != 200:
        raise ValueError(f"Video generation failed: {response.status_code}: {response.text}")

    veo_response = response.json()

    # Update storyboard with video URLs (scenes may be empty)
    scene_urls = veo_response.get("scene_video_urls", [])
    for i, scene in enumerate(storyboard["scenes"]):
        scene["video_url"] = scene_urls[i] if i < len(scene_urls) else None

    storyboard["stitched_video_url"] = veo_response.get("stitched_video_url")
    storyboard["stitched_video_base64"] = veo_response.get("stitched_video_base64")

    print(f"[Ad Pipeline] Complete! Ad ready: {storyboard['ad_id']}")
    return storyboard
