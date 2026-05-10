"""
Image Generator
Uses OpenAI gpt-5.5 to create product image prompts (art-direction)
and Gemini 3 Pro Image to generate the actual images.
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
from openai import OpenAI

from shared.cache import cached

# Max dimension for images sent to the edit model (saves upload time + processing)
_EDIT_MAX_DIM = 1024
_EDIT_JPEG_QUALITY = 85


GEMINI_IMAGE_MODEL = os.environ.get("GEMINI_FLASH_IMAGE_MODEL", "gemini-3-pro-image-preview")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")


def get_client() -> genai.Client:
    """Gemini client — used for image generation only (response_modalities=['image'])."""
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


def _get_openai_client() -> OpenAI:
    """OpenAI client — used for the art-direction text prompt only."""
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


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

    openai_client = _get_openai_client()
    max_retries = 3
    response = None
    for attempt in range(max_retries):
        try:
            response = openai_client.responses.create(
                model=OPENAI_MODEL,
                input=analysis_prompt,
            )
            break
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e) or "rate" in str(e).lower():
                if attempt < max_retries - 1:
                    time.sleep(2 ** (attempt + 1))
                    continue
            raise

    image_prompt = response.output_text.strip()
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

    # ----- DEBUG: dump compressed input to /tmp so you can open the EXACT
    # bytes Gemini received ---------------------------------------------------
    try:
        from PIL import Image as _PI
        import io as _io
        _input_dims = _PI.open(_io.BytesIO(compressed_bytes)).size
        with open("/tmp/last-edit-input.jpg", "wb") as _f:
            _f.write(compressed_bytes)
        print(f"[Image Editor] Compressed input: {_input_dims[0]}x{_input_dims[1]} @ {len(compressed_bytes)/1024:.1f}KB ({mime_type}) → /tmp/last-edit-input.jpg")
    except Exception as _e:
        print(f"[Image Editor] (debug dump failed: {_e})")
        _input_dims = (None, None)

    # ----- Decide which edit MODE this instruction is asking for ---------
    # color-change: any color word (red/blue/orange/etc.) appears in the text.
    # global-recolor: a color-change instruction that targets the WHOLE
    #   garment — either explicit emphasis ("entirely", "everything"), or it
    #   only NAMES the destination color without specifying a source
    #   (e.g. "make it orange" — vs. "change the brown to orange" which
    #   names a source and wants surgical swap).
    color_keywords = [
        "color", "colour", "red", "blue", "green", "black", "white", "pink",
        "yellow", "orange", "purple", "navy", "teal", "gold", "silver",
        "beige", "cream", "brown", "gray", "grey", "burgundy", "maroon",
        "coral", "lavender", "olive", "turquoise", "magenta", "crimson",
    ]
    instr_lc = edit_instruction.lower()
    is_color_change = any(kw in instr_lc for kw in color_keywords)

    # Explicit "do it everywhere" markers. Anything in this list forces
    # global mode even if the user named a source color.
    global_markers = [
        "entire", "entirely", "everywhere", "everything", "all of it",
        "the whole", "completely", "all over", "fully recolor", "full recolor",
        "totally", "every part", "all the colors", "all colors",
    ]
    has_global_marker = any(m in instr_lc for m in global_markers)

    # Surgical signals: any phrasing that scopes the edit to a sub-region or
    # explicitly preserves other colours.
    # • "from X to Y" / "swap X for Y" / "replace the X" / "instead of"
    #   — classic source-named patterns
    # • "preserving" / "preserve" / "while keeping" / "keep the" / "intact" /
    #   "untouched" / "unchanged" / "leave …" — scope/preservation language
    #   that AI rephrasings (Lux) routinely produce. Without these, an
    #   instruction like "Change all off-white areas to black while preserving
    #   the red upper" gets misclassified as a global recolor.
    # • "areas " / "areas of " / "specifically" — region-targeting language.
    surgical_markers = [
        " from ", "swap ", "replace the ", "instead of",
        "preserv", "while keep", "keep the ", "keeping the ",
        "intact", "untouched", "unchanged", "leave ",
        " areas ", "areas of", "specifically",
    ]
    has_surgical_marker = any(m in instr_lc for m in surgical_markers)

    # Multi-color signal: short voice / text phrasings frequently name both
    # the source AND the target color directly without a "from" connector,
    # e.g. "change off-white to black", "make the white black", "navy to red".
    # When TWO distinct color names appear separated by " to " or one of a
    # few other connector words, that's a source→target swap → surgical.
    # The named-color set excludes meta-words like "color"/"colour".
    _COLOR_NAMES = (
        r"red|blue|green|black|white|pink|yellow|orange|purple|navy|teal|"
        r"gold|silver|beige|cream|brown|gray|grey|burgundy|maroon|coral|"
        r"lavender|olive|turquoise|magenta|crimson|off[\s-]?white"
    )
    import re as _re
    _two_color_swap = bool(_re.search(
        rf"\b({_COLOR_NAMES})\b[\s\S]{{0,40}}?\b(to|into|with|for)\s+\b({_COLOR_NAMES})\b",
        instr_lc,
    ))
    has_surgical_marker = has_surgical_marker or _two_color_swap

    # Global recolor: any color edit that has NO surgical scope/preservation
    # signal. A surgical signal always wins, even alongside a global marker
    # like "everything" (e.g. "leave everything else intact" reads as surgical).
    is_global_recolor = is_color_change and not has_surgical_marker

    print(f"[Image Editor] is_color_change={is_color_change}  "
          f"is_global_recolor={is_global_recolor}  "
          f"has_global_marker={has_global_marker}  "
          f"has_surgical_marker={has_surgical_marker}")

    if is_global_recolor:
        edit_prompt = f"""Edit the colors of this fashion product image.

