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

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, blob, {
        upsert: true,
        contentType: blob.type || 'image/png',
      });

    if (error) {
      console.error(`[image-storage] Upload failed for ${storagePath}:`, error.message);
      return null;
    }

    // Build permanent public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
    return publicUrl;
  } catch (err) {
    console.error(`[image-storage] Upload error:`, err);
    return null;
  }
}
