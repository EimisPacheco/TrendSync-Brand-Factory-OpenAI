"""Server-side product image generation and natural-language editing with GPT Image 2."""

import base64
import io
import os
import re
import time
from typing import Optional

from openai import OpenAI
from PIL import Image

from shared.cache import cached


OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol")
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_QUALITY = os.environ.get("OPENAI_IMAGE_QUALITY", "medium")
OPENAI_IMAGE_SIZE = os.environ.get("OPENAI_IMAGE_SIZE", "1024x1024")
OPENAI_IMAGE_FORMAT = os.environ.get("OPENAI_IMAGE_FORMAT", "png")
_EDIT_MAX_DIM = int(os.environ.get("OPENAI_IMAGE_EDIT_MAX_DIM", "2048"))
_EDIT_JPEG_QUALITY = 90

_COLOR_KEYWORDS = [
    "color", "colour", "red", "blue", "green", "black", "white", "pink",
    "yellow", "orange", "purple", "navy", "teal", "gold", "silver",
    "beige", "cream", "brown", "gray", "grey", "burgundy", "maroon",
    "coral", "lavender", "olive", "turquoise", "magenta", "crimson",
]
_SURGICAL_MARKERS = [
    " from ", "swap ", "replace the ", "instead of",
    "preserv", "while keep", "keep the ", "keeping the ",
    "intact", "untouched", "unchanged", "leave ",
    " areas ", "areas of", "specifically",
]
_COLOR_NAMES = (
    r"red|blue|green|black|white|pink|yellow|orange|purple|navy|teal|"
    r"gold|silver|beige|cream|brown|gray|grey|burgundy|maroon|coral|"
    r"lavender|olive|turquoise|magenta|crimson|off[\s-]?white"
)
_TWO_COLOR_RE = re.compile(
    rf"\b({_COLOR_NAMES})\b[\s\S]{{0,40}}?\b(to|into|with|for)\s+\b({_COLOR_NAMES})\b"
)


def _get_openai_client() -> OpenAI:
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _is_retryable(error: Exception) -> bool:
    message = str(error).lower()
    return "429" in message or "rate" in message or "temporarily" in message or "5" in message[:3]


def _with_retries(operation, label: str):
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            return operation()
        except Exception as error:
            last_error = error
            if not _is_retryable(error) or attempt == 2:
                raise
            wait_seconds = 2 ** (attempt + 1)
            print(f"[OpenAIImage] {label} retrying in {wait_seconds}s: {error}")
            time.sleep(wait_seconds)
    raise RuntimeError(f"{label} failed: {last_error}")


def _decode_base64_image(image_base64: str) -> bytes:
    raw = image_base64.split(",", 1)[1] if image_base64.startswith("data:") else image_base64
    return base64.b64decode(raw)


def _compress_for_edit(image_base64: str) -> tuple[bytes, str]:
    raw = _decode_base64_image(image_base64)
    image = Image.open(io.BytesIO(raw))
    original_format = (image.format or "PNG").upper()

    if max(image.size) <= _EDIT_MAX_DIM:
        return raw, "png" if original_format == "PNG" else "jpeg"

    ratio = _EDIT_MAX_DIM / max(image.size)
    resized = image.resize((int(image.width * ratio), int(image.height * ratio)), Image.LANCZOS)
    if resized.mode in ("RGBA", "P"):
        background = Image.new("RGB", resized.size, "white")
        if resized.mode == "P":
            resized = resized.convert("RGBA")
        background.paste(resized, mask=resized.getchannel("A"))
        resized = background

    buffer = io.BytesIO()
    resized.save(buffer, format="JPEG", quality=_EDIT_JPEG_QUALITY)
    print(f"[OpenAIImage] Resized edit input to {resized.width}x{resized.height}")
    return buffer.getvalue(), "jpeg"


