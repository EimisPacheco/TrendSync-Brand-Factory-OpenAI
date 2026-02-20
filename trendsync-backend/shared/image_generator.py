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
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_FLASH_IMAGE_MODEL", "gemini-3-pro-image-preview")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")


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

CRITICAL COMPOSITION RULES (MUST FOLLOW):
1. EXACTLY ONE single product in the image — never show multiple items, multiple angles, or side-by-side views
2. Product perfectly centered in a SQUARE frame (1:1 aspect ratio)
3. Product fills 70-80% of the frame with generous padding on all sides
4. The ENTIRE product must be visible — no part cropped or cut off at edges
5. Clean solid white or very light gray background — no gradients, patterns, or props
6. Front-facing view only (for clothing: flat lay from directly above, or ghost mannequin straight-on)
7. Professional e-commerce studio lighting — soft, even, no harsh shadows
8. No mannequin, no human model, no hangers — product only
9. High resolution, sharp detail, commercial quality
10. Accurate color representation, show fabric texture

OUTPUT: Provide ONLY the image generation prompt (150-250 words). Start with the composition and framing, then describe the product details."""

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
    print(f"[Image Generator] === RAW AI RESPONSE (Image Prompt) ===")
    print(image_prompt)
    print(f"[Image Generator] === END RAW RESPONSE ===")

    # ------------------------------------------------------------------ #
    # Step 2 — Generate image (try primary model, fallback to Flash)
    # ------------------------------------------------------------------ #
    FALLBACK_IMAGE_MODEL = "gemini-2.5-flash-image"
    image_retries = 5
    img_response = None

    for attempt in range(image_retries):
        model_to_use = GEMINI_IMAGE_MODEL if attempt < 3 else FALLBACK_IMAGE_MODEL
        print(f"[Image Generator] Generating image (attempt {attempt + 1}/{image_retries}, model={model_to_use})...")
        try:
            img_response = client.models.generate_content(
                model=model_to_use,
                contents=image_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["image"],
                    temperature=0.7,
                ),
            )
            break
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                wait = min(30, 5 * (attempt + 1))
                print(f"[Image Generator] Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            raise

    if img_response is None:
        raise ValueError("Image generation failed after all retries")

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
