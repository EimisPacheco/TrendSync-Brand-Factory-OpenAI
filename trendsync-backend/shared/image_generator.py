"""
Image Generator
Uses Gemini Flash to create product image prompts and Gemini Flash Image to generate images.
Follows the same 2-step pattern as Imaginable's character_generator.py.
"""

import os
import io
import base64
import time
from typing import Optional
from PIL import Image
from google import genai
from google.genai import types

from shared.cache import cached

# Max dimension for images sent to the edit model (saves upload time + processing)
_EDIT_MAX_DIM = 1024
_EDIT_JPEG_QUALITY = 85


GEMINI_FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_FLASH_IMAGE_MODEL", "gemini-3-pro-image-preview")
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

GEMINI_EDIT_IMAGE_MODEL = os.environ.get("GEMINI_EDIT_IMAGE_MODEL", "gemini-3-pro-image-preview")


def _compress_for_edit(image_base64: str) -> tuple[bytes, str]:
    """
    Resize + compress an image before sending to the edit model.
    Returns (compressed_bytes, mime_type).
    Large PNGs (>500KB) are resized to max 1024px and converted to JPEG.
    """
    raw = base64.b64decode(image_base64)
    original_kb = len(raw) / 1024

    # Small images don't need compression
    if original_kb < 500:
        return raw, "image/png"

    img = Image.open(io.BytesIO(raw))
    w, h = img.size

    # Resize if larger than max dimension
    if max(w, h) > _EDIT_MAX_DIM:
        ratio = _EDIT_MAX_DIM / max(w, h)
        new_w, new_h = int(w * ratio), int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        print(f"[Image Editor] Resized {w}x{h} → {new_w}x{new_h}")

    # Convert to RGB JPEG for smaller size
    if img.mode in ("RGBA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
        img = bg

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=_EDIT_JPEG_QUALITY)
    compressed = buf.getvalue()
    print(f"[Image Editor] Compressed {original_kb:.0f}KB → {len(compressed)/1024:.0f}KB (JPEG q{_EDIT_JPEG_QUALITY})")
    return compressed, "image/jpeg"


def edit_product_image(
    image_base64: str,
    edit_instruction: str,
) -> str:
    """
    Edit an existing product image with targeted changes.
    Uses Gemini Flash Image for high-quality edits.

    Returns base64-encoded edited image.
    """
    print(f"[Image Editor] === EDIT REQUEST ===")
    print(f"[Image Editor] Model: {GEMINI_EDIT_IMAGE_MODEL}")
    print(f"[Image Editor] Location: {LOCATION}")
    print(f"[Image Editor] Instruction: {edit_instruction}")
    print(f"[Image Editor] Input image size: {len(image_base64):,} chars")

    client = get_client()

    compressed_bytes, mime_type = _compress_for_edit(image_base64)
    image_part = types.Part.from_bytes(data=compressed_bytes, mime_type=mime_type)

    # Detect color-change edits and amplify the instruction
    color_keywords = ["color", "colour", "red", "blue", "green", "black", "white", "pink",
                      "yellow", "orange", "purple", "navy", "teal", "gold", "silver",
                      "beige", "cream", "brown", "gray", "grey", "burgundy", "maroon",
                      "coral", "lavender", "olive", "turquoise", "magenta", "crimson"]
    is_color_change = any(kw in edit_instruction.lower() for kw in color_keywords)

    if is_color_change:
        edit_prompt = f"""Edit the colors of this fashion product image.

INSTRUCTION: {edit_instruction}

This is a COLOR CHANGE request. You MUST:
1. ONLY change the specific color(s) mentioned in the instruction — leave all other colors untouched
2. If the instruction says "change X to Y", find ONLY the areas that are color X and replace them with color Y
3. All other colors in the garment must remain EXACTLY as they are
4. The new color must be SATURATED and VIVID — not a subtle tint
5. Keep the exact same garment shape, silhouette, background, and lighting
6. Keep the exact same camera angle and composition
7. This is a TARGETED, SURGICAL color replacement — NOT a full recolor

CRITICAL: Only the specific color mentioned should change. All other parts of the garment must stay identical."""
    else:
        edit_prompt = f"""Edit this fashion product image. Apply this change clearly and visibly:
{edit_instruction}

RULES:
- Make the requested change OBVIOUS and DRAMATIC — the result must look visibly different
- Preserve the garment silhouette, composition, lighting, and background
- Only change the specific element mentioned (color, material, length, etc.)
- Maintain professional e-commerce product photography quality
- The change must be immediately noticeable when comparing before and after"""

    print(f"[Image Editor] Color change: {is_color_change}")
    print(f"[Image Editor] Sending to {GEMINI_EDIT_IMAGE_MODEL}...")

    max_retries = 3
    response = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_EDIT_IMAGE_MODEL,
                contents=[image_part, edit_prompt],
                config=types.GenerateContentConfig(
                    response_modalities=["image"],
                    temperature=0.8 if is_color_change else 0.5,
                ),
            )
            break
        except Exception as e:
            if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < max_retries - 1:
                wait = 5 * (attempt + 1)
                print(f"[Image Editor] Rate limited, retrying in {wait}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(wait)
                continue
            raise

    if response is None:
        raise ValueError("Image edit failed after all retries")

    print(f"[Image Editor] Response received. Parts: {len(response.parts)}")
    for i, part in enumerate(response.parts):
        if part.text:
            print(f"[Image Editor] Part {i}: text = {part.text[:200]}")
        if part.inline_data:
            print(f"[Image Editor] Part {i}: image ({part.inline_data.mime_type}, {len(part.inline_data.data):,} bytes)")

    edited_image = None
    for part in response.parts:
        if part.inline_data and part.inline_data.mime_type.startswith("image/"):
            edited_image = part.inline_data.data
            break

    if not edited_image:
        print(f"[Image Editor] ERROR: No image in response!")
        raise ValueError("Gemini did not return an edited image")

    result_b64 = base64.b64encode(edited_image).decode("utf-8")
    input_size = len(image_base64)
    output_size = len(result_b64)
    same = (result_b64 == image_base64)
    print(f"[Image Editor] === EDIT COMPLETE ===")
    print(f"[Image Editor] Output image size: {output_size:,} chars")
    print(f"[Image Editor] Same as input: {same}")
    print(f"[Image Editor] Size delta: {output_size - input_size:+,} chars")

    return result_b64
