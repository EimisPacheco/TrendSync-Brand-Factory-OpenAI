"""
Trend Intelligence Engine
Uses Gemini 2.5 Flash with Google Search grounding for real-time fashion trend analysis.
Port of gemini-trends.ts to Python using Vertex AI.
"""

import os
import json
import re
import time
from typing import Any, Dict, List, Optional
from google import genai
from google.genai import types

from shared.cache import cached


GEMINI_FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-ca52e7fa-d4e3-47fa-9df")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")


def get_client() -> genai.Client:
    """Create Gemini client using Vertex AI with service account credentials."""
    print(f"[TrendEngine] Using Vertex AI auth (project={PROJECT_ID}, location={LOCATION})")
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)


def _extract_json(text: str) -> Any:
    """Extract JSON from a response that may contain markdown fences or extra text."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting from ```json ... ``` fences
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass
    # Try finding first { or [ and matching to last } or ]
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        start = text.find(start_char)
        end = text.rfind(end_char)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Could not extract JSON from response: {text[:200]}")


# --------------------------------------------------------------------------
# Data types
# --------------------------------------------------------------------------

def _transform_to_insights(
    trend_data: Dict[str, Any],
    is_celebrity: bool,
    config: Dict[str, str],
) -> Dict[str, Any]:
    """Transform raw Gemini JSON into normalised TrendInsights."""
    if not trend_data.get("key_colors"):
        raise ValueError("No color trends returned from Gemini")
    if not trend_data.get("trending_styles"):
        raise ValueError("No style trends returned from Gemini")

    insights: Dict[str, Any] = {
        "colors": [
            {
                "name": c.get("color", ""),
                "hex": c.get("hex", "#808080") if c.get("hex", "").startswith("#") else "#808080",
                "confidence": 90 - i * 5,
                "description": c.get("description", ""),
            }
            for i, c in enumerate(trend_data["key_colors"])
        ],
        "silhouettes": [
            {
                "name": s.get("name", ""),
                "confidence": 88 - i * 5,
                "description": s.get("description", ""),
            }
            for i, s in enumerate(trend_data["trending_styles"])
        ],
        "materials": [
            {
                "name": m.get("name", ""),
                "confidence": 85 - i * 5,
                "description": m.get("description", ""),
            }
            for i, m in enumerate(trend_data.get("materials", []))
        ],
        "themes": [
            {
                "name": t.get("name", ""),
                "confidence": 87 - i * 5,
                "description": t.get("description", ""),
            }
            for i, t in enumerate(trend_data.get("themes", []))
        ],
    }

    if is_celebrity and trend_data.get("celebrities"):
        insights["celebrities"] = [
            {
                "name": ce.get("name", ""),
                "profession": ce.get("profession", ""),
                "signature_style": ce.get("signature_style", ""),
                "influence_score": 95 - i * 5,
            }
            for i, ce in enumerate(trend_data["celebrities"])
        ]

    insights["summary"] = (
        f"Celebrity fashion trends for {config.get('demographic', 'millennials')} inspired by top influencers"
        if is_celebrity
        else f"Fashion trends for {config.get('demographic', 'millennials')} in {config.get('region', 'global')} for {config.get('season', _current_season())}"
    )

    return insights


# --------------------------------------------------------------------------
# Prompt builders
# --------------------------------------------------------------------------

def _build_celebrity_prompt(demographic: str) -> str:
    return f"""Search for current fashion trends from 10 influential US celebrities (2024-2025) for the {demographic} demographic.

Return a JSON object with these fields:
{{
  "key_colors": [
    {{"color": "Color name", "hex": "#HEXCODE", "description": "Which celebrities wear it"}}
  ],
  "trending_styles": [
    {{"name": "Style Name", "description": "Celebrity style description"}}
  ],
  "materials": [
    {{"name": "Material Name", "description": "How celebrities style it"}}
  ],
  "themes": [
    {{"name": "Theme Name", "description": "Theme description"}}
  ],
  "celebrities": [
    {{"name": "Name", "profession": "Profession", "signature_style": "Style"}}
  ]
}}

Include 4-6 colors with real hex codes, 3-5 styles, 3-5 materials, 2-3 themes, and 10 celebrities."""


def _build_regional_prompt(season: str, region: str, demographic: str) -> str:
    return f"""Search for current fashion trends for {demographic} in {region} for {season}.

