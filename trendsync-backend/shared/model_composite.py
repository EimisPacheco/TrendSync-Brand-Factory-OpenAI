"""Create model-and-garment composites with GPT Image 2 multi-image editing."""

import base64
import io
import os
import time

from openai import OpenAI


OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_QUALITY = os.environ.get("OPENAI_IMAGE_QUALITY", "medium")

COMPOSITE_PROMPT = """Image 1 is a fashion model in a neutral pose. Image 2 is a garment.
Dress the model in the garment from Image 2. Keep the model's face, hair, skin tone, body proportions,
and pose unchanged. Preserve the garment's colors, materials, silhouette, and construction details.
Use a seamless white studio background. Create a photorealistic editorial fashion image with no logos or text."""


def _image_file(image_base64: str, name: str) -> io.BytesIO:
    raw = image_base64.split(",", 1)[1] if image_base64.startswith("data:") else image_base64
    image_file = io.BytesIO(base64.b64decode(raw))
    image_file.name = name
    return image_file


def composite_model_with_product(model_image_b64: str, product_image_b64: str) -> str:
    """Dress the model in the product image using a multi-image natural-language edit."""
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = None
    for attempt in range(3):
        try:
            # New file objects are required because the SDK consumes streams.
            response = client.images.edit(
                model=OPENAI_IMAGE_MODEL,
                image=[
                    _image_file(model_image_b64, "model.png"),
                    _image_file(product_image_b64, "product.png"),
                ],
                prompt=COMPOSITE_PROMPT,
                size="1024x1536",
                quality=OPENAI_IMAGE_QUALITY,
                output_format="png",
            )
            break
        except Exception as error:
            if attempt == 2 or not any(token in str(error).lower() for token in ("429", "rate", "temporarily", "500", "502", "503")):
                raise
            time.sleep(2 ** (attempt + 1))

    if response is None:
        raise RuntimeError("GPT Image 2 did not return a model composite")
    image_base64 = response.data[0].b64_json
    if not image_base64:
        raise ValueError("GPT Image 2 did not return a model composite")
    return image_base64