def _build_art_direction_prompt(
    product_description: str,
    category: str,
    brand_style: dict,
    trend_colors: Optional[list],
    trend_materials: Optional[list],
) -> str:
    palette = ", ".join(
        f"{color.get('name', '')} ({color.get('hex', '')})"
        for color in brand_style.get("colorPalette", [])
    )
    lighting = brand_style.get("lightingConfig", {})
    camera = brand_style.get("cameraSettings", {})
    trend_context = []
    if trend_colors:
        trend_context.append("Trend colors: " + ", ".join(
            f"{color.get('name', '')} ({color.get('hex', '')})" for color in trend_colors[:4]
        ))
    if trend_materials:
        trend_context.append("Trend materials: " + ", ".join(
            material.get("name", "") for material in trend_materials[:3]
        ))

    return f"""You are a fashion art director preparing a production prompt for a product-image model.

Product: {product_description}
Category: {category}
Brand palette: {palette or 'Use the product specification'}
Lighting: {lighting.get('colorTemperature', 5000)}K studio lighting, key intensity {lighting.get('keyLightIntensity', 80)}%
Camera: {camera.get('defaultShot', 'front-facing e-commerce product view')}
Avoid: {', '.join(brand_style.get('negativePrompts', [])) or 'logos, watermarks, extra products, text overlays'}
{' | '.join(trend_context)}

Write only a precise production image prompt. It must show exactly one complete product, centered with generous padding, on a clean white or light-gray studio background. Preserve accurate colors, materials, proportions, and construction details. No person, mannequin, hanger, props, collage, alternate angle, logo, or text overlay."""


def _classify_edit_instruction(instruction: str) -> str:
    normalized = instruction.lower()
    is_color_change = any(keyword in normalized for keyword in _COLOR_KEYWORDS)
    has_surgical_scope = any(marker in normalized for marker in _SURGICAL_MARKERS)
    has_two_color_swap = bool(_TWO_COLOR_RE.search(normalized))
    if not is_color_change:
        return "other"
    return "surgical" if has_surgical_scope or has_two_color_swap else "global"


def _build_edit_prompt(instruction: str) -> str:
    mode = _classify_edit_instruction(instruction)
    if mode == "global":
        return f"""Edit this fashion product image.

Instruction: {instruction}

This is a whole-garment recolor. Recolor all garment panels to the requested color while preserving the silhouette, construction, camera angle, lighting, background, and neutral hardware unless specifically requested. Do not redesign the product."""
    if mode == "surgical":
        return f"""Edit this fashion product image.

Instruction: {instruction}

Make only the requested localized change. Identify the named garment part or source color and preserve every other panel, color, material, stitch, hardware element, silhouette, lighting, framing, and background. Do not redesign or restyle the product."""
    return f"""Edit this fashion product image.

Instruction: {instruction}

Make the requested change clearly while preserving the product silhouette, composition, lighting, camera angle, and clean studio background. Change only the described element and do not add logos or text."""


@cached(prefix="img_gen", ttl=86400)
def generate_product_image(
    product_description: str,
    category: str,
    brand_style: dict,
    trend_colors: Optional[list] = None,
    trend_materials: Optional[list] = None,
) -> str:
    """Generate a product image with OpenAI text planning plus GPT Image 2."""
    client = _get_openai_client()
    planning_prompt = _build_art_direction_prompt(
        product_description, category, brand_style, trend_colors, trend_materials
    )
    planning_response = _with_retries(
        lambda: client.responses.create(model=OPENAI_MODEL, input=planning_prompt),
        "art-direction planning",
    )
    image_prompt = planning_response.output_text.strip() or planning_prompt

    result = _with_retries(
        lambda: client.images.generate(
            model=OPENAI_IMAGE_MODEL,
            prompt=image_prompt,
            size=OPENAI_IMAGE_SIZE,
            quality=OPENAI_IMAGE_QUALITY,
            output_format=OPENAI_IMAGE_FORMAT,
        ),
        "image generation",
    )
    image_base64 = result.data[0].b64_json
    if not image_base64:
        raise ValueError("GPT Image 2 did not return image data")
    return image_base64


def edit_product_image(image_base64: str, edit_instruction: str) -> str:
    """Apply a natural-language fashion edit with GPT Image 2."""
    image_bytes, extension = _compress_for_edit(image_base64)
    prompt = _build_edit_prompt(edit_instruction)
    client = _get_openai_client()

    def request_edit():
        # The SDK consumes file streams. Create a new stream for every retry.
        image_file = io.BytesIO(image_bytes)
        image_file.name = f"product.{extension}"
        return client.images.edit(
            model=OPENAI_IMAGE_MODEL,
            image=image_file,
            prompt=prompt,
            size=OPENAI_IMAGE_SIZE,
            quality=OPENAI_IMAGE_QUALITY,
            output_format=OPENAI_IMAGE_FORMAT,
        )

    result = _with_retries(
        request_edit,
        "image edit",
    )
    edited_base64 = result.data[0].b64_json
    if not edited_base64:
        raise ValueError("GPT Image 2 did not return edited image data")
    return edited_base64
