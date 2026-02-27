# Design Agents Architecture

## Overview

TrendSync has two AI design companions that let users edit product images, analyze designs, fetch trends, validate brand compliance, and more — all powered by Google ADK agents:

1. **Typing Agent ("Lux")** — Text chat in the product detail modal
2. **Voice Agent ("Lux")** — Real-time voice via Gemini Live audio streaming

Both agents share the same tool implementations (`shared/design_tools.py`) and image editing pipeline (`shared/image_generator.py`), ensuring identical capabilities regardless of input modality.

---

## Architecture

### Typing Agent

```
User types message
  → React (DesignAdjustments.tsx)
  → POST /adk/design-companion (main-backend :8000)
  → ADK Runner with design_agent.py (Gemini 2.5 Flash)
  → Agent decides which tool to call
  → Tool executes (e.g. edit_product_image via shared/design_tools.py)
  → Agent generates text response
  → HTTP response with { response, action, image_base64? }
  → React updates UI (local state, NOT DB — until user clicks Save)
```

**Key files:**
- `src/components/collection/DesignAdjustments.tsx` — Chat UI + state management
- `src/components/collection/ProductDetailModal.tsx` — Parent modal, syncs props to state
- `trendsync-backend/services/main-backend/design_agent.py` — ADK agent definition
- `trendsync-backend/services/main-backend/main.py` — `/adk/design-companion` endpoint

### Voice Agent

```
User speaks
  → React (VoiceCompanion.tsx) captures mic at 16kHz PCM
  → WebSocket to /ws/voice-companion/{session_id} (:8002)
  → ADK Runner with Gemini Live (bidirectional streaming, already connected)
  → Agent decides which tool to call (within the live session)
  → Tool executes (same shared/design_tools.py)
  → Agent speaks response (raw PCM audio frames sent via WS binary)
  → Pending images delivered as JSON { type: "image_updated", image_base64 }
  → React updates UI (same local state pattern)
```

**Key files:**
- `src/components/voice/VoiceCompanion.tsx` — Voice UI + WebSocket + audio capture/playback
- `trendsync-backend/services/voice-companion/main.py` — WebSocket endpoint + ADK Live agent

### Shared Tool Layer

Both agents call the same pure functions in `shared/design_tools.py`:
- `edit_image()` — Edit product image (calls `image_generator.edit_product_image`)
- `make_compliant()` — Adjust image to match brand colors
- `generate_variation()` — Generate a new product image from scratch
- `analyze_product()` — Provide design feedback (text only)
- `get_trends()` — Fetch real-time fashion trends via Gemini + Google Search
- `check_compliance()` — Run brand compliance validation
- `save_design_signal()` — Signal the frontend to persist changes

```
design_agent.py (typing)  ─┐
                            ├──→ shared/design_tools.py ──→ shared/image_generator.py
voice-companion/main.py   ─┘                            ──→ shared/trend_engine.py
                                                         ──→ shared/brand_guardian.py
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

**Problem:** Image edits took 15-25 seconds. The second edit was even slower than the first.

**Root causes:**
- Images were **1.2MB PNGs (~1500-2000px)** being sent to Gemini for every edit
- Each edit output was slightly larger than the input (PNG compression artifacts), causing progressive size growth
- The typing agent made 3 sequential API calls: Flash (routing) → Image model (edit) → Flash (response)

**Solution — Image compression** (`shared/image_generator.py`):
- Added `_compress_for_edit()`: images > 500KB are resized to max 1024px and converted to JPEG (quality 85)
- Typical reduction: 1.2MB PNG → 150-200KB JPEG (6-8x smaller)
- Every edit now starts from a capped size — the 5th edit is as fast as the 1st
- This applies to both agents since both use `shared/image_generator.py`

### 3. 429 RESOURCE_EXHAUSTED Not Retrying

**Problem:** Gemini API rate limits (429) were shown as error messages to the user instead of being retried automatically.

**Root cause:** `shared/design_tools.py` caught ALL exceptions in `edit_image()` and returned the error as a tool result message. The retry logic in `image_generator.py` was inside the try block, but the exception propagated to `design_tools.py` which swallowed it.

**Solution — Retry at the `design_tools` layer** (`shared/design_tools.py`):
- Added `_is_rate_limited(e)` helper that checks for "429" or "RESOURCE_EXHAUSTED" in the exception message
- `edit_image()`, `make_compliant()`, and `generate_variation()` all retry 3 times with 8s/16s/24s delays
- The inner `image_generator.py` also has its own 3-retry loop (5s/10s/15s) — so there are effectively 9 total attempts before giving up
- Both typing and voice agents benefit since both go through `design_tools`

### 4. Voice Agent Appearing Stuck (No Status Feedback)

**Problem:** The voice agent would say "Playback AudioContext created" and then appear frozen while processing a tool call (e.g., image edit taking 10-15 seconds).

**Solution — Status messages at both layers:**

**Backend** (`services/voice-companion/main.py`):
- Added `_pending_status` queue + `_queue_status()` helper
- Every tool wrapper sends `started` and `completed` status messages via WebSocket (`type: "tool_status"`)
- Delivered alongside audio/image events in the downstream loop

**Frontend** (`VoiceCompanion.tsx`):
- Added `statusMessage` and `isProcessing` state
- Handles `tool_status` messages from backend + detects tool calls/responses in ADK events
- Status bar pinned above the footer (always visible regardless of scroll)
- Header subtitle synced with status (shows "Editing image..." instead of "Listening...")
- Comprehensive `console.log` at every step for debugging

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
- Return base64 images in ADK tool response dicts — store in `_IMAGE_STORE` externally and extract after `run_async()` (ADK serializes responses into conversation history, causing token overflow)

### Image Pipeline:
```
Agent edits image
  → image_generator.py compresses input (max 1024px, JPEG q85)
  → Gemini 3 Pro Image edits the compressed image
  → Result stored externally (_IMAGE_STORE for typing, _pending_images for voice)
  → Frontend receives base64, sets as data URL in local state
  → User sees change immediately
  → User clicks Save → DB write + optional Supabase Storage upload
```

---

## Performance Characteristics

| Operation | Typing Agent | Voice Agent | Why Different |
|-----------|-------------|-------------|---------------|
| Image edit | ~12-18s | ~8-12s | Typing: 3 API calls (Flash routing + Image edit + Flash response). Voice: 1 API call (Gemini Live handles routing/response within its persistent streaming session) |
| Trend query | ~5-8s | ~5-8s | Same path (Gemini + Google Search grounding) |
| Brand compliance | ~12-18s | ~8-12s | Same as image edit (involves image editing) |
| Analysis | ~3-5s | ~2-3s | Text only, no image generation |

The voice agent is inherently faster because Gemini Live maintains a persistent bidirectional session — tool routing and response generation happen within the same stream without additional API roundtrips.
