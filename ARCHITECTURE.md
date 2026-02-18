# TrendSync Brand Factory — Architecture & Technical Documentation

## Platform Overview

TrendSync Brand Factory is an AI-powered fashion design studio that generates complete fashion collections — from trend analysis to product images to tech packs — using Google's AI stack (Gemini, Vertex AI, Google ADK, Veo).

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                      │
│                          Port 5173                                  │
│                                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Dashboard  │  │ Brand Editor │  │  Collection  │  │  Trends   │ │
│  │           │  │ + Guardian   │  │  + Library   │  │  Insights │ │
│  └───────────┘  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   Lux Design Companion (DesignAdjustments.tsx)               │  │
│  │   → Single call to POST /adk/design-companion                │  │
│  │   → Agent decides which tool(s) to invoke                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                    Supabase Auth + DB                               │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ HTTP / WebSocket
┌──────────────────────────────┼──────────────────────────────────────┐
│                     MAIN BACKEND (FastAPI)                           │
│                       Port 8010                                     │
│                                                                     │
│  REST Endpoints:                                                    │
│  ├── GET  /health                                                   │
│  ├── POST /trends                    (Gemini + Google Search)       │
│  ├── POST /design/chat               (Gemini Flash — legacy)        │
│  ├── POST /edit-image                (Gemini Flash Image)           │
│  ├── POST /generate-image            (Gemini Flash Image)           │
│  ├── POST /validate                  (Rule-based Brand Guardian)    │
│  ├── POST /generate-techpack         (Gemini Flash)                 │
│  ├── POST /generate-collection       (Background: trends→plan→img) │
│  ├── POST /generate-ad-video         (Background: Veo 3.1)         │
│  ├── POST /adk/pipeline              (Full orchestrator pipeline)   │
│  ├── POST /adk/design-companion      (ADK Agent — Lux, 6 tools)    │
│  └── WS   /ws/voice-companion/:id   (Proxy to voice service)       │
│                                                                     │
│  Shared Modules:                                                    │
│  ├── shared/trend_engine.py          Gemini + Google Search         │
│  ├── shared/image_generator.py       Gemini Flash Image             │
│  ├── shared/brand_guardian.py        Rule-based validation          │
│  ├── shared/collection_engine.py     Gemini 3 Pro planning          │
│  ├── shared/techpack_generator.py    Tech pack generation           │
│  ├── shared/ad_video_engine.py       Veo video generation           │
│  └── shared/pipeline_orchestrator.py Multi-step orchestrator        │
└─────────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│                  VOICE COMPANION (FastAPI + ADK)                     │
│                       Port 8002                                     │
│                                                                     │
│  WebSocket: /ws/voice-companion/:session_id                         │
│  ADK Agent with 7 tools + runner.run_live() for bidi streaming      │
│  Model: gemini-live-2.5-flash-native-audio                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## AI Companion — Actions (Tools)

### Lux Design Companion (Text — ADK Agent)

**Endpoint:** `POST /adk/design-companion`
**Agent file:** `trendsync-backend/services/main-backend/design_agent.py`
**Model:** `gemini-2.5-flash`
**Framework:** Google ADK (`Agent`, `Runner`, `InMemorySessionService`)
**Runner mode:** `runner.run_async()` (text request-response)

| # | Tool | Description | Calls |
|---|------|-------------|-------|
| 1 | `analyze_product_image` | Visual analysis of the product image — sees the actual design and gives specific feedback on colors, textures, silhouette, proportions | `genai.Client.models.generate_content()` with multimodal image input (Gemini Pro) |
| 2 | `edit_product_image` | Edit the current product image (color, structure, fabric, proportions) | `shared.image_generator.edit_product_image()` |
| 3 | `make_brand_compliant` | Auto-adjust product image to match brand color palette and guidelines | `shared.image_generator.edit_product_image()` + `shared.brand_guardian.validate_prompt()` |
| 4 | `fetch_trend_data` | Real-time fashion trend data via Gemini + Google Search grounding | `shared.trend_engine.fetch_trends()` |
| 5 | `validate_brand_compliance` | Check product compliance score against brand rules | `shared.brand_guardian.validate_prompt()` + `get_compliance_badge()` |
| 6 | `generate_image_variation` | Generate a completely new product image from a description | `shared.image_generator.generate_product_image()` |

