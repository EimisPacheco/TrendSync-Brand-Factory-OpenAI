#!/usr/bin/env python3
import json
import os
import sys
from typing import Dict, Any, List
from urllib.parse import quote

import requests


BOARD_ID = os.getenv("MIRO_BOARD_ID", "uXjVHVyoNw8=")
API_BASE = "https://api.miro.com/v2"
TOKEN = os.getenv("MIRO_ACCESS_TOKEN", "")

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-sol")
OPENAI_TREND_MODEL = os.getenv("OPENAI_TREND_MODEL", "gpt-5.6-terra")
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_VOICE_MODEL", "gpt-realtime-2.1")
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_VIDEO_MODEL = os.getenv("OPENAI_VIDEO_MODEL", "sora-2-pro")

if not TOKEN:
    print("MIRO_ACCESS_TOKEN is required", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}


def req(method: str, path: str, *, params: Dict[str, Any] | None = None, payload: Dict[str, Any] | None = None, expected: List[int] | None = None) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    r = requests.request(method, url, headers=HEADERS, params=params, data=json.dumps(payload) if payload is not None else None, timeout=30)
    if expected is None:
        expected = [200, 201]
    if r.status_code not in expected:
        raise RuntimeError(f"{method} {path} failed ({r.status_code}): {r.text[:800]}")
    if r.status_code == 204 or not r.text:
        return {}
    return r.json()


def list_items() -> List[Dict[str, Any]]:
    encoded = quote(BOARD_ID, safe="")
    body = req("GET", f"/boards/{encoded}/items", params={"limit": 50})
    return body.get("data", [])


def list_connectors() -> List[Dict[str, Any]]:
    encoded = quote(BOARD_ID, safe="")
    body = req("GET", f"/boards/{encoded}/connectors", params={"limit": 50})
    return body.get("data", [])


def delete_connector(connector_id: str) -> None:
    encoded = quote(BOARD_ID, safe="")
    req("DELETE", f"/boards/{encoded}/connectors/{connector_id}", expected=[204])


def delete_item(item_type: str, item_id: str) -> None:
    encoded = quote(BOARD_ID, safe="")
    endpoint = {
        "frame": "frames",
        "shape": "shapes",
        "text": "texts",
    }.get(item_type)
    if not endpoint:
        return
    req("DELETE", f"/boards/{encoded}/{endpoint}/{item_id}", expected=[204])


def create_frame(title: str, x: float, y: float, w: float, h: float) -> str:
    encoded = quote(BOARD_ID, safe="")
    payload = {
        "data": {"title": title, "format": "custom"},
        "position": {"x": x, "y": y},
        "geometry": {"width": w, "height": h},
    }
    return req("POST", f"/boards/{encoded}/frames", payload=payload).get("id", "")


def create_text(content: str, x: float, y: float, width: float = 700) -> str:
    encoded = quote(BOARD_ID, safe="")
    payload = {
        "data": {"content": content},
        "position": {"x": x, "y": y},
        "geometry": {"width": width},
    }
    return req("POST", f"/boards/{encoded}/texts", payload=payload).get("id", "")


def create_card(content: str, x: float, y: float, w: float, h: float, fill: str, border: str = "#CBD5E1") -> str:
    encoded = quote(BOARD_ID, safe="")
    payload = {
        "data": {"shape": "round_rectangle", "content": content},
        "position": {"x": x, "y": y},
        "geometry": {"width": w, "height": h},
        "style": {
            "fillColor": fill,
            "fillOpacity": 1,
            "borderColor": border,
            "borderWidth": 2,
            "fontFamily": "arial",
            "fontSize": 18,
        },
    }
    return req("POST", f"/boards/{encoded}/shapes", payload=payload).get("id", "")


def create_connector(start_id: str, end_id: str, start_snap: str = "right", end_snap: str = "left") -> str:
    encoded = quote(BOARD_ID, safe="")
    payload = {
        "startItem": {"id": start_id, "snapTo": start_snap},
        "endItem": {"id": end_id, "snapTo": end_snap},
        "style": {
            "strokeColor": "#5B6B85",
            "strokeWidth": 2,
            "strokeStyle": "normal",
            "endStrokeCap": "arrow",
        },
    }
    return req("POST", f"/boards/{encoded}/connectors", payload=payload).get("id", "")


