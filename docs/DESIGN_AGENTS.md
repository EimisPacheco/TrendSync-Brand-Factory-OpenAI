# Design Agents Architecture

## Overview

TrendSync has two AI design companions that let users edit product images, analyze designs, fetch trends, validate brand compliance, and more — both now built on **OpenAI**:

1. **Typing Agent ("Lux")** — Text chat in the product detail modal. **OpenAI Agents SDK Python** with `gpt-5.5`.
2. **Voice Agent ("Lux")** — Real-time voice. **Node.js service** wrapping the **OpenAI Realtime API** (`gpt-realtime`, fallback `gpt-4o-realtime-preview`).

Both agents share the same tool implementations (`shared/design_tools.py` for the typing agent; mirrored in `services/voice-companion/tools.js` for the voice agent) and ultimately call the same image editing pipeline (`shared/image_generator.py`), so capabilities are identical regardless of input modality.

> Image generation, image editing, and the model + product composite still run on **Gemini 3 Pro Image** (Vertex AI) — only the agent reasoning, conversation, and voice layers are on OpenAI.

---

## Architecture

### Typing Agent (OpenAI Agents SDK Python)

```
User types message
  → React (DesignAdjustments.tsx)
  → POST /adk/design-companion (main-backend :8000)
  → OpenAI Agents SDK Runner.run(agent, messages, context=ctx)
      with gpt-5.5 + 7 @function_tool-decorated tools
  → Agent decides which tool to call
  → Tool executes (e.g. edit_product_image via shared/design_tools.py)
  → Agent generates text response
  → HTTP response with { response, action, image_base64? }
  → React updates UI (local state, NOT DB — until user clicks Save)
```

**Key files:**
- `src/components/collection/DesignAdjustments.tsx` — Chat UI + state management + browser console breadcrumbs
- `src/components/collection/ProductDetailModal.tsx` — Parent modal, syncs props to state
- `trendsync-backend/services/main-backend/design_agent.py` — `from agents import Agent, Runner, function_tool` (`gpt-5.5`)
- `trendsync-backend/services/main-backend/main.py` — `/adk/design-companion` endpoint (legacy URL kept for FE compat)

The 7 typing-agent tools are decorated with `@function_tool`; their docstrings become the OpenAI tool schemas. Run-scoped state (current image, brand style, product context) lives in a `RunContextWrapper` passed into `Runner.run(..., context=ctx)` so every tool sees the same per-request snapshot.

### Voice Agent (OpenAI Realtime via Node.js)

```
User speaks
  → React (VoiceCompanion.tsx) captures mic at 24kHz PCM
  → WebSocket to /ws/voice-companion/{session_id} (FastAPI proxy on :8000)
  → main-backend forwards to Node voice service on :8002
  → Node service holds an upstream WebSocket to OpenAI Realtime
      (model: gpt-realtime, fallback gpt-4o-realtime-preview)
  → Audio frames stream BIDIRECTIONALLY as binary WS frames (raw PCM, no JSON+base64)
  → Whisper transcription pinned to language='en' to prevent drift
  → Agent decides which tool to call (within the live session)
  → Tool dispatcher in services/voice-companion/tools.js
      executes (HTTP POST back into main-backend for shared logic)
  → Agent speaks response (raw PCM audio frames sent via WS binary)
  → Pending images delivered as JSON { type: "image_updated", image_base64 }
  → React updates UI (same local state pattern)
```

**Key files:**
- `src/components/voice/VoiceCompanion.tsx` — Voice UI + WebSocket + audio capture/playback
- `trendsync-backend/services/voice-companion/voice-agent-service.js` — Express HTTP entry + WS server bootstrap
- `trendsync-backend/services/voice-companion/voice-routes.js` — REST routes (session create, ephemeral keys)
- `trendsync-backend/services/voice-companion/websocket-server.js` — Browser ↔ OpenAI Realtime bridge
- `trendsync-backend/services/voice-companion/tools.js` — 10 Zod-typed tool definitions (`tool({ name, parameters, execute })`)

