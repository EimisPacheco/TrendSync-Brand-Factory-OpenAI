"""
Seed Company Models catalog.

Generates 10 diverse fashion-model portraits via OpenAI Images, uploads each
to GCS (`trendsync-fal-media/models/<uuid>.png`), and inserts a row into the
Supabase `company_models` table via the public REST API (RLS allows anon
inserts).

Run:
    cd trendsync-backend
    python -m scripts.seed_company_models
"""

import os
import sys
import json
import uuid
import base64
from pathlib import Path

# --------------------------------------------------------------------------
# Load env from the frontend .env at project root (two levels up from scripts/)
# --------------------------------------------------------------------------
try:
    from dotenv import load_dotenv

    _here = Path(__file__).resolve().parent
    # scripts/ is inside trendsync-backend/, so .env lives at ../../.env
    _env_path = _here.parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
    # Also try the backend-local .env if present
    _backend_env = _here.parent / ".env"
    if _backend_env.exists():
        load_dotenv(_backend_env, override=False)
except Exception:
    pass


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_SIZE = os.environ.get("OPENAI_IMAGE_SIZE", "1024x1536")

GCS_PROJECT = os.environ.get("GCS_PROJECT") or os.environ.get(
    "GOOGLE_CLOUD_PROJECT", "gen-lang-client-0106761350"
)
GCS_BUCKET = os.environ.get("GCS_BUCKET", "trendsync-fal-media")
GCS_CREDENTIALS = os.environ.get("GCS_CREDENTIALS") or os.environ.get(
    "GOOGLE_APPLICATION_CREDENTIALS"
)

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get(
    "SUPABASE_URL", ""
)
SUPABASE_ANON_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get(
    "SUPABASE_ANON_KEY", ""
)


ROSTER = [
    {"name": "Mei",       "description": "East Asian, long black straight hair, petite, minimalist vibe"},
    {"name": "Amara",     "description": "Black, short curly hair, athletic build, streetwear vibe"},
    {"name": "Sofia",     "description": "Latina, long wavy brown hair, curvy build, glam vibe"},
    {"name": "Priya",     "description": "South Asian, long black wavy hair, tall, editorial vibe"},
    {"name": "Astrid",    "description": "Nordic, platinum blonde bob, slim, high-fashion vibe"},
    {"name": "Layla",     "description": "Middle Eastern, long dark wavy hair, average build, classic vibe"},
    {"name": "Nia",       "description": "Mixed Black/White, long red curly hair, tall, bohemian vibe"},
    {"name": "Camila",    "description": "Latina, short blonde pixie, athletic, sporty vibe"},
    {"name": "Yuki",      "description": "East Asian, long bleached hair, petite, avant-garde vibe"},
    {"name": "Zara",      "description": "Black, long box braids, curvy, streetwear vibe"},
    {"name": "Joan",      "description": "Mediterranean European, mid-50s, shoulder-length silver hair, slim build, mature elegant high-fashion vibe"},
    {"name": "Anika",     "description": "South Asian, long brown wavy hair, plus-size confident build, body-positive modern editorial vibe"},
]


PROMPT_TEMPLATE = (
    "Editorial fashion full-body photograph of a {description} woman, "
    "standing in a relaxed neutral pose with arms slightly away from torso, "
    "neutral expression, plain seamless white studio background, "
    "soft frontal studio lighting, photorealistic, no garment logos, "
    "no accessories, no text."
)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def parse_attributes(description: str) -> dict:
    """Parse the comma-separated description into structured attributes.

    Order is: ethnicity, hair, build, vibe.
    """
    parts = [p.strip() for p in description.split(",")]
    attrs = {"ethnicity": "", "hair": "", "build": "", "vibe": ""}
    keys = ["ethnicity", "hair", "build", "vibe"]
    for i, part in enumerate(parts[: len(keys)]):
        attrs[keys[i]] = part
    return attrs


