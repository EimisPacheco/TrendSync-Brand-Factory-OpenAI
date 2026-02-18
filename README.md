# TrendSync Brand Factory

AI-powered fashion design platform that analyzes real-time trends via Gemini + Google Search, generates brand-compliant collections with AI imagery, and offers a voice design companion.

## Inspiration

The fashion industry loses billions annually to trend misalignment — brands design collections months in advance, only to find they've missed what consumers actually want. I watched independent designers struggle with the same cycle: manually scrolling Instagram, guessing at trends, and hoping their collections would land. I thought — what if AI could close that gap entirely? What if a single platform could analyze real-time global fashion trends, generate brand-compliant product imagery, produce manufacturing-ready tech packs, and even create ad-ready video content — all powered by Gemini? The "aha" moment came when I imagined the Veo-powered feature: a designer uploads their brand, and Gemini generates a video of their future self presenting a completed collection on a runway. "This can be your future you." That emotional hook — seeing your vision materialized before you've even cut fabric — became the soul of TrendSync Brand Factory.

## What it does

TrendSync Brand Factory is an end-to-end AI fashion design platform built entirely on Google's Gemini ecosystem:

- **Trend Intelligence Engine**: Uses `gemini-2.5-flash` with Google Search grounding to analyze real-time fashion trends across 6 global markets (LA, NYC, London, Tokyo, Paris, Seoul), broken down by colors, silhouettes, materials, themes, and celebrity influence — all sourced from live web data, not stale datasets.

- **AI Collection Generator**: Takes trend insights + brand guidelines and generates complete fashion collections (apparel, footwear, accessories) with AI-generated product images via Bria's FIBO structured prompt system, validated against brand compliance rules.

- **Brand Guardian**: An AI-powered compliance engine that scores every generated product against the brand's color palette, negative prompts, camera settings, and lighting config — automatically fixing violations before images are rendered.

- **Design Companion Chat**: A conversational AI assistant powered by `gemini-2.5-flash` that sits beside the designer, suggesting adjustments in natural language ("Let's swap that neon green for your brand's sage — want me to go ahead?") and applying image edits in real-time through the backend.

- **Tech Pack Generator**: Uses `gemini-2.5-flash` to produce manufacturing-ready technical specifications — materials, measurements, construction notes, quality control standards — from a single product description.

- **Voice Design Companion**: A native audio agent using `gemini-2.5-flash-native-audio` that lets designers talk through design decisions hands-free via WebSocket streaming, as naturally as talking to a creative partner.

- **"Future You" Ad Video Generator**: The flagship feature — powered by Veo, it takes a completed collection and generates a cinematic ad video showing the designer's brand on a virtual runway. The concept: Gemini talks to itself, generating the vision of "this can be your future you" — turning a brand brief into an aspirational video that feels like looking into tomorrow.

## Brand Guardian — How Validation Works

The Brand Guardian is a **rule-based compliance engine** (not hardcoded scores). It validates every product's design specification against the brand's style configuration in real-time.

### Validation Checks

| Check | What It Does | Severity |
|-------|-------------|----------|
| **Color Palette** | Extracts hex colors from the product's `color_scheme` and measures Euclidean RGB distance against the brand palette. If distance > 30 (perceptually different), it flags a violation. | `suggestion` |
| **Camera Settings** | Checks focal length (converted to FOV) and camera angle against brand-defined min/max ranges. | `warning` |
| **Lighting** | Compares lighting temperature (warm vs cool) against the brand's configured color temperature (e.g., 5000K). | `suggestion` |
| **Negative Prompts** | Scans product description and object descriptions for forbidden terms defined in brand style (e.g., "blurry", "low quality"). | `critical` |

### Scoring Formula

```
compliance_score = 100 - (critical × 25) - (warning × 10) - (suggestion × 3)
```

- **100%** = No violations found — product fully matches brand guidelines
- **75-99%** = Minor suggestions (e.g., trend colors differ from brand palette)
- **50-74%** = Warnings present (e.g., camera angle out of range)
- **<50%** = Critical violations (e.g., forbidden terms in description)

### Where Brand Rules Are Stored

Brand style rules are stored in the **Supabase `brand_styles` table** as a JSONB column (`style_json`), configured via the Brand Style Editor page:

```json
{
  "colorPalette": [{ "name": "Brand Navy", "hex": "#1a237e", "designation": "primary" }],
  "cameraSettings": { "fovMin": 20, "fovMax": 80, "angleMin": 0, "angleMax": 90 },
  "lightingConfig": { "colorTemperature": 5000 },
  "negativePrompts": ["blurry", "low quality", "distorted"],
  "materialLibrary": [...],
  "logoRules": {...}
}
```

**Implementation:** `trendsync-backend/shared/brand_guardian.py` (`validate_prompt()` function)

## How I built it

The architecture is a three-tier system designed to keep Gemini at the center of every intelligent decision:

**Frontend** — React 18 + TypeScript + Vite with a custom neumorphic pastel design system. Every AI interaction goes through a centralized API client (`api-client.ts`) — zero direct Gemini calls from the browser, keeping API keys secure server-side.

