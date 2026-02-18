import { retryWithBackoff } from '../lib/retry';
import type { FIBOPromptJSON } from '../types/database';

// Use proxy in development to avoid CORS issues
const BRIA_API_BASE = import.meta.env.DEV
  ? '/api/bria/v2'  // Development: route through Vite proxy
  : 'https://engine.prod.bria-api.com/v2';  // Production: direct API call

export interface BriaConfig {
  apiKey: string;
}

export interface GenerateStructuredPromptRequest {
  prompt?: string;
  images?: string[];
  negative_prompt?: string;
  sync?: boolean;
  useLite?: boolean;
}

export interface GenerateStructuredPromptResponse {
  structured_prompt: FIBOPromptJSON;
  request_id?: string;
}

export interface GenerateImageRequest {
  structured_prompt?: FIBOPromptJSON;
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  steps_num?: number;
  guidance_scale?: number;
  seed?: number;
  sync?: boolean;
}

export interface GenerateImageResponse {
  result_url?: string;
  status_url?: string;
  status?: 'success' | 'processing' | 'failed';
  request_id?: string;
  structured_prompt?: FIBOPromptJSON;
}

export interface StatusCheckResponse {
  status: 'success' | 'processing' | 'failed';
  result_url?: string;
  error?: string;
}

export class BriaAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BriaAPIError';
  }
}

export class BriaAPIService {
  private apiKey: string;

  constructor(config: BriaConfig) {
    if (!config.apiKey) {
      throw new Error('Bria API key is required');
    }
    this.apiKey = config.apiKey;
  }

