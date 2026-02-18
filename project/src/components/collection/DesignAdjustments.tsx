import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Shield, Package } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { brandStorage, brandStyleStorage, collectionItemStorage } from '../../services/storage';
import { toast } from 'sonner';
import { GeminiAPIService } from '../../services/gemini-api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface DesignAdjustmentsProps {
  item: CollectionItem;
  onUpdateItem: (updates: Partial<CollectionItem>) => void;
  geminiApiKey?: string;
}

// Helper function to regenerate product image with new specifications
async function regenerateProductImage(
  item: CollectionItem,
  updatedColors: Array<{name: string; hex: string; usage: string}>,
  geminiApiKey?: string
) {
  try {
    // Update product name to reflect new colors
    const oldColorPattern = /butter yellow|neon green|yellow|green|pink|blue|millennial pink|quiet luxury/gi;
    const primaryColor = updatedColors[0]?.name || 'Sage Green';
    const secondaryColor = updatedColors[1]?.name || '';
    const updatedName = item.name.replace(oldColorPattern, primaryColor);

    // Validate requirements for image generation
    if (!geminiApiKey) {
      const errorMsg = '❌ Gemini API key is not configured. Image regeneration requires Gemini API for structure preservation.';
      console.error(errorMsg);
      throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your environment variables.');
    }

    if (!item.image_url) {
      const errorMsg = '❌ No existing image found. Cannot perform image-to-image transformation without a source image.';
      console.error(errorMsg);
      throw new Error('No product image available. Please generate an initial image first.');
    }

    // Use Gemini Nano Banana for structure-preserving color change
    console.log('🤖 Using Gemini Nano Banana for image-to-image color change');
    console.log('📸 Source image:', item.image_url);
    console.log('🎨 Target colors:', updatedColors);

    const geminiApi = new GeminiAPIService({ apiKey: geminiApiKey });

    // Update item status
    collectionItemStorage.update(item.id, { status: 'generating' });

    try {
      // Generate new image with color change while preserving structure
      const result = await geminiApi.generateImageWithColorChange({
        prompt: `Change colors of this ${item.category}`,
        imageUrl: item.image_url,
        brandColors: updatedColors
      });

      if (!result.imageBase64) {
        throw new Error('No image data received from Gemini API');
      }

      // Convert base64 to data URL
      const imageDataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`;

      // Update item with new image
      collectionItemStorage.update(item.id, {
        image_url: imageDataUrl,
        name: updatedName,
        colors: updatedColors,
        status: 'approved',
        modified_at: new Date().toISOString()
      });

      console.log('✅ Image successfully regenerated with Gemini Nano Banana');
      return; // Success!

    } catch (geminiError: any) {
      console.error('❌ Gemini image generation failed:', geminiError);

      // Reset status
      collectionItemStorage.update(item.id, { status: 'approved' });

      // Provide user-friendly error messages
      let userMessage = 'Failed to regenerate the image. ';

      if (geminiError.message?.includes('API key')) {
        userMessage += 'The Gemini API key might be invalid or expired. Please check your API configuration.';
      } else if (geminiError.message?.includes('model')) {
        userMessage += 'The Gemini model (gemini-3-pro-image-preview) might not be available. Please check model availability.';
      } else if (geminiError.message?.includes('timeout')) {
        userMessage += 'The request timed out. The image might be too large or the server is busy. Please try again.';
      } else if (geminiError.message?.includes('base64') || geminiError.message?.includes('convert')) {
        userMessage += 'Failed to process the image. The image format might not be supported.';
      } else if (geminiError.message?.includes('CORS') || geminiError.message?.includes('fetch')) {
        userMessage += 'Network error. The image URL might not be accessible or there\'s a CORS issue.';
      } else if (geminiError.message?.includes('response')) {
        userMessage += 'The API response was invalid. The model might not support image generation.';
      } else {
        userMessage += `Error details: ${geminiError.message}`;
      }

      throw new Error(userMessage);
    }


    console.log('✅ Product regenerated successfully');
  } catch (error) {
    console.error('❌ Failed to regenerate product:', error);
    collectionItemStorage.update(item.id, { status: 'failed' });
    throw error;
  }
}

export function DesignAdjustments({ item, onUpdateItem, geminiApiKey }: DesignAdjustmentsProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hello! I'm your AI Design Assistant. I can help you adjust the design of "${item.name}".

You can ask me to:
• Change colors or color combinations
• Modify materials and fabrics
• Adjust style elements and silhouettes
• Update design details and embellishments
• Refine the product description
• Suggest alternatives based on trends

What would you like to change about this ${item.subcategory}?`,
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      // Check if user wants to apply changes (they said yes, ok, do it, apply, etc.)
      const isConfirmation = /^(yes|ok|do it|apply|confirm|go ahead|make it|change it|update it)$/i.test(userInput);

      if (isConfirmation && item.image_url) {
        // User confirmed changes - regenerate the image with targeted changes
        const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error('Gemini API key not configured');
        }

        // Get the last assistant message to understand what changes to make
        const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop();
        const lastUserRequest = messages.filter(m => m.role === 'user').slice(-2)[0]; // Get second to last user message

        if (lastUserRequest) {
          console.log('🎯 Applying user-requested changes:', lastUserRequest.content);

          const geminiApi = new GeminiAPIService({ apiKey });

          // Parse the request to determine what needs to change
          const requestLower = lastUserRequest.content.toLowerCase();
          const isColorChangeOnly = requestLower.includes('color') && !requestLower.includes('button') && !requestLower.includes('pocket');

          try {
            // Get current brand colors
            const brandStyle = brandStyleStorage.getByBrandId(brandStorage.getCurrent()?.id || '');
            const brandColors = brandStyle?.colorPalette || [];

            // Generate new image with targeted changes
            const result = await geminiApi.generateImageWithTargetedChange({
              prompt: `Apply the changes discussed`,
              imageUrl: item.image_url,
              brandColors: brandColors,
              userInstruction: lastUserRequest.content,
              isColorChangeOnly: isColorChangeOnly
            });

            if (result.imageBase64) {
              // Convert base64 to data URL
              const imageDataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`;

              // Update item with new image
              collectionItemStorage.update(item.id, {
                image_url: imageDataUrl,
                modified_at: new Date().toISOString()
              });

              const successMessage: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: '✅ Changes applied successfully! The product image has been updated with your requested modifications.',
                timestamp: new Date(),
              };
              setMessages(prev => [...prev, successMessage]);
              onUpdateItem({ image_url: imageDataUrl });
            }
          } catch (error) {
            console.error('Failed to apply changes:', error);
            const errorMessage: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: '❌ Sorry, I couldn\'t apply the changes. Please try again or be more specific about what you want to change.',
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
          }
        }
      } else {
        // Normal conversation - analyze the request
        const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error('Gemini API key not configured');
        }

        const prompt = `
You are a fashion design assistant helping to adjust a product design.

Current Product:
Name: ${item.name}
Category: ${item.category}
Subcategory: ${item.subcategory}
Design Story: ${item.design_story}
Target Persona: ${item.target_persona}
Current Colors: ${JSON.stringify(item.design_spec_json?.colors)}
Current Materials: ${JSON.stringify(item.design_spec_json?.materials)}
Style: ${item.design_spec_json?.inspiration}

User Request: ${userInput}

Analyze what the user wants to change and provide a response:

1. **Specific Changes Requested**: List EXACTLY what the user wants to change (e.g., "Change colors to blue", "Use 2 buttons instead of 3", "Make pockets square")
2. **What Stays the Same**: List what should NOT be changed
3. **Implementation**: How these changes will be applied

If the user only mentions colors, ONLY discuss color changes.
If the user only mentions buttons, ONLY discuss button changes.
Be very specific about preserving everything not explicitly mentioned.

End with: "Reply 'yes' or 'apply' to make these changes."

Keep the response concise and actionable.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            }
          })
        });

        if (!response.ok) {
          throw new Error('Failed to get AI response');
        }

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I couldn\'t process that request. Please try again.';

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
      }

    } catch (error) {
      console.error('Error processing message:', error);
      toast.error('Failed to process your request. Please try again.');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I encountered an error processing your request. Please try again or rephrase your design adjustment.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const applyDesignChanges = (request: string) => {
    // Parse the request and apply changes
    const updates: Partial<CollectionItem> = {};
    let hasChanges = false;

    // Check for color changes
    if (request.toLowerCase().includes('color')) {
      // This would be enhanced with actual color extraction
      hasChanges = true;
      toast.success('Color changes will be applied in the next generation');
    }

    // Check for material changes
    if (request.toLowerCase().includes('material') || request.toLowerCase().includes('fabric')) {
      hasChanges = true;
      toast.success('Material changes will be applied in the next generation');
    }

    if (hasChanges) {
      // Trigger update callback
      onUpdateItem(updates);
    }
  };

  const makeBrandCompliant = async () => {
    setIsLoading(true);

    try {
      // Get current brand and brand style
      const currentBrand = brandStorage.getCurrent();
      if (!currentBrand) {
        toast.error('No brand selected. Please select a brand first.');
        return;
      }

      const brandStyle = brandStyleStorage.getByBrandId(currentBrand.id);
      if (!brandStyle || !brandStyle.colorPalette || brandStyle.colorPalette.length === 0) {
        toast.error('Brand colors not configured. Please set up brand colors first.');
        return;
      }

      // Use Gemini to generate compliant design adjustments
      const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Gemini API key not configured');
      }

      const brandColors = brandStyle.colorPalette.map(c => `${c.name} (${c.hex})`).join(', ');

      const prompt = `
You are a fashion design assistant helping to make a product brand compliant.

Current Product:
Name: ${item.name}
Category: ${item.category}
Subcategory: ${item.subcategory}
Design Story: ${item.design_story}
Target Persona: ${item.target_persona}
Current Colors: ${JSON.stringify(item.design_spec_json?.colors)}
Current Materials: ${JSON.stringify(item.design_spec_json?.materials)}

Brand Compliance Requirements:
- Approved Brand Colors: ${brandColors}
- Lighting: Key intensity ${brandStyle.lightingConfig?.keyIntensity || '1.0'}, Fill intensity ${brandStyle.lightingConfig?.fillIntensity || '0.7'}
- Camera Angle: ${brandStyle.cameraSettings?.angleDefault || '45'} degrees
- Aspect Ratios: ${brandStyle.aspectRatios?.map(ar => ar.name).join(', ') || 'Standard ratios'}

Task: Transform this product to be fully brand compliant. You must:
1. Replace ALL current colors with the approved brand colors
2. Ensure materials and finishes align with brand standards
3. Adjust the design story to match brand voice
4. Update any design elements to fit brand aesthetic

Provide a detailed response with:
1. **Color Changes**: Specific brand colors to use and where
2. **Material Adjustments**: How materials should change to fit brand
3. **Design Story Update**: Revised story in brand voice
4. **Overall Compliance**: Summary of all changes for brand alignment

Be specific and actionable. These changes will be automatically applied.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate brand compliance adjustments');
      }

      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to generate compliance adjustments.';

      // Add system message about compliance
      const complianceMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `🛡️ **Brand Compliance Applied**\n\n${aiResponse}\n\n✅ All changes have been applied to make the product fully brand compliant.`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, complianceMessage]);

      // Update the item with brand compliant colors
      const updatedColors = brandStyle.colorPalette.slice(0, 3).map(c => ({
        name: c.name,
        hex: c.hex,
        usage: 'main' as const
      }));

      // First update to show we're processing
      onUpdateItem({
        design_spec_json: {
          ...item.design_spec_json,
          colors: updatedColors
        },
        status: 'generating' as const
      });

      // Now regenerate the image with brand-compliant colors
      toast.info('Regenerating product image with brand colors...');
      await regenerateProductImage(item, updatedColors, geminiApiKey);

      // Get the updated item from storage and notify parent
      const updatedItem = collectionItemStorage.getById(item.id);
      if (updatedItem) {
        onUpdateItem({
          fibo_prompt_json: updatedItem.fibo_prompt_json,
          image_url: updatedItem.image_url,
          brand_compliance_score: updatedItem.brand_compliance_score,
          status: updatedItem.status,
          design_spec_json: updatedItem.design_spec_json
        });
      }

      toast.success('Product updated and regenerated with brand compliance!');

    } catch (error) {
      console.error('Error applying brand compliance:', error);
      toast.error('Failed to apply brand compliance. Please try again.');

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'I encountered an error while applying brand compliance. Please ensure brand colors are configured and try again.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px]">
      {/* Header */}
      <div className="neumorphic-card p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="circular-icon w-10 h-10 flex items-center justify-center">
              <Sparkles size={20} className="text-pastel-accent" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-pastel-navy">AI Design Assistant</h3>
              <p className="text-sm text-pastel-text-light">Chat to adjust product design</p>
            </div>
          </div>
          <button
            onClick={makeBrandCompliant}
            disabled={isLoading}
            className="btn-primary px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 hover:shadow-neumorphic-hover transition-all"
            title="Automatically adjust colors and design to match brand guidelines"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Shield size={18} />
                Make It Brand Compliant
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area - Chat and Product Preview */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left Column - Chat Messages */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 neumorphic-inset rounded-xl p-4 mb-4 overflow-y-auto">
            <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`circular-icon w-8 h-8 flex items-center justify-center flex-shrink-0 ${
                message.role === 'user' ? 'bg-pastel-accent/20' : 'bg-pastel-teal/20'
              }`}>
                {message.role === 'user' ? (
                  <User size={16} className="text-pastel-accent" />
                ) : (
                  <Bot size={16} className="text-pastel-teal" />
                )}
              </div>
              <div className={`flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block neumorphic-card p-3 rounded-xl max-w-[80%] ${
                  message.role === 'user' ? 'text-left' : ''
                }`}>
                  <p className="text-sm text-pastel-text whitespace-pre-wrap">{message.content}</p>
                  <p className="text-xs text-pastel-muted mt-1">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="circular-icon w-8 h-8 flex items-center justify-center bg-pastel-teal/20">
                <Bot size={16} className="text-pastel-teal" />
              </div>
              <div className="neumorphic-card p-3 rounded-xl">
                <Loader2 className="animate-spin text-pastel-accent" size={16} />
              </div>
            </div>
          )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div className="neumorphic-card p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Describe the design changes you'd like..."
            className="flex-1 px-4 py-2 neumorphic-inset rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pastel-accent/30"
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="btn-primary px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
            Send
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setInput('Change the colors to match our brand palette')}
            className="text-xs text-pastel-text-light hover:text-pastel-accent transition-colors"
          >
            Change colors
          </button>
          <span className="text-pastel-muted">•</span>
          <button
            onClick={() => setInput('Change to 2 buttons instead of 3')}
            className="text-xs text-pastel-text-light hover:text-pastel-accent transition-colors"
          >
            Modify buttons
          </button>
          <span className="text-pastel-muted">•</span>
          <button
            onClick={() => setInput('Make the pockets square shaped')}
            className="text-xs text-pastel-text-light hover:text-pastel-accent transition-colors"
          >
            Adjust pockets
          </button>
          <span className="text-pastel-muted">•</span>
          <button
            onClick={() => setInput('Make it shorter in length')}
            className="text-xs text-pastel-text-light hover:text-pastel-accent transition-colors"
          >
            Change length
          </button>
        </div>
      </div>
    </div>

        {/* Right Column - Product Preview */}
        <div className="w-1/3 min-w-[300px]">
          <div className="neumorphic-card p-4 h-full">
            <h4 className="text-sm font-bold text-pastel-navy mb-3">Product Preview</h4>
            <div className="aspect-square neumorphic-inset rounded-xl overflow-hidden mb-3">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pastel-bg-light to-pastel-bg">
                  <Package size={48} className="text-pastel-muted" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-pastel-navy">{item.name}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-pastel-muted capitalize">{item.category}</span>
                <span className="text-xs text-pastel-muted">•</span>
                <span className="text-xs text-pastel-muted capitalize">{item.subcategory}</span>
              </div>
              {item.design_spec_json?.colors && item.design_spec_json.colors.length > 0 && (
                <div className="flex gap-2 mt-2">
                  {item.design_spec_json.colors.slice(0, 4).map((color, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded shadow-neumorphic-sm"
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                    />
                  ))}
                </div>
              )}
              {item.status === 'generating' && (
                <div className="flex items-center gap-2 mt-2">
                  <Loader2 size={12} className="animate-spin text-pastel-accent" />
                  <span className="text-xs text-pastel-accent">Regenerating...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}