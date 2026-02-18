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
      "voiceover": "Marketing narration for this scene (1-2 sentences, speakable in 6-8 seconds)",
      "camera_movement": "slow zoom in|orbit|tracking|static|pull back",
      "mood": "dramatic|elegant|energetic|warm|bold|minimal",
      "duration_seconds": 8
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
        "duration_seconds": 8,
        "aspect_ratio": "16:9",
        "generate_audio": True,
    }

    if product_image_base64:
        request["style_reference_image_base64"] = product_image_base64

    return request


# --------------------------------------------------------------------------
# Public pipeline
# --------------------------------------------------------------------------

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

    # Update storyboard with video URLs
    for i, scene in enumerate(storyboard["scenes"]):
        scene["video_url"] = veo_response["scene_video_urls"][i]

    storyboard["stitched_video_url"] = veo_response["stitched_video_url"]

    print(f"[Ad Pipeline] Complete! Ad ready: {storyboard['ad_id']}")
    return storyboard