**Backend (FastAPI microservices)**:
- **Main Backend (port 8000)**: The brain. All Gemini calls route through here using `google-genai` SDK with Vertex AI (`vertexai=True`). Endpoints for `/trends` (Google Search grounding), `/design/chat`, `/generate-techpack`, `/generate-image`, `/edit-image`, `/generate-collection`, `/validate`, and `/generate-ad-video`.
- **Video Generation Service (port 8001)**: Dedicated Veo pipeline for the "Future You" ad video feature. Takes collection data + product images, generates cinematic fashion videos.
- **Voice Companion (port 8002)**: WebSocket server proxying `gemini-2.5-flash-native-audio` for real-time voice interaction during design sessions.

**Database & Auth** — Supabase (PostgreSQL + Auth) with 11 tables, Row-Level Security, and a Redis caching layer for trend insights and structured prompts.

**Key Gemini integration points**:
- `gemini-2.5-flash` — Trend analysis with Google Search grounding, design chat, tech pack generation, brand compliance reasoning
- `gemini-2.5-flash-native-audio` — Voice design companion with natural conversation
- **Veo** — "Future You" ad video generation from collection briefs
- `gemini-2.5-pro` — Complex multi-step collection planning and product ideation where deeper reasoning matters

The critical architectural decision was using Google Search as a grounding tool for trend analysis — this gives TrendSync access to *live* fashion data rather than training cutoff knowledge, making every trend report current to the day.

## Challenges I ran into

**Google Search grounding vs. structured JSON output**: I discovered that `google_search` grounding is incompatible with `response_mime_type="application/json"` in the Gemini API. I had to implement a two-pass approach — first call with grounding enabled (free-form text enriched with live web data), then parse the grounded response into structured trend data. This was a non-obvious limitation that cost me hours of debugging 400 errors.

**Vertex AI authentication on macOS**: The service account credential chain (`GOOGLE_APPLICATION_CREDENTIALS` -> ADC -> service account key) had subtle issues with the `google-genai` SDK's `vertexai=True` mode. I had to ensure the service account had `roles/aiplatform.user` and that the project/location were explicitly passed — the SDK doesn't fall back gracefully.

**Supabase RLS infinite recursion**: A Row-Level Security policy on `user_profiles` that checked admin status by querying `user_profiles` itself created an infinite loop. Discovered it was a self-referencing subquery in the policy's `USING` clause — had to drop it and rely on JWT-based role checks instead.

**Browser to Backend migration**: The original prototype called Gemini directly from the browser (exposing API keys). Migrating 6 service files to route through FastAPI without breaking the existing UI required careful interface matching — the backend had to return data in the exact shape the frontend components expected.

## Accomplishments that I'm proud of

**Real-time trend intelligence that actually works**: The combination of `gemini-2.5-flash` + Google Search grounding produces trend reports that match what I see on Vogue and WGSN — colors, silhouettes, materials, themes — all grounded in current web data. This isn't hallucinated fashion advice; it's AI-synthesized market intelligence.

**End-to-end pipeline in one platform**: From trend analysis to collection planning to image generation to brand compliance to tech packs to ad video — the entire fashion design workflow lives in one tool. A designer can go from "what's trending?" to "here's my manufactured-ready collection with a promotional video" in a single session.

**Zero API keys in the browser**: Every Gemini call goes through the FastAPI backend. The frontend is a pure presentation layer — secure by architecture, not by obscurity.

**The "Future You" concept**: Using Veo to generate aspirational runway videos from a brand brief creates an emotional moment that no competitor offers. It transforms AI from a tool into a creative partner that shows you what's possible.

## What I learned

**Gemini's Google Search grounding is a game-changer for real-time applications**. Most AI apps are limited by training cutoffs — TrendSync breaks that barrier entirely. Fashion trends shift weekly; grounded search means the platform is always current.

**`gemini-2.5-flash` is remarkably capable for production workloads**. I expected to need Pro for most tasks, but Flash handled trend analysis, conversational design chat, tech pack generation, and brand compliance reasoning with excellent quality at a fraction of the cost and latency. I reserved Pro only for the most complex multi-step reasoning tasks.

**The Gemini ecosystem is genuinely composable**. Flash for speed, Pro for depth, native audio for voice, Veo for video, Google Search for grounding — these aren't separate products bolted together; they share the same SDK patterns and work naturally as a unified AI backend. Building with `google-genai` felt like having one brain with different capabilities rather than five different APIs.

**Architecture matters more than model size**. The biggest improvements came not from switching models, but from designing the right prompts, caching strategy, and data pipeline. A well-structured `gemini-2.5-flash` call with proper context outperformed naive `gemini-2.5-pro` calls every time.

## What's next for TrendSync Brand Factory

- **Google ADK-JS Agent Framework**: Migrating the backend to use Google's Agent Development Kit for orchestrating multi-step workflows — trend analysis to collection generation to image creation to video production as a single coordinated agent pipeline.
- **Multi-brand portfolio management**: Supporting agencies that manage multiple fashion brands, each with distinct guidelines, from one dashboard.
- **Runway video customization**: Letting designers control Veo parameters — venue style, lighting mood, model demographics, music genre — to create truly personalized "Future You" videos.
- **Supplier matching**: Using Gemini to match tech pack specifications with a database of global manufacturers, completing the design-to-production pipeline.
- **Mobile companion app**: A voice-first mobile interface using `gemini-2.5-flash-native-audio` so designers can iterate on collections while away from their desk — "Hey TrendSync, swap the jacket color to the trending terracotta I saw in the Seoul report."