**Session state** (injected via `state_delta`, not exposed to LLM):
- `image_base64` — Current product image
- `brand_style_json` — Brand style configuration
- `brand_id` — Brand UUID
- `product_context` — Product metadata (name, category, colors, materials)

### Voice Design Companion (Audio — ADK Agent)

**Endpoint:** `WS /ws/voice-companion/:session_id`
**Agent file:** `trendsync-backend/services/voice-companion/main.py`
**Model:** `gemini-live-2.5-flash-native-audio`
**Framework:** Google ADK (`Agent`, `Runner`, `LiveRequestQueue`)
**Runner mode:** `runner.run_live()` (bidirectional audio streaming)

| # | Tool | Description | Calls |
|---|------|-------------|-------|
| 1 | `adjust_design` | Edit product image via voice instruction | `POST /edit-image` (HTTP) |
| 2 | `fetch_trend_info` | Query real-time fashion trends | `POST /trends` (HTTP) |
| 3 | `validate_design` | Check brand compliance | `POST /validate` (HTTP) |
| 4 | `generate_variation` | Generate new product image | `POST /generate-image` (HTTP) |
| 5 | `generate_ad_video` | Start Veo video generation | `POST /generate-ad-video` (HTTP) |
| 6 | `navigate_to_page` | Navigate app to a specific page | Returns route for frontend |
| 7 | `start_collection_generation` | Start full collection generation | `POST /generate-collection` (HTTP) |

**Total unique actions across both companions: 13 (6 text + 7 voice)**

---

## Database Schema

**Database:** Supabase (PostgreSQL with Row-Level Security)
**Tables:** 11

### 1. `user_profiles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | References `auth.users.id` |
| `full_name` | text | Display name |
| `avatar_url` | text | Profile picture URL |
| `role` | text | User role (admin, designer, viewer) |
| `created_at` | timestamptz | Account creation |
| `updated_at` | timestamptz | Last profile update |

**Why:** Extends Supabase Auth with app-specific profile data. Linked 1:1 with `auth.users` via trigger. RLS ensures users can only read/write their own profile.

### 2. `brands`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `user_id` | uuid (FK → auth.users) | Brand owner |
| `name` | text | Brand name |
| `description` | text | Brand description |
| `logo_url` | text | Logo image URL |
| `created_at` | timestamptz | Creation date |
| `updated_at` | timestamptz | Last update |

**Why:** Multi-brand support — each user can own multiple brands. All downstream entities (collections, styles) are scoped to a brand. RLS restricts access to brand owner.

### 3. `brand_styles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `brand_id` | uuid (FK → brands) | Parent brand |
| `version` | integer | Style version number |
| `style_json` | jsonb | Full brand style config |
| `is_active` | boolean | Whether this version is active |
| `created_at` | timestamptz | Creation date |
| `created_by` | uuid (FK → auth.users) | Who created this version |

**Why:** Versioned brand guidelines stored as JSONB. The `style_json` field contains: color palette (with Pantone codes), camera settings (FOV, angles), lighting config, logo placement rules, material library, and negative prompts. JSONB allows flexible schema evolution without migrations. Versioning lets designers experiment with style changes and roll back.

**`style_json` structure:**
```json
{
  "colorPalette": [{ "id": "", "name": "", "hex": "", "designation": "primary|secondary|accent|neutral", "pantone": "" }],
  "cameraSettings": { "fovMin": 20, "fovMax": 80, "fovDefault": 50, "angleMin": 0, "angleMax": 90, ... },
  "lightingConfig": { "keyIntensity": 80, "fillIntensity": 40, "colorTemperature": 5000, ... },
  "logoRules": { "zone": "", "minSize": 0, "maxSize": 0, "allowedPositions": [], "exclusionZones": [] },
  "materialLibrary": [{ "id": "", "name": "", "category": "sustainable|premium|technical|standard", ... }],
  "negativePrompts": ["string"],
  "aspectRatios": [{ "width": 1, "height": 1, "name": "Square" }]
}
```