### Shared Tool Layer

The 7 design tools that both agents expose:

| Tool | Implementation | Purpose |
|------|----------------|---------|
| `analyze_product_image` | `shared/design_tools.analyze_product` | Provide design feedback (text only) |
| `edit_product_image` | `shared/design_tools.edit_image` → `image_generator.edit_product_image` | Surgical/global recolor + edits |
| `make_brand_compliant` | `shared/design_tools.make_compliant` | Adjust image to match brand colors |
| `fetch_trend_data` | `shared/design_tools.get_trends` → `trend_engine.fetch_trends` | OpenAI Responses API + hosted `web_search` |
| `validate_brand_compliance` | `shared/design_tools.check_compliance` → `brand_guardian.validate_prompt` | Rule-based scoring (no AI) |
| `generate_image_variation` | `shared/design_tools.generate_variation` → `image_generator.generate_product_image` | Gemini 3 Pro Image |
| `save_design` | `shared/design_tools.save_design_signal` | Signal frontend to persist |

The voice agent has 3 additional voice-only tools that don't belong in the typed flow:
- `generate_ad_video` — Kicks off the Fal video pipeline
- `navigate_to_page` — Routes the React app to another tab
- `start_collection_generation` — One-shot collection plan from a spoken brief

```
design_agent.py (typing, gpt-5.5)  ─┐
                                     ├──→ shared/design_tools.py ──→ shared/image_generator.py  (Gemini 3 Pro Image)
voice/tools.js (voice, gpt-realtime)─┘                          ──→ shared/trend_engine.py     (OpenAI web_search)
                                                                ──→ shared/brand_guardian.py    (rules)
```

---

## Challenges Solved

### 1. Image Edits Reverting in the UI

**Problem:** After the agent edited an image, the UI would flash the new image and immediately revert to the original.

