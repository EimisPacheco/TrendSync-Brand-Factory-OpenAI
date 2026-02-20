# TrendSync Brand Factory

AI-powered fashion design platform that analyzes real-time trends via Gemini + Google Search, generates brand-compliant collections with AI imagery, produces manufacturing-ready tech packs with professional PDF output via Foxit, and offers a voice design companion — all from a single dashboard.

## Inspiration

The fashion industry loses billions annually to trend misalignment — brands design collections months in advance, only to find they've missed what consumers actually want. I watched independent designers struggle with the same cycle: manually scrolling Instagram, guessing at trends, and hoping their collections would land. I thought — what if AI could close that gap entirely? What if a single platform could analyze real-time global fashion trends, generate brand-compliant product imagery, produce manufacturing-ready tech packs as professionally formatted PDFs, and even create ad-ready video content — all powered by Gemini and enhanced by Foxit's document automation?

The "aha" moment came when I imagined the Veo-powered feature: a designer uploads their brand, and Gemini generates a video of their future self presenting a completed collection on a runway. "This can be your future you." That emotional hook — seeing your vision materialized before you've even cut fabric — became the soul of TrendSync Brand Factory. And the practical backbone became Foxit — because a fashion collection isn't real until it's a PDF you can send to a manufacturer.

## What it does

TrendSync Brand Factory is an end-to-end AI fashion design platform built on Google's Gemini ecosystem with Foxit document automation for professional output:

- **Trend Intelligence Engine**: Uses `gemini-2.5-flash` with Google Search grounding to analyze real-time fashion trends across 6 global markets (LA, NYC, London, Tokyo, Paris, Seoul), broken down by colors, silhouettes, materials, themes, and celebrity influence — all sourced from live web data, not stale datasets. Results are cached in Redis with 24-hour TTL to minimize API costs.

- **AI Collection Generator**: Takes trend insights + brand guidelines and uses `gemini-3-pro-preview` with structured thinking levels (HIGH for hero pieces, LOW for supporting items) to generate complete fashion collections. A two-phase approach — Phase A plans the collection structure, Phase B expands each product with 200-300 word image prompts — followed by validation and automated repair (up to 3 retries) ensures every collection is structurally complete.

- **AI Image Generation**: A two-step pipeline — `gemini-2.5-flash` builds a detailed art-direction prompt incorporating brand style, lighting, camera settings, and trend data, then `gemini-3-pro-image-preview` generates the actual product image. Images are stored in Google Cloud Storage (`trendsync-brand-factory-media` bucket) with signed URLs, falling back to base64 data URLs when needed.

- **Brand Guardian**: An AI-powered compliance engine that scores every generated product against the brand's color palette, negative prompts, camera settings, and lighting configuration — automatically flagging violations. Compliance scores are stored per product and displayed in the gallery view.

- **ADK Design Companion ("Lux")**: A Google ADK-powered conversational AI agent with 7 specialized tools — image analysis, image editing, brand compliance adjustment, trend data fetching, compliance validation, image variation generation, and design saving. Built with `gemini-2.5-flash` on Vertex AI with a critical architectural innovation: large data (base64 images) is stored externally in `_IMAGE_STORE` to prevent ADK's history serialization from exceeding token limits. Fresh sessions per request prevent history accumulation.

- **Tech Pack Generator**: Uses `gemini-3-pro-preview` to produce manufacturing-ready technical specifications — fabric details, measurements, construction notes, quality control standards, packaging — from a single product description. Tech packs are persisted to Supabase as the **single source of truth**: the `techpack_json` column with a `techpack_generated` flag ensures that PDFs always reflect exactly what the designer approved in the UI, never a re-hallucinated variation.

- **Foxit Professional PDF Pipeline**: The crown jewel of document output — tech packs and collection lookbooks are generated as professionally styled PDFs using Foxit's cloud APIs (see dedicated section below).

