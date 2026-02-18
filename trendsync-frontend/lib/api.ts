/**
 * API client for TrendSync Backend (FastAPI on port 8000)
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const VOICE_BASE = process.env.NEXT_PUBLIC_VOICE_AGENT_URL || "http://localhost:8002";

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------- Brand Style ----------

export async function getBrandStyle(brandId: string) {
  return apiFetch<{ brand_id: string; style: Record<string, unknown> }>(`/brands/${brandId}/style`);
}

export async function saveBrandStyle(brandId: string, style: Record<string, unknown>) {
  return apiFetch(`/brands/${brandId}/style`, {
    method: "POST",
    body: JSON.stringify({ brand_id: brandId, style }),
  });
}

// ---------- Trends ----------

export async function fetchTrends(params: {
  season?: string;
  region?: string;
  demographic?: string;
  trend_source?: string;
}) {
  return apiFetch<{ success: boolean; insights: Record<string, unknown> }>("/trends", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fetchCelebrities(demographic = "millennials") {
  return apiFetch<{ success: boolean; celebrities: Record<string, unknown>[] }>(
    `/trends/celebrities?demographic=${demographic}`
  );
}

// ---------- Collections ----------

export async function startCollectionGeneration(config: Record<string, unknown>) {
  return apiFetch<{ success: boolean; collection_id: string; status: string }>(
    "/generate-collection",
    { method: "POST", body: JSON.stringify(config) }
  );
}

export async function getCollection(collectionId: string) {
  return apiFetch(`/collections/${collectionId}`);
}

export async function listCollections() {
  return apiFetch<{ collections: Record<string, unknown>[] }>("/collections");
}

// ---------- Image Generation ----------

export async function generateImage(params: {
  product_description: string;
  category: string;
  brand_id?: string;
}) {
  return apiFetch<{ success: boolean; image_base64: string }>("/generate-image", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function editImage(params: { image_base64: string; edit_instruction: string }) {
  return apiFetch<{ success: boolean; image_base64: string }>("/edit-image", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ---------- Validation ----------

export async function validatePrompt(params: { prompt: Record<string, unknown>; brand_id: string }) {
  return apiFetch("/validate", { method: "POST", body: JSON.stringify(params) });
}

// ---------- Tech Pack ----------

export async function generateTechPack(product: Record<string, unknown>) {
  return apiFetch<{ success: boolean; techpack: Record<string, unknown> }>("/generate-techpack", {
    method: "POST",
    body: JSON.stringify({ product }),
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

// ---------- Voice Companion ----------

export function getVoiceCompanionWsUrl(sessionId: string): string {
  const wsProtocol = VOICE_BASE.startsWith("https") ? "wss" : "ws";
  const wsHost = VOICE_BASE.replace(/^https?:\/\//, "");
  return `${wsProtocol}://${wsHost}/ws/voice-companion/${sessionId}`;
}