**Root cause:** Two independent `setInterval` polling loops were fetching data from the database every 2 seconds and overwriting the in-memory edited image (which hadn't been saved to DB yet):
- `App-v2.tsx` — polled collection items and replaced state
- `ProductDetailModal.tsx` — polled the individual item and replaced `currentItem`

**Solution:**
- **Removed both polling loops entirely.** The in-memory state is the source of truth for unsaved edits.
- `ProductDetailModal.tsx` syncs from props via `useEffect([item, isOpen])` — parent pushes updates, no child polling.
- `DesignAdjustments.tsx` uses a `typingAgentUpdating` ref guard to prevent the voice-sync effect from overwriting the typing agent's image during the brief React re-render cycle.
- Saving to DB only happens when the user explicitly clicks "Save Design."

**Critical rule:** Never add polling that fetches from DB and overwrites `image_url` state while the design panel is open. Edits are in-memory until saved.

### 2. Slow Image Edits

**Problem:** Image edits took 15–25 seconds. The second edit was even slower than the first.

**Root causes:**
- Images were **1.2MB PNGs (~1500–2000px)** being sent to Gemini for every edit
- Each edit output was slightly larger than the input (PNG compression artifacts), causing progressive size growth
- The typing agent made 3 sequential API calls: agent reasoning → image edit → response framing

**Solution — Image compression** (`shared/image_generator.py`):
- Added `_compress_for_edit()`: images > 500KB are resized to max 1024px and converted to JPEG (quality 85)
- Typical reduction: 1.2MB PNG → 150–200KB JPEG (6–8× smaller)
- Every edit now starts from a capped size — the 5th edit is as fast as the 1st
- This applies to both agents since both use `shared/image_generator.py`

### 3. 429 / Rate Limit Not Retrying

**Problem:** Provider rate limits were shown as error messages to the user instead of being retried automatically.

**Root cause:** `shared/design_tools.py` caught ALL exceptions in `edit_image()` and returned the error as a tool result message. The retry logic in `image_generator.py` was inside the try block, but the exception propagated to `design_tools.py` which swallowed it.

**Solution — Retry at the `design_tools` layer** (`shared/design_tools.py`):
- Added `_is_rate_limited(e)` helper that checks for "429" or "RESOURCE_EXHAUSTED" in the exception message
- `edit_image()`, `make_compliant()`, and `generate_variation()` all retry 3 times with 8s/16s/24s delays
- The inner `image_generator.py` also has its own 3-retry loop (5s/10s/15s) — so there are effectively 9 total attempts before giving up
- Both typing and voice agents benefit since both go through `design_tools`

### 4. Voice Agent Appearing Stuck (No Status Feedback)

**Problem:** The voice agent would say "Playback AudioContext created" and then appear frozen while processing a tool call (e.g., image edit taking 10–15 seconds).

**Solution — Status messages at both layers:**

**Backend** (`services/voice-companion/websocket-server.js`):
- Tool dispatcher emits `tool_status` JSON frames (`started`, `completed`) downstream alongside audio/image events
- Image deliveries arrive as JSON `{ type: "image_updated", image_base64 }`

**Frontend** (`VoiceCompanion.tsx`):
- Added `statusMessage` and `isProcessing` state
- Handles `tool_status` messages from backend
- Status bar pinned above the footer (always visible regardless of scroll)
- Header subtitle synced with status (shows "Editing image..." instead of "Listening...")
- Comprehensive `console.log` at every step for debugging

### 5. Voice Agent Stuck on "Listening…" — Wrong Model Class

**Problem:** The voice agent connected to OpenAI Realtime, opened the WebSocket cleanly, but never produced audio responses. The browser stayed on "Listening..." forever even when the user spoke.

**Root cause:** `OPENAI_VOICE_MODEL` had been set to `gpt-5.5` — a reasoning model, not a Realtime model. The Realtime WebSocket completed the handshake but silently dropped non-Realtime model tokens; no audio frames came back.

**Solution:** `OPENAI_VOICE_MODEL` must be a Realtime-class model. Use `gpt-realtime` (newest) or `gpt-4o-realtime-preview` as fallback. Plain `gpt-5.x` / `gpt-4.x` chat/reasoning models do **not** work over the Realtime WebSocket. Pinned in [`services/voice-companion/voice-agent-service.js`](trendsync-backend/services/voice-companion/voice-agent-service.js).

### 6. `Buffer.isBuffer(data)` Always True in `ws@8.x`

**Problem:** Voice agent text frames (JSON tool-call deltas, status events) were being routed to the binary audio handler, corrupting the audio playback queue and causing the agent to sound garbled or fall silent.

**Root cause:** In `ws@8.x`, the `message` event always passes a Node `Buffer` — even for text frames. A naïve `if (Buffer.isBuffer(data))` branch routed every frame, including text, to the binary handler.

**Solution:** Dispatch on the `isBinary` flag, not on `Buffer.isBuffer(data)`:
```js
ws.on('message', (data, isBinary) => {
  if (isBinary) handleAudio(data);
  else handleText(data.toString('utf8'));
});
```
Fixed in [`services/voice-companion/websocket-server.js`](trendsync-backend/services/voice-companion/websocket-server.js).

### 7. Voice Agent Language Drift (English → Korean / Indonesian)

**Problem:** The voice agent would start responding in English, then mid-sentence switch to Korean, Indonesian, or German.

**Root cause:** Without an explicit language pin, OpenAI Realtime's transcription model auto-detects per chunk and can flip when accent/noise patterns shift.

**Solution:** Pin the language in **two places**:
- System prompt instruction explicitly tells the agent to speak only English
- `input_audio_transcription: { model: 'whisper-1', language: 'en' }` in the Realtime session config

### 8. Image Edit Classifier Missed AI-Rephrased Instructions

**Problem:** A user said "Change the off-white to black" and got back a fully-black shoe — the off-white sole AND the red/orange upper, all black.

**Root cause:** Lux (the typing agent) rephrases the user's instruction before calling `edit_product_image`. The original surgical-vs-global classifier in `image_generator.py` only matched `from X to Y`, `swap X for Y`, or `replace the X`. Lux's rephrasings — "Change all off-white areas while preserving the red upper" — matched none of those, so the classifier defaulted to **GLOBAL** recolor, and Gemini correctly obeyed a "recolor everything" prompt.

**Solution** (`shared/image_generator.py` + regression test):
- Expanded `surgical_markers` to recognize preservation/scope language: `"preserv"`, `"intact"`, `"untouched"`, `"unchanged"`, `"leave "`, `"keep the "`, `"keeping the "`, `"while keep"`, `" areas "`, `"areas of"`, `"specifically"`.
- Added a 2-color naming regex so verbatim voice-style phrasings like `"change off-white to black"` classify as surgical without needing a `from` connector.
- Surgical signal always wins over global markers, so phrases like `"leave everything else intact"` stay surgical despite containing the word `"everything"`.
- Both agents share the same `edit_product_image()` and the same classifier, so this fix covers typing + voice paths simultaneously.

**Observability added** (kept for future regressions):
- `shared/image_generator.py` prints the prompt verbatim, the mode classification log, and dumps `/tmp/last-edit-{input.jpg,output.png,prompt.txt}` on every edit.
- `services/main-backend/main.py` exposes `GET /debug/last-edit` (JSON or HTML side-by-side preview).
- `src/components/collection/DesignAdjustments.tsx` logs send/ack breadcrumbs in the browser console.

**Regression test:** [`trendsync-backend/tests/test_edit_classifier.py`](trendsync-backend/tests/test_edit_classifier.py) — 20 phrasings (UI-typed, Lux-rephrased, voice, global, other) verified to land in the right bucket.

---

## State Management Rules

These rules prevent the image-revert bug from recurring:

### DO:
- Keep edited images in **local React state** (`localImageUrl` in DesignAdjustments, `currentItem` in ProductDetailModal)
- Propagate edits upward via `onUpdateItem()` callbacks
- Only persist to DB on explicit "Save Design" action
- Use `useEffect([item, isOpen])` to sync props → state (parent pushes, child receives)

### DO NOT:
- Add `setInterval` / polling that reads from DB while the design panel is open
- Replace `image_url` state with DB values during an editing session
- Change `useEffect` dependencies from `[item, isOpen]` to `[item?.id, isOpen]` — this breaks prop-to-state sync needed when the parent updates `item` after an agent edit
- Return very large blobs (base64 images, full image arrays) directly in tool response dicts — store in `_IMAGE_STORE` externally and extract after `Runner.run()`. The OpenAI Agents SDK serializes tool outputs into the agent's working memory; oversized outputs slow subsequent turns and inflate token cost. The pattern was originally introduced for Google ADK token-overflow protection and is kept defensively.

### Image Pipeline:
```
Agent edits image
  → image_generator.py compresses input (max 1024px, JPEG q85)
  → image_generator.py classifies surgical vs global (see Challenge 8)
  → Gemini 3 Pro Image edits the compressed image (Vertex AI, location=global)
  → Result stored externally (_IMAGE_STORE for typing, image-update WS frame for voice)
  → Frontend receives base64, sets as data URL in local state
  → User sees change immediately
  → User clicks Save → DB write + optional Supabase Storage upload
```

---

## Performance Characteristics

| Operation | Typing Agent (`gpt-5.5`) | Voice Agent (`gpt-realtime`) | Why Different |
|-----------|--------------------------|------------------------------|---------------|
| Image edit | ~12–18s | ~8–12s | Typing: 3 calls (agent reasoning → Gemini edit → response framing). Voice: 1 call — the Realtime session handles routing/response within its persistent stream without extra round-trips. |
| Trend query | ~5–8s | ~5–8s | Same path: OpenAI Responses API + hosted `web_search` tool. |
| Brand compliance | ~12–18s | ~8–12s | Same as image edit (involves image editing). |
| Analysis | ~3–5s | ~2–3s | Text only, no image generation. |

The voice agent is inherently faster because OpenAI Realtime maintains a persistent bidirectional session — tool routing and response generation happen within the same stream without additional API round-trips. The typing agent pays one extra `gpt-5.5` reasoning round-trip per turn.
