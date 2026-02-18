"""Image utility functions shared across services."""

import base64
import io
import logging

from PIL import Image

logger = logging.getLogger(__name__)


def resize_image_b64(image_base64: str, max_size: int = 768) -> bytes:
    """Decode base64 image, resize to max_size px, return JPEG bytes."""
    img_data = image_base64
    if img_data.startswith("data:"):
        img_data = img_data.split(",", 1)[1]

    raw = base64.b64decode(img_data)
    img = Image.open(io.BytesIO(raw))
    img.thumbnail((max_size, max_size), Image.LANCZOS)

    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    logger.info(f"[Image resize] {len(raw)} bytes → {buf.tell()} bytes ({img.size[0]}x{img.size[1]})")
    return buf.getvalue()