Return a JSON object:
{{
  "key_colors": [
    {{"color": "Color name", "hex": "#HEXCODE", "description": "Why trending"}}
  ],
  "trending_styles": [
    {{"name": "Style Name", "description": "Style description"}}
  ],
  "materials": [
    {{"name": "Material Name", "description": "Why popular"}}
  ],
  "themes": [
    {{"name": "Theme Name", "description": "Theme description"}}
  ]
}}

Include 4-6 colors with real hex codes, 3-5 styles, 3-5 materials, and 2-3 themes based on current real-world fashion trend data."""


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def _current_season() -> str:
    """Return the current fashion season based on today's date."""
    import datetime
    now = datetime.date.today()
    month, year = now.month, now.year
    if month < 3:
        return f"Winter {year - 1}"
    if month < 6:
        return f"Spring {year}"
    if month < 9:
        return f"Summer {year}"
    return f"Fall {year}"


@cached(prefix="trends", ttl=86400)  # 24h cache — same params = same trends
def fetch_trends(
    season: str = "",
    region: str = "global",
    demographic: str = "millennials",
    trend_source: str = "regional",
) -> Dict[str, Any]:
    """
    Fetch fashion trend insights using Gemini + Google Search grounding.
    """
    if not season:
        season = _current_season()
    client = get_client()
    is_celebrity = trend_source == "celebrity"

    prompt = (
        _build_celebrity_prompt(demographic)
        if is_celebrity
        else _build_regional_prompt(season, region, demographic)
    )

    print(f"[TrendEngine] fetch_trends(source={trend_source}, region={region}, season={season}, demo={demographic})")
    t0 = time.time()

    response = client.models.generate_content(
        model=GEMINI_FLASH_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.7,
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )

    t1 = time.time()
    print(f"[TrendEngine] Gemini response received in {t1 - t0:.1f}s ({len(response.text)} chars)")
    print(f"[TrendEngine] === RAW AI RESPONSE (Trends) ===")
    print(response.text[:3000])
    print(f"[TrendEngine] === END RAW RESPONSE ===")

    trend_data = _extract_json(response.text)
    result = _transform_to_insights(
        trend_data,
        is_celebrity,
        {"season": season, "region": region, "demographic": demographic},
    )
    print(f"[TrendEngine] fetch_trends complete in {time.time() - t0:.1f}s — {len(result.get('colors', []))} colors, {len(result.get('silhouettes', []))} styles")
    return result


@cached(prefix="celebrities", ttl=86400)  # 24h cache
def fetch_celebrity_list(demographic: str = "millennials") -> List[Dict[str, Any]]:
    """Fetch top 10 influential fashion celebrities."""
    print(f"[TrendEngine] fetch_celebrity_list(demographic={demographic})")
    t0 = time.time()
    client = get_client()

    prompt = f"""Search for and list the top 10 most influential fashion celebrities in 2024-2025 for the {demographic} demographic. Include actors, musicians, athletes, and influencers.

For each celebrity, provide their signature colors (with hex codes), 2-3 iconic looks, and 3 preferred fashion brands.

Return a JSON array:
[
  {{
    "name": "Celebrity Name",
    "profession": "Singer/Actor/Athlete/Social media influencer/Model",
    "signature_style": "A 1-2 sentence description of their overall fashion style and aesthetic",
    "influence_score": 95,
    "signature_colors": [
      {{"color": "Color Name", "hex": "#HEXCODE"}},
      {{"color": "Color Name", "hex": "#HEXCODE"}}
    ],
    "signature_looks": [
      "Iconic outfit or look description",
      "Another iconic outfit or look description"
    ],
    "preferred_brands": ["Brand1", "Brand2", "Brand3"]
  }}
]

Include exactly 10 celebrities with real, accurate data."""

    response = client.models.generate_content(
        model=GEMINI_FLASH_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.7,
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )

    t1 = time.time()
    print(f"[TrendEngine] Celebrity list Gemini response in {t1 - t0:.1f}s ({len(response.text)} chars)")

    celebrities = _extract_json(response.text)
    if isinstance(celebrities, dict) and "celebrities" in celebrities:
        celebrities = celebrities["celebrities"]
    if not isinstance(celebrities, list):
        celebrities = [celebrities] if isinstance(celebrities, dict) else []

    return [
        {
            **celeb,
            "influence_score": celeb.get("influence_score", 95 - i * 3),
        }
        for i, celeb in enumerate(celebrities)
    ]