- **Voice Design Companion**: A native audio agent using `gemini-live-2.5-flash-native-audio` with bidirectional WebSocket streaming. Designers talk through design decisions hands-free — raw PCM audio at 16kHz flows as binary WebSocket frames (no JSON+base64 overhead) for minimal latency. The voice agent shares all 7 design tools with the typing companion plus 3 voice-exclusive tools: video generation, page navigation, and collection generation. Audio context window compression (trigger at 100K tokens, slide to 80K) prevents overflow during long sessions.

- **"Future You" Ad Video Generator**: The flagship feature — powered by Veo 3.1, it takes a completed collection and generates 8-second cinematic ad videos. A 5-scene storyboard (hook, hero, detail, lifestyle, CTA) is planned by `gemini-3-pro-preview` with structured thinking, then each scene is generated as video via Veo with the product image as a style reference. Videos are stored in Google Cloud Storage.

- **Login Monitoring**: Every sign-in is double-logged — a `login_audit` record in Supabase (user ID, browser, timestamp) plus a real-time email notification via Resend API to the admin, providing instant awareness of platform activity.

## How Foxit Powers Professional Document Output

Foxit's document automation APIs are central to TrendSync's professional output pipeline. We use **Foxit PDF Services** for document conversion, compression, and merging — creating a complete "generate, process, deliver" workflow that turns AI-generated fashion data into manufacturer-ready documents.

### The Problem Foxit Solves

AI can generate brilliant fashion collections, but the fashion industry runs on PDFs. Manufacturers need tech packs. Buyers need lookbooks. Emails need attachments. Without professional document output, an AI platform is just a demo. Foxit bridges the gap between AI intelligence and industry-standard deliverables.

### Architecture: DOCX-to-PDF Pipeline

```
Designer clicks "Download PDF"
        |
   POST /generate-techpack-pdf
        |
        v
   Backend (foxit_service.py)
        |
        +-- Step 1: python-docx builds styled DOCX (local)
        |   - Navy header bar with brand name + product name
        |   - 4-column product info table (SKU, Category, Price, Persona...)
        |   - 7 styled sections with blue heading bars
        |   - Alternating-row measurements table (XS-XL)
        |   - Foxit-branded footer
        |
        +-- Step 2: Upload DOCX to Foxit PDF Services (cloud)
        |   POST /pdf-services/api/documents/upload
        |   -> returns documentId
        |
        +-- Step 3: Convert DOCX to PDF (cloud)
        |   POST /pdf-services/api/documents/create/pdf-from-word
        |   -> returns taskId -> poll until COMPLETED -> resultDocumentId
        |
        +-- Step 4: Compress PDF (cloud)
        |   POST /pdf-services/api/documents/modify/pdf-compress
        |   -> MEDIUM compression level -> poll -> download
        |
        +-- Step 5: Download final PDF
        |   GET /pdf-services/api/documents/{id}/download
        |
        v
   Return base64 PDF -> Frontend downloads to user's device
```

### Lookbook Generation (Collection Export)

The "Export Lookbook" feature demonstrates Foxit's **PDF merge capability** — combining multiple documents into a single professional deliverable:

```
Designer clicks "Export Lookbook"
        |
   POST /generate-lookbook
        |
        v
   For each product in collection:
        +-- Build individual DOCX (python-docx)
        +-- Upload to Foxit -> Convert to PDF
        |
   Foxit PDF Services: Merge all PDFs
        POST /pdf-services/api/documents/enhance/pdf-combine
        -> poll -> resultDocumentId
        |
   Foxit PDF Services: Compress merged PDF
        POST /pdf-services/api/documents/modify/pdf-compress
        -> poll -> download
        |
        v
   Return single lookbook PDF with all products
```

### Single Source of Truth Pattern

A critical design decision ensures document integrity: tech packs are **saved to the database before PDF generation is allowed**. The backend endpoint returns HTTP 400 if no saved tech pack exists. This prevents Gemini from hallucinating different values between what the designer sees in the UI and what appears in the PDF. The `_merge_product_into_techpack()` function merges product data (always authoritative) on top of Gemini-generated specs, ensuring consistency across every output format.