INSTRUCTION: {edit_instruction}

This is a GLOBAL RECOLOR request — the user wants the WHOLE garment to take on the new color, not just a single panel. You MUST:
1. Recolor ALL of the garment's existing colors to the requested new color, except for genuinely neutral elements (zippers, eyelets, white soles or stitching that are clearly hardware/accessories).
2. Treat the entire upper / body / panels as one unit — do NOT preserve red, brown, or any other original color in those areas.
3. The result must read as predominantly the new color when viewed at a glance.
4. The new color must be SATURATED and VIVID — not a subtle tint.
5. Keep the exact same garment shape, silhouette, background, lighting, camera angle, and composition.
6. Keep accessory hardware (zippers, eyelets, laces, buckles) and the sole / outsole intact unless they were obviously the recolored target.

CRITICAL: this is NOT a surgical color swap. The whole garment changes color."""
    elif is_color_change:
        # Google's documented pattern for selective edits names the OBJECT,
        # not just the color. Their canonical example:
        #   "Change only the blue sofa to a vintage brown leather chesterfield.
        #    Keep the rest of the room unchanged."
        # We don't know which physical part of THIS garment is the source
        # colour, so we ask the model to identify it itself, then produce
        # the same "change only [the part that is X]; keep the rest" structure.
        edit_prompt = f"""You are editing a fashion product image. Follow the targeted-edit pattern below exactly.

USER INSTRUCTION (verbatim): {edit_instruction}

Step 1 — Look at the image and silently identify which specific PART of the garment is currently the SOURCE color named in the instruction. Examples of "parts": sole / upper / laces / lining / collar / cuffs / pocket / belt / trim / zipper / yoke / waistband / hem.

Step 2 — Produce the edit using this exact structure (paraphrased mentally, not in your output):
    "Change only the [identified part] (currently [source colour]) to [target colour].
     Keep every other part of the garment — including all other colors, materials,
     stitching, hardware, lighting, shadows, and background — pixel-for-pixel identical."