  /**
   * Step 1: Generate structured prompt from text description or images
   * This uses Bria's VLM to convert a text prompt or reference images into structured JSON
   */
  async generateStructuredPrompt(
    request: GenerateStructuredPromptRequest
  ): Promise<GenerateStructuredPromptResponse> {
    return await retryWithBackoff(
      async () => {
        // Choose endpoint: /lite for faster processing, standard for full quality
        const endpoint = request.useLite
          ? `${BRIA_API_BASE}/structured_prompt/generate/lite`
          : `${BRIA_API_BASE}/structured_prompt/generate`;

        // Build request body with sync=true by default for immediate response
        const requestBody: Record<string, unknown> = {
          sync: request.sync !== undefined ? request.sync : true,
        };

        // Add prompt or images (at least one is required)
        if (request.prompt) {
          requestBody.prompt = request.prompt;
        }
        if (request.images) {
          requestBody.images = request.images;
        }
        if (request.negative_prompt) {
          requestBody.negative_prompt = request.negative_prompt;
        }

        // For image-to-image requests with long URLs, consider using direct API
        // to avoid potential proxy issues
        const hasLongImageUrls = request.images?.some(url => url.length > 500);
        const shouldUseDirectApi = hasLongImageUrls && !import.meta.env.DEV;

        const apiEndpoint = shouldUseDirectApi
          ? endpoint.replace('/api/bria/v2', 'https://engine.prod.bria-api.com/v2')
          : endpoint;

        console.log('📡 Bria API Request:', {
          endpoint: apiEndpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api_token': this.apiKey.substring(0, 8) + '...',
          },
          body: {
            ...requestBody,
            images: request.images ? `[${request.images.length} image URLs]` : undefined
          },
          hasLongImageUrls,
          shouldUseDirectApi
        });

        let response;

        try {
          response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api_token': this.apiKey,
            },
            body: JSON.stringify(requestBody),
          });
        } catch (fetchError: any) {
          // If fetch fails with proxy and we have images, retry with direct API
          if (request.images && apiEndpoint.includes('/api/bria/') && fetchError.message.includes('fetch failed')) {
            console.warn('⚠️ Proxy failed for image-to-image, retrying with direct API...');
            const directEndpoint = apiEndpoint.replace('/api/bria/v2', 'https://engine.prod.bria-api.com/v2');

            response = await fetch(directEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api_token': this.apiKey,
              },
              body: JSON.stringify(requestBody),
            });
          } else {
            throw fetchError;
          }
        }

        console.log('📡 Bria API Response:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ Bria API Error Response:', errorText);
          throw new BriaAPIError(
            `Structured prompt generation failed: ${errorText}`,
            response.status,
            errorText
          );
        }

        const data = await response.json();
        console.log('📥 Bria API Data:', data);

        // Handle both response formats:
        // sync=true: { result: { structured_prompt: {...} } }
        // OR direct: { structured_prompt: {...} }
        // OR result.result: { result: { result: { structured_prompt: {...} } } }
        let structured_prompt = null;

        if (data.result && data.result.structured_prompt) {
          structured_prompt = data.result.structured_prompt;
        } else if (data.result && data.result.result && data.result.result.structured_prompt) {
          // Handle nested result.result structure
          structured_prompt = data.result.result.structured_prompt;
        } else if (data.structured_prompt) {
          structured_prompt = data.structured_prompt;
        }

        console.log('📝 Extracted structured prompt:', structured_prompt);

        if (!structured_prompt) {
          console.error('❌ Could not find structured_prompt in response:', data);
          throw new BriaAPIError(
            'Unexpected response format: missing structured_prompt',
            500,
            data
          );
        }

        return {
          structured_prompt,
          request_id: data.request_id,
        };
      },
      {
        maxRetries: 3,
        baseDelay: 1000,
        onRetry: (error, attempt, delay) => {
          console.warn(
            `Retrying structured prompt generation (attempt ${attempt}) after ${delay}ms:`,
            error.message
          );
        },
      }
    );
  }

  /**
   * Step 2: Generate image from structured prompt (or text prompt)
   * Prefer passing structured_prompt for better control
   */
  async generateImage(request: GenerateImageRequest): Promise<GenerateImageResponse> {
    return await retryWithBackoff(
      async () => {
        // Bria API requires structured_prompt to be a JSON string, not an object
        const requestBody: any = {
          ...request,
          sync: request.sync ?? true,
        };
        
        // Convert structured_prompt object to JSON string if it's an object
        if (requestBody.structured_prompt && typeof requestBody.structured_prompt === 'object') {
          requestBody.structured_prompt = JSON.stringify(requestBody.structured_prompt);
        }

        const response = await fetch(`${BRIA_API_BASE}/image/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api_token': this.apiKey,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new BriaAPIError(
            `Image generation failed: ${errorText}`,
            response.status,
            errorText
          );
        }

        const data = await response.json();
        console.log('📥 Bria API Data:', data);

        // Handle both response formats based on sync mode
        if (data.result) {
          console.log('📥 Bria result object:', data.result);
          console.log('📥 Looking for URLs in result...');

          // Log all properties to see what's actually there
          console.log('📥 result properties:', Object.keys(data.result));

          // Check multiple possible URL locations in result
          const resultUrl = data.result.result_url ||
                           data.result.url ||
                           data.result.urls?.[0] ||
                           data.result.image_url ||
                           data.result.image_urls?.[0];

          console.log('📥 Found URL in result:', resultUrl);

          return {
            result_url: resultUrl,
            status_url: data.result.status_url,
            status: data.result.status,
            request_id: data.request_id,
            structured_prompt: data.result.structured_prompt,
          };
        } else {
          // Direct response format (might be the sync response)
          console.log('📥 Direct response format, properties:', Object.keys(data));

          // Check if URL is at the top level
          const directUrl = data.result_url ||
                           data.url ||
                           data.urls?.[0] ||
                           data.image_url ||
                           data.image_urls?.[0];

          console.log('📥 Found URL in direct response:', directUrl);

          if (directUrl) {
            return {
              result_url: directUrl,
              status_url: data.status_url,
              status: data.status,
              request_id: data.request_id,
              structured_prompt: data.structured_prompt,
            };
          }

          return data;
        }
      },
      {
        maxRetries: 3,
        baseDelay: 2000,
        onRetry: (error, attempt, delay) => {
          console.warn(
            `Retrying image generation (attempt ${attempt}) after ${delay}ms:`,
            error.message
          );
        },
      }
    );
  }

  /**
   * Check status of async image generation
   */
  async checkStatus(statusUrl: string): Promise<StatusCheckResponse> {
    return await retryWithBackoff(
      async () => {
        const response = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'api_token': this.apiKey,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new BriaAPIError(
            `Status check failed: ${errorText}`,
            response.status,
            errorText
          );
        }

        return await response.json();
      },
      {
        maxRetries: 2,
        baseDelay: 1000,
      }
    );
  }

  /**
   * Poll for image generation completion
   */
  async pollForCompletion(
    statusUrl: string,
    maxAttempts: number = 30,
    pollInterval: number = 2000
  ): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.checkStatus(statusUrl);
      console.log(`🔄 Poll attempt ${attempt + 1}/${maxAttempts}, status:`, status);

      // Check for various success conditions and URL locations
      if (status.status === 'success' || status.status === 'completed') {
        const url = status.result_url ||
                   status.url ||
                   status.image_url ||
                   status.result?.url ||
                   status.result?.result_url ||
                   status.result?.urls?.[0];

        if (url) {
          console.log('✅ Image generation completed, URL:', url);
          return url;
        }
      }

      if (status.status === 'failed' || status.status === 'error') {
        throw new BriaAPIError(
          `Image generation failed: ${status.error || status.message || 'Unknown error'}`,
          500,
          status
        );
      }

      // Still processing, wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new BriaAPIError(
      `Image generation timeout after ${maxAttempts} attempts`,
      504
    );
  }

  /**
   * Two-step workflow: Generate structured prompt, then generate image
   * This is the recommended approach for brand-controlled generation
   */
  async generateWithStructuredPrompt(
    textPrompt: string,
    options?: {
      aspectRatio?: string;
      seed?: number;
      stepsNum?: number;
      guidanceScale?: number;
      negativePrompt?: string;
      referenceImages?: string[];  // Add support for reference images
      onStructuredPromptGenerated?: (prompt: FIBOPromptJSON) => Promise<FIBOPromptJSON>;
    }
  ): Promise<{ imageUrl: string; structuredPrompt: FIBOPromptJSON }> {
    // Step 1: Generate structured prompt with optional reference images
    const { structured_prompt } = await this.generateStructuredPrompt({
      prompt: textPrompt,
      images: options?.referenceImages,  // Pass reference images if provided
      negative_prompt: options?.negativePrompt,
    });

    console.log('🔍 Bria API - Structured prompt generated:', structured_prompt);

    // Optional: Allow modification/validation of structured prompt
    let validatedPrompt = structured_prompt;
    if (options?.onStructuredPromptGenerated) {
      validatedPrompt = await options.onStructuredPromptGenerated(structured_prompt);
      console.log('🔍 Bria API - Validated/modified prompt:', validatedPrompt);
    }

    // Step 2: Generate image with validated structured prompt using SYNC mode
    const imageResponse = await this.generateImage({
      structured_prompt: validatedPrompt,
      aspect_ratio: options?.aspectRatio || '4:5',
      seed: options?.seed,
      steps_num: options?.stepsNum || 50,
      guidance_scale: options?.guidanceScale || 5,
      sync: true, // MUST be synchronous as requested
    });

    // Extract image URL from synchronous response
    console.log('🔍 Image response structure:', imageResponse);

    // For sync mode, the URL should be immediately available
    // Check all possible locations where the URL might be
    const imageUrl = imageResponse.result_url ||
                     imageResponse.url ||
                     imageResponse.image_url ||
                     imageResponse.urls?.[0] ||
                     imageResponse.result?.url ||
                     imageResponse.result?.result_url ||
                     imageResponse.result?.urls?.[0];

    if (!imageUrl) {
      console.error('❌ No image URL found in response:', imageResponse);
      throw new BriaAPIError(
        `No image URL returned from generation. Response structure: ${JSON.stringify(imageResponse, null, 2)}`,
        500
      );
    }

    return {
      imageUrl,
      structuredPrompt: validatedPrompt,
    };
  }
}

/**
 * Helper function to build text prompt from product specification
 */
export function buildProductPrompt(product: {
  name: string;
  category: string;
  description: string;
  colors?: string[];
  materials?: string[];
  style?: string;
  season?: string;
}): string {
  const parts: string[] = [];

  // Base description - emphasize front view and single product
  parts.push(`Professional ${product.category} product photograph of ${product.name}`);
  parts.push(`Front-facing view, showing the front of the product clearly`);
  parts.push(`Single product only, one item per image`);
  parts.push(product.description);

  // Add materials
  if (product.materials && product.materials.length > 0) {
    parts.push(`made from ${product.materials.join(' and ')}`);
  }

  // Add colors
  if (product.colors && product.colors.length > 0) {
    parts.push(`in ${product.colors.join(' and ')} colors`);
  }

  // Add style context
  if (product.style) {
    parts.push(`${product.style} style`);
  }

  if (product.season) {
    parts.push(`for ${product.season} season`);
  }

  // Photography style - reinforce front view and single product
  parts.push('Clean white studio backdrop');
  parts.push('Professional three-point lighting with soft diffusion');
  parts.push('High-end fashion photography aesthetic');
  parts.push('Centered product with balanced negative space');
  parts.push('Shallow depth of field with product in sharp focus');
  parts.push('Front-facing view only, no back view');
  parts.push('Isolated product shot, one item per image, no multiple products');

  return parts.join('. ') + '.';
}
