import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiConfig {
  apiKey: string;
}

export interface ImageEditRequest {
  prompt: string;
  imageUrl: string;
  brandColors?: Array<{name: string; hex: string}>;
  userInstruction?: string; // Specific user request like "change buttons" or "modify pocket shape"
  isColorChangeOnly?: boolean; // Flag to indicate if this is just a color change
}

export interface ImageGenerationResponse {
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
}

export class GeminiAPIError extends Error {
  constructor(
    message: string,
    public code?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'GeminiAPIError';
  }
}

export class GeminiAPIService {
  private genAI: GoogleGenerativeAI;

  constructor(config: GeminiConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
  }

  /**
   * Build a targeted change prompt based on user instructions
   */
  private buildTargetedChangePrompt(userInstruction: string, brandColors?: Array<{name: string; hex: string}>): string {
    // Parse the user instruction to understand what they want to change
    const instruction = userInstruction.toLowerCase();

    // Check what the user wants to change
    const wantsColorChange = instruction.includes('color') || instruction.includes('colour');
    const wantsButtonChange = instruction.includes('button');
    const wantsPocketChange = instruction.includes('pocket');
    const wantsLengthChange = instruction.includes('length') || instruction.includes('shorter') || instruction.includes('longer');
    const wantsSleeveChange = instruction.includes('sleeve');
    const wantsCollarChange = instruction.includes('collar') || instruction.includes('neckline');
    const wantsPatternChange = instruction.includes('pattern') || instruction.includes('print');

    let prompt = `Using the provided image, make the following specific changes:\n\n`;
    prompt += `USER REQUEST: "${userInstruction}"\n\n`;

    prompt += `INSTRUCTIONS:\n`;

    // Add specific instructions based on what the user wants
    if (wantsColorChange && brandColors) {
      const colorList = brandColors.map(c => `${c.name} (${c.hex})`).join(', ');
      prompt += `- Change the colors to: ${colorList}\n`;
    }

    if (wantsButtonChange) {
      prompt += `- Modify the buttons as requested: ${userInstruction}\n`;
      prompt += `- Keep everything else about the garment exactly the same\n`;
    }

    if (wantsPocketChange) {
      prompt += `- Modify the pockets as requested: ${userInstruction}\n`;
      prompt += `- Preserve all other design elements\n`;
    }

    if (wantsLengthChange) {
      prompt += `- Adjust the length as requested: ${userInstruction}\n`;
      prompt += `- Maintain the same style and proportions\n`;
    }

    if (wantsSleeveChange) {
      prompt += `- Modify the sleeves as requested: ${userInstruction}\n`;
      prompt += `- Keep the rest of the garment unchanged\n`;
    }

    if (wantsCollarChange) {
      prompt += `- Change the collar/neckline as requested: ${userInstruction}\n`;
      prompt += `- Preserve all other aspects of the design\n`;
    }

    if (wantsPatternChange) {
      prompt += `- Modify the pattern/print as requested: ${userInstruction}\n`;
      prompt += `- Keep the garment structure and shape identical\n`;
    }

    prompt += `\nCRITICAL RULE: ONLY change what the user explicitly requested. Everything else must remain EXACTLY the same.\n`;
    prompt += `- If user only asked to change colors, DO NOT change buttons, pockets, or shape\n`;
    prompt += `- If user only asked to change buttons, DO NOT change colors, pockets, or shape\n`;
    prompt += `- If user only asked to change pockets, DO NOT change colors, buttons, or shape\n`;
    prompt += `- Preserve the exact product identity except for the requested changes\n`;
    prompt += `\nOUTPUT: Generate and return a new image with the requested changes applied.\n`;

    return prompt;
  }