def main() -> None:
    old_connectors = list_connectors()
    for c in old_connectors:
        cid = c.get("id")
        if cid:
            delete_connector(cid)

    old_items = list_items()
    for item in old_items:
        itype = item.get("type")
        iid = item.get("id")
        if iid and itype in {"frame", "shape", "text"}:
            delete_item(itype, iid)

    create_frame("TrendSync Architecture v4 — GPT + Codex Hackathon Build", 0, 200, 5100, 2900)

    create_card("<p><strong>Experience Layer</strong></p>", -1600, -500, 900, 120, "#F3F4F6", "#E5E7EB")
    create_card("<p><strong>Orchestration Layer</strong></p>", -450, -500, 1000, 120, "#EEF2FF", "#C7D2FE")
    create_card("<p><strong>AI + Model Layer</strong></p>", 800, -500, 1000, 120, "#ECFEFF", "#A5F3FC")
    create_card("<p><strong>Data + Integrations</strong></p>", 2050, -500, 900, 120, "#FEFCE8", "#FDE68A")

    cards = {}
    cards["web"] = create_card(
        "<p><strong>Web App (:5173 / Vercel)</strong></p><p>React + Vite<br/>Dashboard, collections, tech packs, controls<br/>Calls the hosted API via VITE_API_BASE_URL</p>",
        -1600, -230, 900, 250, "#E0E7FF", "#93C5FD"
    )
    cards["codex"] = create_card(
        "<p><strong>Codex (Build-time)</strong></p><p>Architecture, implementation,<br/>integration, debugging, and validation<br/><em>Not a runtime dependency</em></p>",
        -1600, 130, 900, 220, "#FCE7F3", "#F9A8D4"
    )
    cards["gateway"] = create_card(
        "<p><strong>Main Backend API (:8000)</strong></p><p>FastAPI orchestration<br/>Pipelines, tech packs, Miro/Email endpoints<br/>WebSocket proxy to voice service</p>",
        -450, -240, 1000, 300, "#EDE9FE", "#C4B5FD"
    )
    cards["shared"] = create_card(
        "<p><strong>Shared Engines (Python)</strong></p><p>Trends, collection planning, image generation/editing,<br/>model composites, tech packs, video, brand guardrails, cache</p>",
        -450, 150, 1000, 280, "#DDD6FE", "#A78BFA"
    )
    cards["video_worker"] = create_card(
        "<p><strong>Video Service (:8001)</strong></p><p>Video render worker<br/>Calls OpenAI Sora API</p>",
        -450, 540, 1000, 220, "#DCFCE7", "#86EFAC"
    )
    cards["voice_service"] = create_card(
        "<p><strong>Voice Companion (:8002, Node.js)</strong></p><p>PCM audio bridge<br/>Realtime sessions + transcription</p>",
        -450, 860, 1000, 240, "#DBEAFE", "#93C5FD"
    )

    cards["openai_resp"] = create_card(
        f"<p><strong>OpenAI Responses API</strong></p><p>Collection/techpack/ad planning: {OPENAI_MODEL}<br/>Trend synthesis model: {OPENAI_TREND_MODEL}</p>",
        800, -240, 1000, 280, "#ECFEFF", "#67E8F9"
    )
    cards["openai_img"] = create_card(
        f"<p><strong>OpenAI Images API</strong></p><p>Image generation/edit and composites<br/>Model: {OPENAI_IMAGE_MODEL}</p>",
        800, 140, 1000, 230, "#CCFBF1", "#5EEAD4"
    )
    cards["openai_video"] = create_card(
        f"<p><strong>OpenAI Sora Video API</strong></p><p>Current model:<br/>{OPENAI_VIDEO_MODEL}</p>",
        800, 450, 1000, 230, "#D1FAE5", "#6EE7B7"
    )
    cards["openai_realtime"] = create_card(
        f"<p><strong>OpenAI Realtime + Transcription</strong></p><p>Realtime model: {OPENAI_REALTIME_MODEL}<br/>Speech-to-text: gpt-4o-mini-transcribe</p>",
        800, 790, 1000, 250, "#E0F2FE", "#7DD3FC"
    )

    cards["supabase"] = create_card(
        "<p><strong>Supabase</strong></p><p>Postgres + Auth + Storage<br/>brands, collections, tech_packs</p>",
        2050, -240, 900, 230, "#FEF3C7", "#FCD34D"
    )
    cards["redis"] = create_card(
        "<p><strong>Redis Cache</strong></p><p>TTL caching for shared engines</p>",
        2050, 90, 900, 180, "#FEF9C3", "#FDE047"
    )
    cards["gcs"] = create_card(
        "<p><strong>Google Cloud Storage</strong></p><p>Generated media + downloadable assets</p>",
        2050, 370, 900, 180, "#FFF7ED", "#FDBA74"
    )
    cards["foxit"] = create_card(
        "<p><strong>Foxit Cloud PDF</strong></p><p>DOCX -> PDF conversion for tech packs</p>",
        2050, 650, 900, 180, "#FCE7F3", "#F9A8D4"
    )
    cards["miro_resend"] = create_card(
        "<p><strong>Miro + Resend</strong></p><p>Programmatic Miro boards/docs<br/>Email delivery of board links</p>",
        2050, 930, 900, 200, "#F3E8FF", "#D8B4FE"
    )

    create_connector(cards["web"], cards["gateway"], "right", "left")
    create_connector(cards["gateway"], cards["shared"], "bottom", "top")
    create_connector(cards["gateway"], cards["voice_service"], "bottom", "left")
    create_connector(cards["shared"], cards["video_worker"], "bottom", "top")

    create_connector(cards["shared"], cards["openai_resp"], "right", "left")
    create_connector(cards["shared"], cards["openai_img"], "right", "left")
    create_connector(cards["video_worker"], cards["openai_video"], "right", "left")
    create_connector(cards["voice_service"], cards["openai_realtime"], "right", "left")

    create_connector(cards["gateway"], cards["supabase"], "right", "left")
    create_connector(cards["shared"], cards["redis"], "right", "left")
    create_connector(cards["shared"], cards["gcs"], "right", "left")
    create_connector(cards["gateway"], cards["foxit"], "right", "left")
    create_connector(cards["gateway"], cards["miro_resend"], "right", "left")

    create_text(
        "<p><em>Source of truth: generated from current code paths under trendsync-backend/services + shared and active OpenAI model environment values. Codex is shown as a build-time collaborator, not a runtime service.</em></p>",
        150,
        1240,
        3000,
    )

    print(json.dumps({
        "status": "ok",
        "board_id": BOARD_ID,
        "cards": cards,
        "models": {
            "openai_model": OPENAI_MODEL,
            "openai_trend_model": OPENAI_TREND_MODEL,
            "openai_realtime_model": OPENAI_REALTIME_MODEL,
            "openai_image_model": OPENAI_IMAGE_MODEL,
            "openai_video_model": OPENAI_VIDEO_MODEL,
        },
    }, indent=2))


if __name__ == "__main__":
    main()
