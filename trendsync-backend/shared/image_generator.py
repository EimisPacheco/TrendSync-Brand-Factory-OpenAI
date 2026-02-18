"""
Image Generator
Uses Gemini Flash to create product image prompts and Gemini Flash Image to generate images.
Follows the same 2-step pattern as Imaginable's character_generator.py.
"""

import os
import base64
import time
from typing import Optional
from google import genai
from google.genai import types

from shared.cache import cached


GEMINI_FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_FLASH_IMAGE_MODEL", "gemini-2.5-flash-image")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")


def get_client() -> genai.Client:
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


# --------------------------------------------------------------------------
# Product Image Generation (2-step: analyse → generate)
# --------------------------------------------------------------------------

@cached(prefix="img_gen", ttl=86400)  # 24h cache — same product + brand = same image
def generate_product_image(
    product_description: str,
    category: str,
    brand_style: dict,
    trend_colors: Optional[list] = None,
    trend_materials: Optional[list] = None,
) -> str:
    """
    Generate a fashion product image.

    Step 1: Gemini Flash builds a detailed image generation prompt from the
            product spec + brand style + trend data.
    Step 2: Gemini Flash Image generates the professional product photo.

    Returns base64-encoded PNG image.
    """
    client = get_client()

    # ------------------------------------------------------------------ #
    # Step 1 — Build detailed image prompt
    # ------------------------------------------------------------------ #
    color_palette_text = ", ".join(
        f"{c['name']} ({c['hex']})" for c in brand_style.get("colorPalette", [])
    )
    lighting_text = (
        f"Color temp {brand_style.get('lightingConfig', {}).get('colorTemperature', 5000)}K, "
        f"key light intensity {brand_style.get('lightingConfig', {}).get('keyLightIntensity', 80)}%"
    )
    negative_text = ", ".join(brand_style.get("negativePrompts", []))

    trend_context = ""
    if trend_colors:
        trend_context += f"\nTrend colors: {', '.join(c.get('name', '') + ' (' + c.get('hex', '') + ')' for c in trend_colors[:4])}"
    if trend_materials:
        trend_context += f"\nTrend materials: {', '.join(m.get('name', '') for m in trend_materials[:3])}"

    analysis_prompt = f"""You are a professional fashion photographer and art director.

Create a highly detailed image generation prompt for this fashion product:

PRODUCT: {product_description}
CATEGORY: {category}

BRAND STYLE:
- Color palette: {color_palette_text}
- Lighting: {lighting_text}
- Camera: {brand_style.get('cameraSettings', {}).get('defaultShot', 'front facing')}
- Avoid: {negative_text}
{trend_context}

REQUIREMENTS:
1. Professional e-commerce product photography style
2. Clean, minimal background (white or light gray studio)
3. Perfect studio lighting matching brand specs
4. Product centered, full visibility, no cropping
5. High resolution, sharp detail, commercial quality
6. Show fabric texture and construction quality
7. Accurate color representation
8. No mannequin, no human model — product only (flat lay or ghost mannequin)

OUTPUT: Provide ONLY the image generation prompt (200-300 words). Be specific about lighting, composition, materials, and details."""

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_FLASH_MODEL,
                contents=analysis_prompt,
                config=types.GenerateContentConfig(temperature=0.7, top_p=0.9),
            )
            break
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if attempt < max_retries - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
            raise

    image_prompt = response.text.strip()
    print(f"[Image Generator] Built prompt: {image_prompt[:120]}...")

    # ------------------------------------------------------------------ #
    # Step 2 — Generate image with Gemini Flash Image
    # ------------------------------------------------------------------ #
    print("[Image Generator] Generating product image...")

    for attempt in range(max_retries):
        try:
            img_response = client.models.generate_content(
                model=GEMINI_IMAGE_MODEL,
                contents=image_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["image"],
                    temperature=0.7,
                ),
            )
            break
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                if attempt < max_retries - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
            raise

    generated_image = None
    for part in img_response.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            generated_image = part.inline_data.data
            break

    if not generated_image:
        raise ValueError("Gemini did not return a generated image")

    print("[Image Generator] Successfully generated product image!")
    return base64.b64encode(generated_image).decode("utf-8")


# --------------------------------------------------------------------------
# Image Editing (targeted changes using Gemini 3 Pro Image)
# --------------------------------------------------------------------------

GEMINI_EDIT_IMAGE_MODEL = os.environ.get("GEMINI_EDIT_IMAGE_MODEL", GEMINI_IMAGE_MODEL)


def edit_product_image(
    image_base64: str,
    edit_instruction: str,
) -> str:
    """
    Edit an existing product image with targeted changes.
    Uses Gemini Flash Image for high-quality edits.

    Returns base64-encoded edited image.
    """
    client = get_client()

    image_bytes = base64.b64decode(image_base64)
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")

    edit_prompt = f"""Edit this fashion product image with the following change:
{edit_instruction}

IMPORTANT:
- Preserve the overall composition, lighting, and background
- Only change the specific element mentioned
- Maintain professional e-commerce product photography quality
- Keep the image clean and commercial-ready"""

    response = client.models.generate_content(
        model=GEMINI_EDIT_IMAGE_MODEL,
        contents=[image_part, edit_prompt],
        config=types.GenerateContentConfig(
            response_modalities=["image"],
            temperature=0.5,
        ),
    )

    edited_image = None
    for part in response.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            edited_image = part.inline_data.data
            break

    if not edited_image:
        raise ValueError("Gemini did not return an edited image")

    return base64.b64encode(edited_image).decode("utf-8")