HARD RULES:
• Only the part that holds the source colour changes. Every other part stays bit-faithful to the input.
• If the original garment has multiple distinct colors, the result MUST also have multiple distinct colors. A single-colour result for a multi-colour input is a failure.
• Do not redesign, restyle, or "improve" the garment.
• Keep silhouette, framing, camera angle, lighting, and background unchanged.
• The new colour must be saturated and vivid, not a subtle tint.

Concrete examples (apply by analogy — do NOT copy these literally):
• Input: red-orange sneaker with off-white sole. Instruction: "change off-white to black".
   → Output: same red-orange upper, sole turned black. UPPER STAYS RED-ORANGE.
• Input: blue jacket with brown trim. Instruction: "change brown to gold".
   → Output: same blue body, only the trim turns gold. BODY STAYS BLUE.
• Input: grey pants with white waistband. Instruction: "change white to navy".
   → Output: same grey legs, only the waistband turns navy. LEGS STAY GREY."""
    else:
        edit_prompt = f"""Edit this fashion product image. Apply this change clearly and visibly:
{edit_instruction}

RULES:
- Make the requested change OBVIOUS and DRAMATIC — the result must look visibly different
- Preserve the garment silhouette, composition, lighting, and background
- Only change the specific element mentioned (color, material, length, etc.)
- Maintain professional e-commerce product photography quality
- The change must be immediately noticeable when comparing before and after"""

    _temp = 0.8 if is_color_change else 0.5
    print(f"[Image Editor] Mode: color_change={is_color_change} global_recolor={is_global_recolor} "
          f"global_marker={has_global_marker} surgical_marker={has_surgical_marker} temp={_temp}")
    print(f"[Image Editor] Model: {GEMINI_EDIT_IMAGE_MODEL}")
    print(f"[Image Editor] === PROMPT TO GEMINI (verbatim, {len(edit_prompt)} chars) ===")
    print(edit_prompt)
    print(f"[Image Editor] === END PROMPT ===")

    # Stash the exact request artefacts on disk so /debug/last-edit can serve
    # them and a developer can reproduce offline.
    try:
        with open("/tmp/last-edit-prompt.txt", "w") as _f:
            _f.write(f"INSTRUCTION: {edit_instruction}\nMODEL: {GEMINI_EDIT_IMAGE_MODEL}\nMODE: color_change={is_color_change} global_recolor={is_global_recolor} temp={_temp}\n\n=== PROMPT ===\n{edit_prompt}\n")
    except Exception:
        pass

    max_retries = 3
    response = None
    _t_start = time.time()
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_EDIT_IMAGE_MODEL,
                contents=[image_part, edit_prompt],
                config=types.GenerateContentConfig(
                    response_modalities=["image"],
                    temperature=_temp,
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

    _elapsed = time.time() - _t_start
    _finish = "?"
    try:
        if getattr(response, "candidates", None):
            _finish = str(getattr(response.candidates[0], "finish_reason", "?"))
    except Exception:
        pass
    print(f"[Image Editor] Response received in {_elapsed:.1f}s. finish_reason={_finish} parts={len(response.parts)}")
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

    # Dump result image so /debug/last-edit can serve it
    try:
        with open("/tmp/last-edit-output.png", "wb") as _f:
            _f.write(edited_image)
        from PIL import Image as _PI2
        import io as _io2
        _out_dims = _PI2.open(_io2.BytesIO(edited_image)).size
        print(f"[Image Editor] Result: {_out_dims[0]}x{_out_dims[1]} @ {len(edited_image)/1024:.1f}KB → /tmp/last-edit-output.png")
    except Exception as _e:
        print(f"[Image Editor] (output dump failed: {_e})")

    result_b64 = base64.b64encode(edited_image).decode("utf-8")
    input_size = len(image_base64)
    output_size = len(result_b64)
    same = (result_b64 == image_base64)
    print(f"[Image Editor] === EDIT COMPLETE ===")
    print(f"[Image Editor] Output image size: {output_size:,} chars")
    print(f"[Image Editor] Same as input: {same}")
    print(f"[Image Editor] Size delta: {output_size - input_size:+,} chars")

    return result_b64