### Why Foxit Was Essential

1. **Professional Styling**: `python-docx` builds richly styled documents — navy header bars, alternating table rows, branded color palette, proper typography — that look like they came from a design agency, not a code generator.

2. **Cloud Conversion**: Foxit's PDF Services API handles DOCX-to-PDF conversion server-side with no local LibreOffice or headless browser dependency. The async task pattern (submit -> poll -> download) is reliable and production-ready.

3. **PDF Compression**: Fashion tech packs with detailed specs can be large. Foxit's compression (MEDIUM level) reduces file sizes for email attachments and faster downloads, with graceful fallback if compression fails.

4. **PDF Merging**: The lookbook feature — combining 5-20 individual tech pack PDFs into one document — would require complex PDF manipulation libraries locally. Foxit's `pdf-combine` endpoint handles this cleanly in the cloud.

5. **No Infrastructure Overhead**: Authentication is simple (client_id + client_secret headers, no OAuth), the API is RESTful, and the async polling pattern integrates naturally with Python's `httpx`. Zero DevOps burden.

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
compliance_score = 100 - (critical x 25) - (warning x 10) - (suggestion x 3)
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

The architecture is a three-tier system designed to keep Gemini at the center of every intelligent decision, with Foxit handling the professional document output layer:

**Frontend** — React 18 + TypeScript + Vite with a custom neumorphic pastel design system. Every AI interaction goes through a centralized API client (`api-client.ts`) — zero direct Gemini calls from the browser, keeping API keys secure server-side. The Vite dev server proxies `/api/resend/*` to the Resend email API for login notifications and tech pack email delivery.

**Backend (FastAPI microservices)**:
- **Main Backend (port 8000)**: The brain. All Gemini calls route through here using `google-genai` SDK with Vertex AI (`vertexai=True`). Endpoints for `/trends` (Google Search grounding), `/design/chat`, `/generate-techpack`, `/generate-image`, `/edit-image`, `/generate-collection`, `/validate`, `/generate-ad-video`, `/generate-techpack-pdf` (Foxit), `/generate-lookbook` (Foxit), and the ADK Design Companion at `/adk/design-companion`. The full pipeline runs at `/adk/pipeline` as a background task with status polling.
- **Video Generation Service (port 8001)**: Dedicated Veo 3.1 pipeline. Takes collection data + product images, generates 8-second cinematic fashion videos, stores results in Google Cloud Storage.
- **Voice Companion (port 8002)**: WebSocket server using Google ADK's `LiveRunner` with `gemini-live-2.5-flash-native-audio` for real-time bidirectional voice interaction during design sessions. Raw PCM audio streaming with no transcription overhead.

**Document Layer** — Foxit PDF Services API for DOCX-to-PDF conversion, compression, and multi-document merging. `python-docx` generates styled DOCX files locally; Foxit's cloud handles the rest.

**Database & Auth** — Supabase (PostgreSQL + Auth) with 11 tables, Row-Level Security, a Redis caching layer for trend insights and structured prompts, and a `login_audit` table for security monitoring.

**Cloud Storage** — Google Cloud Storage bucket (`trendsync-brand-factory-media`) for product images and generated videos, with signed URLs for secure access.

**Email** — Resend API for login notification emails (admin alerts on every sign-in) and tech pack email delivery with PDF attachments.

**Key Gemini integration points**:

| Task | Model | Notes |
|---|---|---|
| Trend analysis | `gemini-2.5-flash` | Google Search grounding, Redis cache |
| Collection planning | `gemini-3-pro-preview` | HIGH/LOW thinking levels, 2-phase + repair |
| Image prompt building | `gemini-2.5-flash` | Art direction with brand style |
| Product image generation | `gemini-3-pro-image-preview` | PNG output, GCS storage |
| Tech pack generation | `gemini-3-pro-preview` | LOW thinking, structured output |
| Design Companion | `gemini-2.5-flash` | ADK agent, 7 tools, external image store |
| Voice Companion | `gemini-live-2.5-flash-native-audio` | ADK LiveRunner, BIDI streaming |
| Ad video storyboard | `gemini-3-pro-preview` | 5-scene storyboard, HIGH thinking |
| Video generation | Veo 3.1 | 8-second clips, style reference images |

