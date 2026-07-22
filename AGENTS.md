# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

TrendSync Brand Factory is an AI-powered fashion design platform. It analyzes real-time trends via OpenAI Responses + hosted web search, generates brand-compliant collections with GPT Image, produces manufacturing-ready tech packs as PDFs via Foxit, creates ad videos with Sora, and offers text + voice design companions — all from a single dashboard.

**This is an OpenAI-first AI project with Bria retained** — use OpenAI APIs and models for all new AI capabilities. Bria FIBO remains supported only through the `generate-product-image` Supabase Edge Function. Do not add Gemini, Vertex AI, Fal, Grok, Veo, or other AI providers.

## Development Commands

### Frontend (React + Vite)
```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # Production build to dist/
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run lint         # ESLint
npm run preview      # Preview production build
```

### Backend (Python FastAPI — 3 microservices)
All backend services run from `trendsync-backend/`. Install deps first:
```bash
cd trendsync-backend && pip install -r requirements.txt
```

Start each service (each in its own terminal):
```bash
# Main API gateway (port 8000) — all REST endpoints + Lux design companion
cd trendsync-backend && uvicorn services.main-backend.main:app --host 0.0.0.0 --port 8000 --reload

# Video generation service (port 8001) — OpenAI Sora
cd trendsync-backend && uvicorn services.video-gen-service.main:app --host 0.0.0.0 --port 8001 --reload

# Voice companion (port 8002) — OpenAI Realtime audio streaming
cd trendsync-backend/services/voice-companion && npm install && npm run dev
```

### Database
```bash
# Connect to Supabase via pooler (port 6543, NOT 5432)
# Use the project pooler URL from your Supabase dashboard / linked project.
```

Migrations live in `supabase/migrations/`.

## Architecture

### Frontend → Backend → AI Stack
```
React (Vite :5173) → FastAPI (:8000) → OpenAI / Foxit / GCS
 → Video service (:8001) for Sora
 → Voice service (:8002) for OpenAI Realtime audio
```

**Frontend** (`src/`): React 18 + TypeScript + Tailwind with a neumorphic pastel theme. Auth via Supabase (`AuthContext.tsx`). All backend calls go through `src/lib/api-client.ts`. Database CRUD is abstracted in `src/services/db-storage.ts`.

**Main backend** (`trendsync-backend/services/main-backend/main.py`): FastAPI app that serves as the API gateway. Endpoints for trends, collection generation, image gen, tech packs, PDF generation, the Lux design companion, pipeline orchestration, and a WebSocket proxy to the voice service.

**Shared modules** (`trendsync-backend/shared/`): Reusable Python modules consumed by all three services:
- `trend_engine.py` — OpenAI Responses API + hosted web search for fashion trends
- `collection_engine.py` — Two-phase collection planning with OpenAI Responses API
- `image_generator.py` — GPT Image generation and natural-language editing
- `brand_guardian.py` — Rule-based compliance scoring (no AI, pure math)
- `techpack_generator.py` — Manufacturing specs via OpenAI Responses API
- `ad_video_engine.py` — OpenAI Sora storyboard + video generation
- `foxit_service.py` — DOCX → Foxit Cloud → PDF pipeline
- `design_tools.py` — tools shared between text and voice companions
- `cache.py` — Redis caching with TTL decorator

**Design Companion** (`design_agent.py`): OpenAI Agents SDK agent ("Lux") with OpenAI function tools.

**Voice Companion** (`services/voice-companion/`): Node.js OpenAI Realtime agent with bidirectional WebSocket and raw PCM audio streaming.

### Key Data Flow: Full Pipeline
```
POST /adk/pipeline → trends (gpt-5.6-terra + web_search) → collection plan (gpt-5.6-sol)
 → image gen per product (gpt-image-2) → ad video (sora-2-pro)
```

### Key Data Flow: Tech Pack PDF
```
UI generates tech pack → save to Supabase (single source of truth)
  → POST /generate-techpack-pdf → python-docx builds DOCX → Foxit Cloud converts to PDF
  → compress → return base64
```

## OpenAI Model Usage

These are the default models wired in code today (overridable via env vars):

| Model | Env override | Location | Purpose |
|-------|--------------|----------|---------|
| `gpt-5.6-sol` | `OPENAI_MODEL` | Responses API / Agents SDK | Collection planning, tech packs, storyboards, Lux design companion |
| `gpt-5.6-terra` | `OPENAI_TREND_MODEL` | Responses API + `web_search` | Web-grounded trend intelligence |
| `gpt-image-2` | `OPENAI_IMAGE_MODEL` | Images API | Product generation, edits, model composites |
| `gpt-realtime-2.1` | `OPENAI_VOICE_MODEL` | Realtime API | Voice companion (fallback: `gpt-realtime-2`) |
| `gpt-4o-mini-transcribe` | — | Realtime transcription | English speech transcription for voice |
| `sora-2-pro` | `OPENAI_VIDEO_MODEL` | Videos API | Image-guided ad video generation |

- Use the OpenAI SDK / REST APIs with `OPENAI_API_KEY`.
- The hosted `web_search` tool requires reasoning effort `low` or higher.
- Design companion falls back from `gpt-5.6-sol` to `gpt-5.6-terra` when needed.

## Database (Supabase)

Key entities: `brands`, `brand_styles` (versioned JSONB), `collections`, `collection_items`, `trend_insights`, `validations`, `generated_images`, `tech_packs`, `generation_jobs`, `user_profiles`, `login_audit`, `company_models`.

`brand_styles.style_json` (JSONB) contains: `colorPalette`, `cameraSettings`, `lightingConfig`, `logoRules`, `materialLibrary`, `negativePrompts`, `aspectRatios`.

## Critical Gotchas

- **Large tool payloads**: NEVER return large data (base64 images) in tool response dicts. Store large data in an external store and extract after the agent run completes.
- **Tech pack consistency**: Always save once to Supabase and enforce the PDF endpoint reads saved data only — do not regenerate specs on PDF export.
- **Supabase port**: Port 5432 refuses connections; use port **6543** (pooler).
- **`auth.users.confirmed_at`**: Generated column — update `email_confirmed_at` only.
- **ffmpeg**: Located at `/opt/homebrew/bin/ffmpeg` (not in PATH), hardcoded in video-gen-service.
- **Foxit async pattern**: Submit task → poll every 2s → 120s timeout → fallback if compression fails.
- **Sora constraints**: Human-face model references are blocked; use product-only image guidance. Valid durations are 4/8/12/16/20 seconds.

## Styling Conventions

- Neumorphic pastel theme (Tailwind)
- Custom shadow classes: `shadow-neumorphic`, `shadow-neumorphic-sm`, `shadow-neumorphic-inset`
- Color palette: pastel navy (`#1E2A4A`), accent blue (`#5B9BD5`), teal (`#6BB5B5`), muted (`#8A9AB5`)
- Generous border radii: `rounded-2xl`, `rounded-3xl`, `rounded-4xl`