### 4. `collections`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `brand_id` | uuid (FK → brands) | Parent brand |
| `name` | text | Collection name (unique per brand) |
| `season` | text | Target season (e.g., "Spring 2025") |
| `region` | text | Target market region |
| `target_demographic` | text | Target audience |
| `status` | text | draft / generating / validating / complete |
| `collection_plan_json` | jsonb | AI-generated collection plan |
| `trend_insights_json` | jsonb | Cached trend data used for generation |
| `created_at` | timestamptz | Creation date |
| `updated_at` | timestamptz | Last update |

**Why:** Top-level container for a fashion collection. Stores the AI-generated plan (how many apparel/footwear/accessories, hero items, color story) as JSONB for flexibility. Caches the trend insights snapshot so the collection's context is preserved even after trends change. Name is unique per brand to prevent duplicates.

### 5. `collection_items`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `collection_id` | uuid (FK → collections) | Parent collection |
| `sku` | text | Product SKU |
| `name` | text | Product name |
| `category` | text | apparel / footwear / accessories |
| `subcategory` | text | Specific type (e.g., "blazer", "sneaker") |
| `design_story` | text | Creative narrative for the product |
| `target_persona` | text | Target customer persona |
| `price_tier` | text | entry / mid / premium / luxury |
| `design_spec_json` | jsonb | Design specifications |
| `fibo_prompt_json` | jsonb | Structured image generation prompt |
| `brand_compliance_score` | float | 0-100 compliance score |
| `status` | text | planned / designing / generating / validating / complete / failed |
| `image_url` | text | Generated product image URL (or data URI) |
| `video_url` | text | Generated product video URL |
| `created_at` | timestamptz | Creation date |
| `updated_at` | timestamptz | Last update |

**Why:** The core entity — each product in a collection. Uses two JSONB columns:
- `design_spec_json`: Human-readable design specs (silhouette, fit, colors, materials, details, inspiration)
- `fibo_prompt_json`: Structured image generation prompt following the FIBO schema (description, objects, background, lighting, camera angle, focal length, etc.)

This separation allows the AI to generate a creative brief (design_spec) and then translate it into a precise image prompt (fibo_prompt) independently.

### 6. `trend_insights`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `collection_id` | uuid (FK → collections) | Associated collection |
| `region` | text | Geographic region |
| `season` | text | Fashion season |
| `demographic` | text | Target demographic |
| `insights_json` | jsonb | Full trend data |
| `source` | text | gemini / manual |
| `created_at` | timestamptz | When fetched |
| `expires_at` | timestamptz | Cache expiry |

**Why:** Caches Gemini + Google Search trend results to avoid repeated API calls for the same query. The `insights_json` contains colors (with hex codes), silhouettes, materials, themes, and optional celebrity data. TTL-based expiry ensures freshness.

### 7. `validations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `collection_item_id` | uuid (FK → collection_items) | Validated item |
| `compliance_score` | float | 0-100 score |
| `violations` | jsonb | Array of violation objects |
| `auto_fixes_applied` | jsonb | Array of auto-fix records |
| `original_prompt_json` | jsonb | Prompt before fixes |
| `fixed_prompt_json` | jsonb | Prompt after auto-fixes |
| `validated_at` | timestamptz | Validation timestamp |

**Why:** Audit trail for brand compliance validation. Stores both the original and fixed prompts so designers can see exactly what was changed. Violations are categorized by severity (critical/warning/suggestion) and category (color/camera/lighting/logo/material/prompt).

### 8. `generated_images`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `collection_item_id` | uuid (FK → collection_items) | Parent item |
| `image_url` | text | Image URL (GCS or data URI) |
| `image_type` | text | product / lifestyle / detail / sketch |
| `view_angle` | text | front / back / side / three-quarter / top |
| `generation_params_json` | jsonb | FIBO prompt used for generation |
| `is_primary` | boolean | Whether this is the main image |
| `created_at` | timestamptz | Generation timestamp |

