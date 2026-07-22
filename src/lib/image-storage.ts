import { supabase } from './supabase';

const BUCKET = 'product-images';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Check if a URL is already stored in Supabase Storage (skip re-upload).
 */
export function isSupabaseStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`);
}

/**
 * Check if a URL needs migration to Supabase Storage.
 * Returns true for data URLs, CloudFront URLs, and GCS signed URLs.
 */
export function needsMigration(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isSupabaseStorageUrl(url)) return false;
  return (
    url.startsWith('data:') ||
    url.includes('cloudfront.net') ||
    url.includes('storage.googleapis.com') ||
    url.startsWith('http')
  );
}

/**
 * Upload a product image to Supabase Storage.
 *
 * Accepts:
 * - data URL (`data:image/png;base64,...`)
 * - raw base64 string
 * - HTTP(S) URL (fetches and re-uploads)
 *
 * Returns the permanent public URL, or null on failure.
 */
export async function uploadProductImage(
  imageSource: string,
  storagePath: string,
): Promise<string | null> {
  try {
    let blob: Blob;

    if (imageSource.startsWith('data:')) {
      // Data URL → Blob
      const [header, b64] = imageSource.split(',');
      const mime = header.match(/data:(.*?);/)?.[1] || 'image/png';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mime });
    } else if (imageSource.startsWith('http')) {
      // HTTP URL → fetch → Blob
      const resp = await fetch(imageSource);
      if (!resp.ok) {
        console.warn(`[image-storage] Failed to fetch ${imageSource}: ${resp.status}`);
        return null;
      }
      blob = await resp.blob();
    } else {
      // Raw base64 string
      const binary = atob(imageSource);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: 'image/png' });
    }

    // Ensure path ends with a valid extension
    if (!storagePath.match(/\.(png|jpg|jpeg|webp)$/)) {
      storagePath += '.png';
    }

    // Retry transient errors (504 Gateway Timeout, 502, 503, network blips,
    // and the supabase-js "Unexpected token '<' is not valid JSON" path that
    // shows up when Supabase returns an HTML error page instead of JSON).
    const MAX_ATTEMPTS = 3;
    const RETRYABLE_HTTP = new Set([502, 503, 504, 408, 429]);
    const isHtmlAsJsonParseError = (msg: string) =>
      msg.includes('Unexpected token') && /<\s*html|<\s*[a-zA-Z]/.test(msg);

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, blob, {
          upsert: true,
          contentType: blob.type || 'image/png',
        });

      if (!error) {
        // Build permanent public URL on success
        return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
      }

      const msg = (error as { message?: string }).message || String(error);
      const status = (error as { statusCode?: number | string }).statusCode;
      const statusNum = typeof status === 'string' ? Number(status) : status;
      const transient =
        (typeof statusNum === 'number' && RETRYABLE_HTTP.has(statusNum)) ||
        isHtmlAsJsonParseError(msg) ||
        /timeout|timed out|fetch failed|network/i.test(msg);

      lastError = `[${statusNum ?? '?'}] ${msg.slice(0, 200)}`;

      if (transient && attempt < MAX_ATTEMPTS) {
        const wait = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(
          `[image-storage] Transient upload error on ${storagePath} ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS}): ${lastError} — retrying in ${wait}ms`,
        );
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Non-retryable, or last attempt — bail out cleanly.
      console.error(
        `[image-storage] Upload failed for ${storagePath}: ${lastError}` +
        (transient ? ' (transient — gave up after retries)' : ''),
      );
      return null;
    }

    return null; // unreachable, satisfies TS
  } catch (err) {
    // Catches "Unexpected token '<' is not valid JSON" when supabase-js
    // can't parse a 504 HTML page; treat as a transient upload failure.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[image-storage] Upload error for ${storagePath}: ${msg}`);
    return null;
  }
}