def get_storage_client():
    """Return an authenticated google-cloud-storage Client."""
    from google.cloud import storage

    if GCS_CREDENTIALS and os.path.exists(GCS_CREDENTIALS):
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_file(
            GCS_CREDENTIALS
        )
        return storage.Client(project=GCS_PROJECT, credentials=credentials)
    return storage.Client(project=GCS_PROJECT)


def upload_png_to_gcs(image_bytes: bytes, object_name: str) -> str:
    """Upload PNG bytes to GCS and return the public URL.

    The bucket has uniform bucket-level access with allUsers:objectViewer
    granted, so every object is readable at storage.googleapis.com without
    per-object ACLs or signed URLs.
    """
    from google.cloud import storage  # noqa: F401

    client = get_storage_client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(object_name)
    blob.upload_from_string(image_bytes, content_type="image/png")
    return f"https://storage.googleapis.com/{GCS_BUCKET}/{object_name}"


def generate_portrait_b64(description: str) -> str:
    """Generate a portrait image with OpenAI Images. Returns base64 PNG."""
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)
    prompt = PROMPT_TEMPLATE.format(description=description)

    # gpt-image-* models always return b64_json by default and reject
    # `response_format`. Older DALL·E models default to URLs but still
    # populate b64_json when asked — the fallback below handles either.
    result = client.images.generate(
        model=OPENAI_IMAGE_MODEL,
        prompt=prompt,
        size=OPENAI_IMAGE_SIZE,
        n=1,
        quality="medium",
    )

    data = result.data[0]
    if getattr(data, "b64_json", None):
        return data.b64_json
    # Some SDK versions stream URL only — fetch and convert.
    if getattr(data, "url", None):
        import requests

        r = requests.get(data.url, timeout=30)
        r.raise_for_status()
        return base64.b64encode(r.content).decode("utf-8")
    raise RuntimeError("OpenAI Images response did not contain image data")


def insert_supabase_row(payload: dict) -> dict:
    """POST a row to Supabase company_models via REST API. Returns the row."""
    import requests

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError(
            "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in env"
        )

    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/company_models"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=20)
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase insert failed ({r.status_code}): {r.text}")
    rows = r.json()
    return rows[0] if isinstance(rows, list) and rows else {}


def fetch_existing_names() -> set[str]:
    """Return the set of names already present in company_models."""
    import requests

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return set()
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/company_models?select=name"
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code >= 300:
            return set()
        return {row.get("name", "") for row in r.json() if row.get("name")}
    except Exception:
        return set()


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    if not OPENAI_API_KEY:
        print("[seed] ERROR: OPENAI_API_KEY not set in env")
        return 1
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print("[seed] ERROR: Supabase URL/anon key not in env")
        return 1

    # Idempotency — skip names already in Supabase (avoid re-paying OpenAI).
    existing = fetch_existing_names()
    if existing:
        print(f"[seed] {len(existing)} models already present, will skip them: {sorted(existing)}")

    total = len(ROSTER)
    successes = 0
    skipped = 0
    for i, model in enumerate(ROSTER, start=1):
        name = model["name"]
        description = model["description"]
        if name in existing:
            print(f"[seed] {i}/{total} SKIP {name} (already in DB)")
            skipped += 1
            continue
        try:
            img_b64 = generate_portrait_b64(description)
            image_bytes = base64.b64decode(img_b64)

            object_name = f"models/{uuid.uuid4().hex}.png"
            gcs_url = upload_png_to_gcs(image_bytes, object_name)

            payload = {
                "name": name,
                "description": description,
                "image_url": gcs_url,
                "attributes": parse_attributes(description),
            }
            insert_supabase_row(payload)

            successes += 1
            print(f"[seed] {i}/{total} OK {name} -> {gcs_url}")
        except Exception as e:
            print(f"[seed] {i}/{total} FAIL {name} -> {e}")
    print(f"[seed] done: {successes}/{total} new, {skipped} already present")

    print(f"[seed] done: {successes}/{total} models seeded")
    return 0 if successes == total else 2


if __name__ == "__main__":
    sys.exit(main())