**Why:** Supports multiple images per product (different angles, types). Stores the exact generation parameters for reproducibility. Allows future multi-view generation features.

### 9. `tech_packs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `collection_item_id` | uuid (FK → collection_items) | Parent item |
| `version` | integer | Tech pack version |
| `tech_pack_json` | jsonb | Full technical specifications |
| `pdf_url` | text | Exported PDF URL |
| `status` | text | draft / review / approved |
| `created_at` | timestamptz | Creation date |
| `updated_at` | timestamptz | Last update |

**Why:** Manufacturing-ready technical specifications. The `tech_pack_json` contains dimensions, materials (with suppliers), construction details, Pantone color specs, branding placement, and packaging requirements. Versioned for revision tracking through the approval workflow.

### 10. `generation_jobs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated |
| `user_id` | uuid (FK → auth.users) | Job owner |
| `job_type` | text | trend_analysis / collection_design / image_generation / validation / tech_pack |
| `status` | text | queued / processing / complete / failed |
| `input_json` | jsonb | Job input parameters |
| `output_json` | jsonb | Job results |
| `error_message` | text | Error details if failed |
| `started_at` | timestamptz | Processing start |
| `completed_at` | timestamptz | Processing end |
| `created_at` | timestamptz | Job creation |

**Why:** Job queue for long-running AI operations (image generation, collection planning, etc.). Enables async processing with status polling. Stores both input and output as JSONB for full audit trail and retry capability.

### 11. `auth.users` (Supabase managed)

Managed by Supabase Auth. Contains email, password hash, confirmation status, OAuth tokens. Not directly modified — accessed via Supabase Auth SDK.

**Why:** Supabase Auth handles authentication (email/password, OAuth), session management, and JWT token generation. RLS policies on all tables reference `auth.uid()` to enforce row-level access control.

---

## Entity Relationship Diagram

```
auth.users (Supabase Auth)
    │
    ├──→ user_profiles (1:1)
    │
    └──→ brands (1:N)
            │
            ├──→ brand_styles (1:N, versioned)
            │
            └──→ collections (1:N)
                    │
                    ├──→ trend_insights (1:N, cached)
                    │
                    └──→ collection_items (1:N)
                            │
                            ├──→ validations (1:N)
                            ├──→ generated_images (1:N)
                            └──→ tech_packs (1:N, versioned)

    generation_jobs (standalone, linked to user)
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript + Vite | SPA with neumorphic pastel UI |
| Styling | Tailwind CSS | Utility-first CSS with custom neumorphic theme |
| State | React Context + useState | Auth context, local component state |
| Database | Supabase (PostgreSQL) | Auth, storage, RLS, realtime |
| Backend | FastAPI (Python) | REST API gateway, background tasks |
| AI Framework | Google ADK (Agent Development Kit) | Agent orchestration for Lux + Voice |
| Chat/Vision AI | Gemini 2.5 Flash | Design chat, trend analysis, tech packs |
| Image Generation | Gemini 2.5 Flash Image | Product image generation and editing |
| Collection Planning | Gemini 3 Pro Preview | Complex multi-product collection planning |
| Voice AI | Gemini Live 2.5 Flash Native Audio | Bidirectional voice streaming |
| Video Generation | Veo 3.1 | Multi-scene ad video generation |
| Search Grounding | Google Search (via Gemini) | Real-time fashion trend data |
| Image CDN | Bria FIBO API | Structured image generation (legacy) |
| Object Storage | Google Cloud Storage | Product images, videos |
| Cache | Redis (optional) | API response caching |

---

## Gemini Models Used

| Model ID | Use Case | Location |
|----------|----------|----------|
| `gemini-2.5-flash` | Design chat, trend analysis, tech packs, image prompts, ADK agent LLM | `global` or `us-central1` |
| `gemini-2.5-flash-image` | Product image generation and editing | `global` |
| `gemini-3-pro-preview` | Collection planning (complex multi-product) | `us-central1` |
| `gemini-live-2.5-flash-native-audio` | Voice companion (bidirectional audio streaming) | `us-central1` |
