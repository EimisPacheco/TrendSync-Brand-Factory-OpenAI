import { fal } from '@fal-ai/client';

export interface FalConfig {
  apiKey: string;
}

export interface ImageEditRequest {
  prompt: string;
  imageUrls: string[];
  aspectRatio?: string;
  numImages?: number;
  thoughtSignature?: string; // For multi-turn editing to preserve context
}

export interface ImageEditResponse {
  images: Array<{
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
    width: number;
    height: number;
  }>;
  timings: {
    inference: number;
  };
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
  thoughtSignature?: string; // To use in next turn for context preservation
}

export class FalAPIError extends Error {
  constructor(
    message: string,
    public code?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'FalAPIError';
  }
}

export class FalAPIService {
  private apiKey: string;

  constructor(config: FalConfig) {
    this.apiKey = config.apiKey;

    // Configure fal.ai client with API key
    if (this.apiKey) {
      // Set the API key in the client configuration
      fal.config({
        credentials: this.apiKey
      });
    }
  }

  /**
   * Edit an image while preserving its structure using Gemini-3-pro-image-preview
   * This is ideal for changing colors while maintaining product shape
   */
  async editImageWithStructurePreservation(
    request: ImageEditRequest
  ): Promise<ImageEditResponse> {
    try {
      console.log('🎨 Fal.ai Image Edit Request:', {
        model: 'fal-ai/gemini-3-pro-image-preview/edit',
        prompt: request.prompt,
        imageUrls: request.imageUrls,
        aspectRatio: request.aspectRatio,
        numImages: request.numImages || 1,
        hasThoughtSignature: !!request.thoughtSignature
      });

      // Use the gemini-3-pro-image-preview model for better structure preservation
      const result = await fal.subscribe('fal-ai/gemini-3-pro-image-preview/edit', {
        input: {
          prompt: request.prompt,
          image_urls: request.imageUrls,
          aspect_ratio: request.aspectRatio || '1:1',
          num_images: request.numImages || 1,
          ...(request.thoughtSignature && { thought_signature: request.thoughtSignature })
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            console.log('🔄 Fal.ai processing:', update.logs?.map((log) => log.message).join(', '));
          }
        },
      });

      console.log('✅ Fal.ai Image Edit Response:', {
        success: true,
        imagesCount: result.data?.images?.length || 0,
        requestId: result.requestId,
        hasThoughtSignature: !!result.data?.thoughtSignature
      });

      // Extract thought signature for potential multi-turn editing
      if (result.data?.thoughtSignature) {
        console.log('💭 Thought signature captured for context preservation');
      }

      return result.data as ImageEditResponse;
    } catch (error: any) {
      console.error('❌ Fal.ai API Error:', error);
      throw new FalAPIError(
        `Image edit failed: ${error.message}`,
        error.status,
        error
      );
    }
  }

  /**
   * Alternative method using the standard Nano Banana edit endpoint
   * Fallback option if gemini-3-pro-image-preview is not available
   */
  async editImageWithNanoBanana(
    request: ImageEditRequest
  ): Promise<ImageEditResponse> {
    try {
      console.log('🍌 Nano Banana Image Edit Request:', {
        model: 'fal-ai/nano-banana/edit',
        prompt: request.prompt,
        imageUrls: request.imageUrls
      });

      const result = await fal.subscribe('fal-ai/nano-banana/edit', {
        input: {
          prompt: request.prompt,
          image_urls: request.imageUrls,
          aspect_ratio: request.aspectRatio || '1:1',
          num_images: request.numImages || 1
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === 'IN_PROGRESS') {
            console.log('🔄 Nano Banana processing:', update.logs?.map((log) => log.message).join(', '));
          }
        },
      });

      console.log('✅ Nano Banana Image Edit Response:', {
        success: true,
        imagesCount: result.data?.images?.length || 0,
        requestId: result.requestId
      });

      return result.data as ImageEditResponse;
    } catch (error: any) {
      console.error('❌ Nano Banana API Error:', error);
      throw new FalAPIError(
        `Nano Banana edit failed: ${error.message}`,
        error.status,
        error
      );
    }
  }

  /**
   * Generate a completely new image with Nano Banana Pro (text-to-image)
   * This is not for preserving structure, but for generating new images
   */
  async generateImageWithNanoBananaPro(
    prompt: string,
    options?: {
      aspectRatio?: string;
      numImages?: number;
    }
  ): Promise<ImageEditResponse> {
    try {
      console.log('🍌 Nano Banana Pro Generation Request:', {
        model: 'fal-ai/nano-banana-pro',
        prompt,
        ...options
      });

      const result = await fal.subscribe('fal-ai/nano-banana-pro', {
        input: {
          prompt,
          aspect_ratio: options?.aspectRatio || '1:1',
          num_images: options?.numImages || 1
        }
      });

      console.log('✅ Nano Banana Pro Generation Response:', {
        success: true,
        imagesCount: result.data?.images?.length || 0,
        requestId: result.requestId
      });

      return result.data as ImageEditResponse;
    } catch (error: any) {
      console.error('❌ Nano Banana Pro API Error:', error);
      throw new FalAPIError(
        `Nano Banana Pro generation failed: ${error.message}`,
        error.status,
        error
      );
    }
  }
}