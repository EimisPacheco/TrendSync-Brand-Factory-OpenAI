/**
 * API client for TrendSync FastAPI Backend (port 8000)
 * Centralizes all backend calls — no direct Gemini calls from the browser.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const t0 = performance.now();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const elapsed = Math.round(performance.now() - t0);

  if (!res.ok) {
    const text = await res.text();
    console.log(`%c[API] ❌ ${options?.method || "GET"} ${path} — ${res.status} (${elapsed}ms)`, "color: #ef4444");
    throw new Error(`API ${res.status}: ${text}`);
  }

  // Log with color coding: fast (<200ms) = likely cached, slow = fresh Gemini call
  const isFast = elapsed < 200;
  const style = isFast
    ? "color: #22c55e; font-weight: bold"   // green = from Redis
    : "color: #f59e0b; font-weight: bold";  // amber = fresh API call
  const source = isFast ? "⚡ Redis cache" : "🔄 Gemini API";
  console.log(`%c[API] ${source} — ${options?.method || "GET"} ${path} (${elapsed}ms)`, style);

  return res.json();
}

// ---------- Health ----------

export async function healthCheck() {
  return apiFetch<{ status: string; service: string }>("/health");
}

// ---------- Brand Style ----------

export async function getBrandStyle(brandId: string) {
  return apiFetch<{ brand_id: string; style: Record<string, unknown> }>(
    `/brands/${brandId}/style`
  );
}

export async function saveBrandStyle(
  brandId: string,
  style: Record<string, unknown>
) {
  return apiFetch(`/brands/${brandId}/style`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, style }),
  });
}

// ---------- Trends ----------

export interface TrendInsightsResponse {
  success: boolean;
  insights: {
    colors: { name: string; hex?: string; confidence: number; description: string }[];
    silhouettes: { name: string; confidence: number; description: string }[];
    materials: { name: string; confidence: number; description: string }[];
    themes: { name: string; confidence: number; description: string }[];
    celebrities?: { name: string; profession: string; signature_style: string; influence_score?: number }[];
    summary: string;
  };
}

export async function fetchTrends(params: {
  season?: string;
  region?: string;
  demographic?: string;
  trend_source?: string;
}) {
  return apiFetch<TrendInsightsResponse>("/trends", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export interface CelebrityResponse {
  success: boolean;
  celebrities: {
    name: string;
    profession: string;
    signature_style: string;
    influence_score: number;
  }[];
}

export async function fetchCelebrities(demographic = "millennials") {
  return apiFetch<CelebrityResponse>(
    `/trends/celebrities?demographic=${encodeURIComponent(demographic)}`
  );
}

// ---------- Collections ----------

export async function startCollectionGeneration(config: {
  brand_id: string;
  season?: string;
  region?: string;
  demographic?: string;
  categories?: string[];
  product_count?: number;
  trend_source?: string;
}) {
  return apiFetch<{
    success: boolean;
    collection_id: string;
    status: string;
  }>("/generate-collection", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function getCollection(collectionId: string) {
  return apiFetch<Record<string, unknown>>(`/collections/${collectionId}`);
}

export async function listCollections() {
  return apiFetch<{ collections: Record<string, unknown>[] }>("/collections");
}

// ---------- Image Generation ----------

export async function generateImage(params: {
  product_description: string;
  category: string;
  brand_id?: string;
  trend_colors?: Record<string, unknown>[];
  trend_materials?: Record<string, unknown>[];
}) {
  return apiFetch<{ success: boolean; image_base64: string }>(
    "/generate-image",
    { method: "POST", body: JSON.stringify(params) }
  );
}

export async function editImage(params: {
  image_base64: string;
  edit_instruction: string;
}) {
  return apiFetch<{ success: boolean; image_base64: string }>("/edit-image", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Validation ----------

export async function validatePrompt(params: {
  prompt: Record<string, unknown>;
  brand_id: string;
}) {
  return apiFetch("/validate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Tech Pack ----------

export async function generateTechPack(product: Record<string, unknown>) {
  return apiFetch<{ success: boolean; techpack: Record<string, unknown> }>(
    "/generate-techpack",
    { method: "POST", body: JSON.stringify({ product }) }
  );
}

// ---------- Design Chat ----------

export async function designChat(params: {
  product_context: Record<string, unknown>;
  user_message: string;
  conversation_history?: { role: string; content: string }[];
}) {
  return apiFetch<{ success: boolean; response: string }>("/design/chat", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Design Companion (ADK Agent — Lux) ----------

export interface DesignCompanionAction {
  action: string;
  image_base64?: string;
  compliance_score?: number;
  status: string;
  message?: string;
  [key: string]: unknown;
}

export interface DesignCompanionResponse {
  success: boolean;
  response: string;
  action: DesignCompanionAction | null;
}

export async function designCompanionChat(params: {
  session_id: string;
  user_message: string;
  product_context: Record<string, unknown>;
  image_base64?: string;
  brand_id?: string;
}) {
  return apiFetch<DesignCompanionResponse>("/adk/design-companion", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Direct Image Edit (bypasses ADK — 1 API call vs 3) ----------

export interface DirectEditResponse {
  success: boolean;
  image_base64: string;
  message: string;
}

export async function directEditImage(params: {
  image_base64: string;
  edit_instruction: string;
}) {
  return apiFetch<DirectEditResponse>("/direct-edit-image", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Save Design (analyze image → update all specs) ----------

export interface SaveDesignResponse {
  success: boolean;
  design_spec_json: Record<string, unknown>;
  fibo_prompt_json: Record<string, unknown>;
  brand_compliance_score: number;
  error?: string;
}

export async function saveDesignAnalysis(params: {
  image_base64: string;
  product_context: Record<string, unknown>;
  brand_id?: string;
}) {
  return apiFetch<SaveDesignResponse>("/save-design", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Ad Video ----------

export async function startAdVideoGeneration(params: {
  product: Record<string, unknown>;
  brand_id: string;
  product_image_base64?: string;
  campaign_brief?: string;
  ad_style?: string;
}) {
  return apiFetch<{ success: boolean; ad_id: string; status: string }>(
    "/generate-ad-video",
    { method: "POST", body: JSON.stringify(params) }
  );
}

export async function getAdVideo(adId: string) {
  return apiFetch(`/ad-videos/${adId}`);
}

// ---------- Single Product Video (on-demand) ----------

export async function startProductVideo(params: {
  product: Record<string, unknown>;
  brand_id: string;
  image_base64?: string;
}) {
  return apiFetch<{ success: boolean; video_id: string; status: string }>(
    "/generate-product-video",
    { method: "POST", body: JSON.stringify(params) }
  );
}

export interface ProductVideoStatus {
  video_id: string;
  status: "pending" | "generating" | "complete" | "failed";
  message?: string;
  error?: string;
  video_base64?: string;
  video_url?: string;
  video_prompt?: string;
}

export async function getProductVideoStatus(videoId: string) {
  return apiFetch<ProductVideoStatus>(`/product-videos/${videoId}`);
}

// ---------- Full Pipeline (ADK Orchestrator) ----------

export interface PipelineConfig {
  brand_id: string;
  season?: string;
  region?: string;
  demographic?: string;
  categories?: string[];
  product_count?: number;
  trend_source?: string;
  generate_ad_video?: boolean;
  campaign_brief?: string;
  ad_style?: string;
}

export interface PipelineProduct {
  name: string;
  category: string;
  description: string;
  color_story: string;
  material: string;
  target_price: string;
  image_url: string | null;
  image_base64?: string | null;
  product_id: string;
  compliance_score?: number;
  video_base64?: string | null;
  video_url?: string | null;
}

export interface PipelineResult {
  collection_id: string;
  collection_name: string;
  collection_description: string;
  season: string;
  region: string;
  demographic: string;
  product_count: number;
  products: PipelineProduct[];
  trend_insights: {
    summary: string;
    colors: { name: string; hex?: string }[];
    materials: { name: string }[];
    silhouettes: { name: string }[];
  };
  ad_video: {
    ad_id: string;
    title: string;
    stitched_video_url?: string | null;
    stitched_video_base64?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface PipelineStatus {
  pipeline_id: string;
  status: "running" | "complete" | "failed";
  current_step: string;
  message: string;
  completed_steps: string[];
  step_data: Record<string, unknown>;
  step_results: Record<string, Record<string, unknown>>;
  error: string | null;
  result?: PipelineResult;
}

export async function startPipeline(config: PipelineConfig) {
  return apiFetch<{ success: boolean; pipeline_id: string; status: string }>(
    "/adk/pipeline",
    { method: "POST", body: JSON.stringify(config) }
  );
}

export async function getPipelineStatus(pipelineId: string) {
  return apiFetch<PipelineStatus>(`/adk/pipeline/${pipelineId}/status`);
}

// ---------- Voice Companion ----------

export function getVoiceCompanionWsUrl(sessionId: string): string {
  // Connect directly to voice companion backend (port 8002)
  // instead of proxying through main backend (port 8000) which returns 403
  const voiceBase = import.meta.env.VITE_VOICE_COMPANION_URL || "ws://localhost:8002";
  return `${voiceBase}/ws/voice-companion/${sessionId}`;
}

// ---------- Foxit PDF Generation ----------

export async function generateTechPackPDF(params: {
  product: Record<string, unknown>;
  techpack?: Record<string, unknown>;
  brand_name?: string;
}) {
  return apiFetch<{
    success: boolean;
    pdf_base64: string;
    techpack: Record<string, unknown>;
  }>("/generate-techpack-pdf", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function generateLookbook(params: {
  products: { product: Record<string, unknown>; techpack?: Record<string, unknown> }[];
  brand_name?: string;
}) {
  return apiFetch<{
    success: boolean;
    pdf_base64: string;
    product_count: number;
  }>("/generate-lookbook", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Start payload for voice companion WebSocket — include productImageBase64 for vision analysis */
export interface VoiceCompanionStartPayload {
  type: "start";
  productName?: string;
  productDescription?: string;
  collectionName?: string;
  brandName?: string;
  currentPage?: string;
  productImageBase64?: string;
}
