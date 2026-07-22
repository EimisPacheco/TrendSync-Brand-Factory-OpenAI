"""
Trend Intelligence Engine
Uses OpenAI's Responses API with the hosted `web_search` tool for real-time
fashion trend analysis.
"""

import os
import json
import re
import time
from typing import Any, Dict, List, Optional

from openai import OpenAI

from shared.cache import cached


# Trend search is bound by the *slowest* leg in the pipeline: a hosted
# web_search call + reasoning. GPT-5.6 Sol's default reasoning ("medium") on a
# search-heavy prompt is unnecessarily expensive for this retrieval task.
# GPT-5.6 Terra with effort=low preserves search quality while keeping latency
# and cost appropriate for the high-throughput trend route.
#
# Override via OPENAI_TREND_MODEL / OPENAI_TREND_EFFORT to fine-tune.
OPENAI_MODEL = os.environ.get(
    "OPENAI_TREND_MODEL", os.environ.get("OPENAI_MODEL", "gpt-5.6-terra")
)
OPENAI_EFFORT = os.environ.get("OPENAI_TREND_EFFORT", "low")  # "minimal" disallowed w/ web_search

def get_client() -> OpenAI:
    """Create an OpenAI client using OPENAI_API_KEY from the environment."""
    print(f"[TrendEngine] Using OpenAI Responses API (model={OPENAI_MODEL}, effort={OPENAI_EFFORT})")
    return OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _web_search_text(client: OpenAI, prompt: str, temperature: float = 0.7) -> str:
    """
    Call OpenAI's Responses API with the hosted `web_search` tool and return
    the plain text output. The two-pass JSON pattern (grounded text -> parsed
    JSON) is preserved because hosted-search tools are typically incompatible
    with strict structured-output formats — we therefore do NOT pass any
    response_format parameter here.

    Reasoning models (gpt-5.x) reject `temperature`, so we omit it for those
    models and only pass it for the legacy gpt-4.x family that still supports it.
    Reasoning effort is "low" by default — web_search bans "minimal".
    """
    kwargs: dict = {
        "model": OPENAI_MODEL,
        "input": prompt,
        "tools": [{"type": "web_search"}],
    }
    if OPENAI_MODEL.startswith("gpt-4"):
        kwargs["temperature"] = temperature
    elif OPENAI_EFFORT and OPENAI_EFFORT.lower() not in ("none", "off", ""):
        # gpt-5.x reasoning models accept reasoning effort; pass only if requested.
        # ("none"/"off"/empty -> omit the param entirely so the model decides).
        kwargs["reasoning"] = {"effort": OPENAI_EFFORT}
    response = client.responses.create(**kwargs)
    return response.output_text


def _repair_truncated_json(text: str) -> str:
    """Attempt to repair truncated JSON by closing open brackets/braces and strings."""
    # Track open delimiters
    in_string = False
    escape_next = False
    open_stack: list[str] = []
    last_idx = 0

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            open_stack.append(ch)
            last_idx = i
        elif ch == '}' and open_stack and open_stack[-1] == '{':
            open_stack.pop()
            last_idx = i
        elif ch == ']' and open_stack and open_stack[-1] == '[':
            open_stack.pop()
            last_idx = i

    if not open_stack:
        return text  # Nothing to repair

    # Close open string if needed
    repaired = text
    if in_string:
        repaired += '"'

    # Remove trailing comma or incomplete key-value pairs
    repaired = re.sub(r',\s*$', '', repaired.rstrip())

    # Close all open brackets/braces in reverse order
    for ch in reversed(open_stack):
        repaired += '}' if ch == '{' else ']'

    return repaired


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
    # Last resort: try repairing truncated JSON (LLMs sometimes cut off mid-response)
    for start_char in ["{", "["]:
        start = text.find(start_char)
        if start != -1:
            candidate = text[start:]
            repaired = _repair_truncated_json(candidate)
            try:
                result = json.loads(repaired)
                print(f"[TrendEngine] Repaired truncated JSON ({len(candidate)} → {len(repaired)} chars)")
                return result
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
    """Transform raw trend-search JSON into normalised TrendInsights."""
    if not trend_data.get("key_colors"):
        raise ValueError("No color trends returned from trend search")
    if not trend_data.get("trending_styles"):
        raise ValueError("No style trends returned from trend search")

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
    Fetch fashion trend insights using OpenAI Responses API + hosted web_search.
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

    max_retries = 3
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            text = _web_search_text(client, prompt, temperature=0.7)

            t1 = time.time()
            print(f"[TrendEngine] OpenAI response received in {t1 - t0:.1f}s ({len(text)} chars)")
            print(f"[TrendEngine] === RAW AI RESPONSE (Trends) ===")
            print(text[:3000])
            print(f"[TrendEngine] === END RAW RESPONSE ===")

            trend_data = _extract_json(text)
            result = _transform_to_insights(
                trend_data,
                is_celebrity,
                {"season": season, "region": region, "demographic": demographic},
            )
            print(f"[TrendEngine] fetch_trends complete in {time.time() - t0:.1f}s — {len(result.get('colors', []))} colors, {len(result.get('silhouettes', []))} styles")
            return result

        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
            print(f"[TrendEngine] JSON parse/validation failed (attempt {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                time.sleep(2 * attempt)
                continue
        except Exception as e:
            err_msg = str(e)
            # Permanent: no quota / billing — retrying is pure waste. Fail fast.
            if "insufficient_quota" in err_msg or "billing" in err_msg.lower():
                print(f"[TrendEngine] Account out of quota — failing fast (no retry).")
                raise
            # Transient throttling: retry with backoff.
            if ("429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "rate limit" in err_msg.lower()) and attempt < max_retries:
                wait = 5 * attempt
                print(f"[TrendEngine] Rate limited (attempt {attempt}/{max_retries}), retrying in {wait}s...")
                last_error = e
                time.sleep(wait)
                continue
            raise

    raise last_error or ValueError("fetch_trends failed after all retries")


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

    max_retries = 3
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            text = _web_search_text(client, prompt, temperature=0.7)

            t1 = time.time()
            print(f"[TrendEngine] Celebrity list OpenAI response in {t1 - t0:.1f}s ({len(text)} chars)")

            celebrities = _extract_json(text)
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

        except (ValueError, json.JSONDecodeError) as e:
            last_error = e
            print(f"[TrendEngine] Celebrity list JSON failed (attempt {attempt}/{max_retries}): {e}")
            if attempt < max_retries:
                time.sleep(2 * attempt)
                continue
        except Exception as e:
            err_msg = str(e)
            # Permanent: no quota / billing — retrying is pure waste. Fail fast.
            if "insufficient_quota" in err_msg or "billing" in err_msg.lower():
                print(f"[TrendEngine] Account out of quota — failing fast (no retry).")
                raise
            # Transient throttling: retry with backoff.
            if ("429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "rate limit" in err_msg.lower()) and attempt < max_retries:
                wait = 5 * attempt
                print(f"[TrendEngine] Rate limited (attempt {attempt}/{max_retries}), retrying in {wait}s...")
                last_error = e
                time.sleep(wait)
                continue
            raise

    raise last_error or ValueError("fetch_celebrity_list failed after all retries")