The critical architectural decision was using Google Search as a grounding tool for trend analysis — this gives TrendSync access to *live* fashion data rather than training cutoff knowledge, making every trend report current to the day.

## Challenges I ran into

**Google Search grounding vs. structured JSON output**: I discovered that `google_search` grounding is incompatible with `response_mime_type="application/json"` in the Gemini API. I had to implement a two-pass approach — first call with grounding enabled (free-form text enriched with live web data), then parse the grounded response into structured trend data with robust JSON extraction (handles markdown fences, bracket search, direct JSON).

**ADK token limit with images**: The most insidious bug — ADK serializes `function_response` into the conversation content for subsequent model calls. A single base64 image in a tool response consumes the entire 1M token context window on the next call. Solution: external `_IMAGE_STORE` dict that lives outside ADK's state, with tools using `get_image()`/`set_image()` accessors. Fresh sessions per request prevent history accumulation.

**Gemini 3 API differences**: Gemini 3 uses `thinking_level` (HIGH/MEDIUM/LOW enum), NOT `thinking_budget` (that's Gemini 2.5). Also requires `location=global` on Vertex AI, while Veo requires `us-central1` — mixing these up causes silent failures.

**Foxit async task pattern**: Foxit PDF Services operations are async — you submit a task, get a `taskId`, and poll until `COMPLETED`. Implementing reliable polling with timeouts (120 seconds), error handling, and graceful fallbacks (if compression fails, return uncompressed PDF) required careful engineering. The polling loop runs every 2 seconds with proper timeout detection.

**PDF data consistency**: Gemini can hallucinate different values each time it's called. A tech pack generated at 2pm might differ from one generated at 3pm for the same product. Solution: save the tech pack to Supabase once (with `techpack_generated: true` flag), and enforce that the PDF endpoint only accepts pre-saved data. The frontend blocks PDF download until the tech pack is persisted.

**Veo duration limits**: Veo 3.1 supports only 8-second clips when using reference images (`reference_to_video` mode), not the 10 seconds documented for text-only prompts. Discovered through runtime errors after the initial implementation.

**Supabase RLS infinite recursion**: A Row-Level Security policy on `user_profiles` that checked admin status by querying `user_profiles` itself created an infinite loop. Had to drop it and rely on JWT-based role checks instead.

**Voice audio latency**: Initial implementation used JSON + base64 encoding for audio frames, adding significant latency. Switching to raw PCM binary WebSocket frames eliminated the encoding overhead entirely.

## Accomplishments that I'm proud of

**Real-time trend intelligence that actually works**: The combination of `gemini-2.5-flash` + Google Search grounding produces trend reports that match what I see on Vogue and WGSN — colors, silhouettes, materials, themes — all grounded in current web data. This isn't hallucinated fashion advice; it's AI-synthesized market intelligence.

**End-to-end pipeline in one platform**: From trend analysis to collection planning to image generation to brand compliance to tech packs to professional PDFs to ad videos — the entire fashion design workflow lives in one tool. A designer can go from "what's trending?" to "here's my manufacturer-ready collection with professional tech pack PDFs and a promotional video" in a single session.

**Professional document output via Foxit**: The Foxit integration transforms AI-generated data into documents that look like they came from a professional design agency. Navy branded headers, structured measurement tables, compressed PDFs ready for email — this is the difference between a hackathon demo and a production tool. The lookbook merge feature (combining multiple tech packs into a single PDF) is something manufacturers actually need.

**Single source of truth architecture**: The tech pack persistence pattern — save to DB once, generate PDF from saved data only, clear on design changes — eliminates the #1 risk of AI-generated documents: inconsistency. What you see in the UI is exactly what appears in the PDF.

**Zero API keys in the browser**: Every Gemini call, every Foxit call, every video generation goes through the FastAPI backend. The frontend is a pure presentation layer — secure by architecture, not by obscurity.

**The "Future You" concept**: Using Veo to generate aspirational runway videos from a brand brief creates an emotional moment that no competitor offers. It transforms AI from a tool into a creative partner that shows you what's possible.

**Dual-modality design companion**: The same 7 design tools work identically whether the designer is typing or speaking. The voice companion uses raw PCM streaming for near-zero latency, making it feel like talking to a creative partner rather than dictating to a machine.

## What I learned

**Gemini's Google Search grounding is a game-changer for real-time applications**. Most AI apps are limited by training cutoffs — TrendSync breaks that barrier entirely. Fashion trends shift weekly; grounded search means the platform is always current.

**`gemini-2.5-flash` is remarkably capable for production workloads**. I expected to need Pro for most tasks, but Flash handled trend analysis, conversational design chat, tech pack generation, and brand compliance reasoning with excellent quality at a fraction of the cost and latency. I reserved Gemini 3 Pro only for the most complex multi-step reasoning tasks (collection planning, storyboard generation).

**The Gemini ecosystem is genuinely composable**. Flash for speed, Pro for depth, native audio for voice, Veo for video, Google Search for grounding — these aren't separate products bolted together; they share the same SDK patterns and work naturally as a unified AI backend. Building with `google-genai` felt like having one brain with different capabilities rather than five different APIs.

**Foxit's APIs are production-ready with minimal friction**. Simple auth (client_id + client_secret headers), clean REST endpoints, and the async task pattern is straightforward to implement. The combination of DOCX-to-PDF conversion, compression, and merge covers the full document lifecycle without any local dependencies like LibreOffice or Puppeteer.

**Architecture matters more than model size**. The biggest improvements came not from switching models, but from designing the right prompts, caching strategy, data pipeline, and document generation flow. A well-structured `gemini-2.5-flash` call with proper context outperformed naive Pro calls every time. Similarly, the single source of truth pattern for tech packs solved a consistency problem that no amount of prompt engineering could fix.

**AI-generated documents need a trust layer**. Users don't trust AI output they can't verify. By showing the tech pack in the UI first, letting the designer review it, saving it to the database, and then generating the PDF from that saved data — we created a trust layer. Foxit is the final step in that chain: turning verified data into a professional deliverable.

## What's next for TrendSync Brand Factory

- **Multi-brand portfolio management**: Supporting agencies that manage multiple fashion brands, each with distinct guidelines, from one dashboard.
- **Runway video customization**: Letting designers control Veo parameters — venue style, lighting mood, model demographics, music genre — to create truly personalized "Future You" videos.
- **Supplier matching**: Using Gemini to match tech pack specifications with a database of global manufacturers, completing the design-to-production pipeline.
- **Mobile companion app**: A voice-first mobile interface using `gemini-live-2.5-flash-native-audio` so designers can iterate on collections while away from their desk — "Hey TrendSync, swap the jacket color to the trending terracotta I saw in the Seoul report."
- **Foxit watermarking**: Adding brand watermarks to tech pack PDFs via Foxit's PDF Services watermark API for intellectual property protection during the vendor review process.
- **Interactive PDF lookbooks**: Using Foxit's advanced PDF features to add clickable navigation, embedded color swatches, and interactive measurement tables to collection lookbooks.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | FastAPI (Python), 3 microservices |
| AI Models | Gemini 3 Pro, Gemini 2.5 Flash, Gemini 3 Image, Gemini Live Audio, Veo 3.1 |
| AI Framework | Google ADK (Agent Development Kit), Vertex AI |
| Documents | Foxit PDF Services API, python-docx |
| Database | Supabase (PostgreSQL), Redis cache |
| Storage | Google Cloud Storage |
| Auth | Supabase Auth (JWT + RLS) |
| Email | Resend API |
| Video | Veo 3.1 via Vertex AI, ffmpeg |