  /**
   * Convert image URL to base64 data URL for Gemini
   */
  private async imageUrlToBase64(imageUrl: string): Promise<{ inlineData: { data: string; mimeType: string } }> {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          // Remove the data URL prefix to get just the base64 string
          const base64Data = base64.split(',')[1];
          resolve({
            inlineData: {
              data: base64Data,
              mimeType: blob.type || 'image/png'
            }
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to convert image URL to base64:', error);
      throw error;
    }
  }

  /**
   * Generate a new image with targeted changes based on user request
   * Uses Gemini Nano Banana Pro (gemini-3-pro-image-preview) for image generation
   */
  async generateImageWithTargetedChange(request: ImageEditRequest): Promise<ImageGenerationResponse> {
    try {
      console.log('🍌 Gemini Nano Banana Pro - Generating image with targeted changes');
      console.log('📝 User instruction:', request.userInstruction || 'Color change only');
      console.log('🎯 Target colors:', request.brandColors);

      // Use gemini-3-pro-image-preview (Nano Banana Pro) for image generation
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3-pro-image-preview', // Nano Banana Pro model for image generation
        generationConfig: {
          temperature: 0.4, // Lower temperature for more consistent results
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
        }
      });

      // Convert image URL to base64 for Gemini
      const imageData = await this.imageUrlToBase64(request.imageUrl);

      // Build the prompt based on what the user wants to change
      let prompt: string;

      if (request.userInstruction) {
        // User has specific instructions - parse and apply them
        prompt = this.buildTargetedChangePrompt(request.userInstruction, request.brandColors);
      } else if (request.isColorChangeOnly && request.brandColors) {
        // Just changing colors - be very strict about preservation
        const colorList = request.brandColors.map(c => `${c.name} (${c.hex})`).join(', ');
        prompt = `Using the provided image, change ONLY the product colors to: ${colorList}.

        CRITICAL INSTRUCTIONS:
        - Keep the EXACT same product shape, cut, design, and silhouette
        - Maintain ALL structural details, seams, buttons, zippers, pockets, and design elements
        - Preserve the exact style, fit, and construction of the garment
        - ONLY change the colors/colorway to match the brand colors specified
        - The product must remain identical except for the color change
        - Keep the same lighting, angle, and composition

        DO NOT CHANGE: buttons, pockets, shape, style, cut, pattern, texture, or ANY structural element.
        ONLY CHANGE: the colors of the fabric/material.

        OUTPUT: Generate and return a new image with these changes.`;
      } else {
        // General change based on provided prompt
        prompt = request.prompt;
      }

      // Send the request with image and prompt
      const result = await model.generateContent([
        prompt,
        imageData
      ]);

      const response = await result.response;

      console.log('📸 Gemini raw response:', response);
      console.log('📸 Response candidates:', response.candidates);

      // Check if response contains image parts
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        console.log('📸 First candidate:', candidate);
        console.log('📸 Candidate content:', candidate.content);
        console.log('📸 Content parts:', candidate.content?.parts);

        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            console.log('📸 Part type:', Object.keys(part));

            // Check for inline image data
            if (part.inlineData) {
              console.log('✅ Found inline image data!');
              return {
                imageBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || 'image/png'
              };
            }

            // Check for text that might contain base64
            if (part.text) {
              console.log('📝 Found text response:', part.text.substring(0, 200));

              // Check if the text contains a base64 image
              const base64Match = part.text.match(/data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/);
              if (base64Match) {
                console.log('✅ Found base64 image in text!');
                return {
                  imageBase64: base64Match[2],
                  mimeType: `image/${base64Match[1]}`
                };
              }
            }
          }
        }
      }

      // Try to get text response for debugging
      try {
        const text = response.text();
        console.log('📝 Full text response:', text.substring(0, 500));
      } catch (e) {
        console.log('Could not extract text from response');
      }

      throw new Error('No image data found in Gemini response. The model may not support image generation or needs different parameters.');

    } catch (error: any) {
      console.error('❌ Gemini Image Generation Error:', error);
      throw new GeminiAPIError(
        `Failed to generate image with color change: ${error.message}`,
        error.status,
        error
      );
    }
  }

  /**
   * Alternative method using streaming for image generation
   */
  async generateImageStream(request: ImageEditRequest): Promise<ImageGenerationResponse> {
    try {
      console.log('🌊 Gemini API - Streaming image generation');

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3-pro-image-preview', // Nano Banana Pro model for image generation
        generationConfig: {
          temperature: 0.4,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
        }
      });

      // Convert image URL to base64
      const imageData = await this.imageUrlToBase64(request.imageUrl);

      const colorList = request.brandColors.map(c => `${c.name} (${c.hex})`).join(', ');

      const prompt = `Edit this product image:
      1. Change the product colors to: ${colorList}
      2. Keep everything else EXACTLY the same - same shape, style, design, structure
      3. This is an image-to-image color transfer task - preserve the product identity`;

      // Use streaming for potentially faster response
      const result = await model.generateContentStream([
        prompt,
        imageData
      ]);

      let fullResponse = '';
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        console.log('📦 Received chunk:', chunkText.length, 'chars');
      }

      console.log('✅ Stream complete');

      // Try to extract image from response
      try {
        const responseData = JSON.parse(fullResponse);
        if (responseData.image) {
          return {
            imageBase64: responseData.image,
            mimeType: responseData.mimeType || 'image/png'
          };
        }
      } catch (e) {
        console.warn('Stream response is not JSON');
      }

      // Check if response contains base64 image data
      const base64Pattern = /data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/;
      const match = fullResponse.match(base64Pattern);
      if (match) {
        return {
          imageBase64: match[2],
          mimeType: `image/${match[1]}`
        };
      }

      throw new Error('No image data found in stream response');

    } catch (error: any) {
      console.error('❌ Gemini Stream Error:', error);
      throw new GeminiAPIError(
        `Failed to generate image via stream: ${error.message}`,
        error.status,
        error
      );
    }
  }

  /**
   * Backward compatibility wrapper - redirects to generateImageWithTargetedChange
   */
  async generateImageWithColorChange(request: ImageEditRequest): Promise<ImageGenerationResponse> {
    return this.generateImageWithTargetedChange({
      ...request,
      isColorChangeOnly: true
    });
  }
}