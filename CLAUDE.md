# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TrendSync Brand Factory is an AI-powered fashion design platform. It analyzes real-time trends via Gemini + Google Search, generates brand-compliant collections with AI imagery, produces manufacturing-ready tech packs as PDFs via Foxit, creates ad videos with Veo 3.1, and offers text + voice design companions — all from a single dashboard.

**This is a Gemini 3 hackathon project** — use Gemini 3 models, not Gemini 2.5.

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
# Main API gateway (port 8000) — all REST endpoints + ADK design companion
cd trendsync-backend && uvicorn services.main-backend.main:app --host 0.0.0.0 --port 8000 --reload

# Video generation service (port 8001) — Veo 3.1
cd trendsync-backend && uvicorn services.video-gen-service.main:app --host 0.0.0.0 --port 8001 --reload

# Voice companion (port 8002) — Gemini Live audio streaming
cd trendsync-backend && python -m services.voice-companion.main
```

### Redis (optional, for caching)
```bash
node redis-server.cjs  # Express wrapper on default Redis port
```

### Database
```bash
# Connect to Supabase via pooler (port 6543, NOT 5432)
/opt/homebrew/Cellar/libpq/18.1/bin/psql "postgresql://postgres.dzuwhbzdjhjpoitzpysh:<password>@db.dzuwhbzdjhjpoitzpysh.supabase.co:6543/postgres"
```

Migrations live in `supabase/migrations/`. Many base tables were created via the Supabase dashboard and have no migration files.

## Architecture

### Frontend → Backend → AI Stack
```
React (Vite :5173) → FastAPI (:8000) → Gemini / Veo / Foxit / GCS
                                     → Video service (:8001) for Veo 3.1
                                     → Voice service (:8002) for Gemini Live audio
```

**Frontend** (`src/`): React 18 + TypeScript + Tailwind with a neumorphic pastel theme. Auth via Supabase (`AuthContext.tsx`). All backend calls go through `src/lib/api-client.ts`. Database CRUD is abstracted in `src/services/db-storage.ts`.

**Main backend** (`trendsync-backend/services/main-backend/main.py`): FastAPI app that serves as the API gateway. Endpoints for trends, collection generation, image gen, tech packs, PDF generation, the ADK design companion, pipeline orchestration, and a WebSocket proxy to the voice service.

**Shared modules** (`trendsync-backend/shared/`): Reusable Python modules consumed by all three services:
- `trend_engine.py` — Gemini + Google Search grounding for fashion trends
- `collection_engine.py` — Two-phase collection planning with Gemini 3 Pro
- `image_generator.py` — Two-step image pipeline (art-direction prompt → image gen)
- `brand_guardian.py` — Rule-based compliance scoring (no AI, pure math)
- `techpack_generator.py` — Manufacturing specs via Gemini 3 Pro
- `ad_video_engine.py` — Veo 3.1 storyboard + video generation
- `foxit_service.py` — DOCX → Foxit Cloud → PDF pipeline
- `design_tools.py` — 7 tools shared between text and voice companions
- `cache.py` — Redis caching with TTL decorator

**ADK Design Companion** (`design_agent.py`): Google ADK agent ("Lux") with `gemini-2.5-flash`, 6 tools, and `InMemorySessionService`. Uses fresh sessions per request to prevent token accumulation.

**Voice Companion** (`services/voice-companion/main.py`): ADK agent with `gemini-live-2.5-flash-native-audio`, bidirectional WebSocket, raw PCM audio streaming.

### Key Data Flow: Full Pipeline
```
POST /adk/pipeline → trends (Gemini+Search) → collection plan (Gemini 3 Pro, HIGH thinking)
  → image gen per product (gemini-3-pro-image-preview) → ad video (Veo 3.1, 5 scenes)
```

### Key Data Flow: Tech Pack PDF
```
UI generates tech pack → save to Supabase (single source of truth)
  → POST /generate-techpack-pdf → python-docx builds DOCX → Foxit Cloud converts to PDF
  → compress → return base64
```

## Gemini Model Usage

| Model | Location | Purpose |
|-------|----------|---------|
| `gemini-3-pro-preview` | `global` | Collection planning, tech packs, storyboards |
| `gemini-3-flash-preview` | `global` | Fast tasks |
| `gemini-3-pro-image-preview` | `global` | Product image generation |
| `gemini-2.5-flash` | `global` | Trend engine, art-direction prompts, ADK design companion |
| `gemini-live-2.5-flash-native-audio` | — | Voice companion |
| `veo-3.1-generate-preview` | `us-central1` | Ad video generation (NOT global) |

- Use `google-genai` SDK with `vertexai=True`
- Gemini 3 uses `thinking_level` (HIGH/MEDIUM/LOW enum), **not** `thinking_budget` (that's Gemini 2.5)
- `location=global` is required for all Gemini 3 Preview models (except Veo)

## Database (Supabase)

11 tables with RLS. Key entities: `brands`, `brand_styles` (versioned JSONB), `collections`, `collection_items`, `trend_insights`, `validations`, `generated_images`, `tech_packs`, `generation_jobs`, `user_profiles`, `login_audit`.

`brand_styles.style_json` (JSONB) contains: `colorPalette`, `cameraSettings`, `lightingConfig`, `logoRules`, `materialLibrary`, `negativePrompts`, `aspectRatios`.

## Critical Gotchas

- **ADK token limit**: NEVER return large data (base64 images) in tool response dicts. ADK serializes `function_response` into conversation history. Store large data in the external `_IMAGE_STORE` dict and extract after `run_async()`.
- **ADK state_delta**: Values are stored in session state but NOT injected into prompts unless the agent instruction has `{var_name}` template patterns.
- **Google Search grounding**: Incompatible with `response_mime_type="application/json"`. Use a two-pass approach (grounded text → parse JSON).
- **Tech pack consistency**: Gemini hallucates different values per call. Always save once to Supabase and enforce the PDF endpoint reads saved data only.
- **Supabase port**: Port 5432 refuses connections; use port **6543** (pooler).
- **`auth.users.confirmed_at`**: Generated column — update `email_confirmed_at` only.
- **ffmpeg**: Located at `/opt/homebrew/bin/ffmpeg` (not in PATH), hardcoded in video-gen-service.
- **Foxit async pattern**: Submit task → poll every 2s → 120s timeout → fallback if compression fails.

## Styling Conventions

- Neumorphic pastel theme defined in `tailwind.config.js`
- Custom shadow classes: `shadow-neumorphic`, `shadow-neumorphic-sm`, `shadow-neumorphic-inset`
- Color palette: pastel navy (`#1E2A4A`), accent blue (`#5B9BD5`), teal (`#6BB5B5`), muted (`#8A9AB5`)
- Generous border radii: `rounded-2xl`, `rounded-3xl`, `rounded-4xl`
