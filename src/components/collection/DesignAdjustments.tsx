import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Shield, Package, Mic, MicOff, Wand2, Save } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { collectionItemStorage } from '../../services/db-storage';
import { toast } from 'sonner';
import { designCompanionChat, saveDesignAnalysis } from '../../lib/api-client';
import { uploadProductImage, isSupabaseStorageUrl } from '../../lib/image-storage';

/** Retry design companion calls up to `maxRetries` times on RESOURCE_EXHAUSTED (429).
 *  Handles both HTTP-level errors AND 200 responses with error in the body. */
async function withRetry(
  fn: () => Promise<Awaited<ReturnType<typeof designCompanionChat>>>,
  maxRetries = 3,
  delayMs = 3000,
): Promise<Awaited<ReturnType<typeof designCompanionChat>>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // Check for rate-limit error embedded in the response body (backend returns 200)
      const msg = result.action?.message || result.response || '';
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && attempt < maxRetries) {
        const wait = delayMs * attempt;
        console.warn(`[DesignAdjustments] Rate limited (response body), retrying in ${wait}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return result;
    } catch (err) {
      // HTTP-level errors (non-200 status)
      const errMsg = err instanceof Error ? err.message : String(err);
      const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && attempt < maxRetries) {
        const wait = delayMs * attempt;
        console.warn(`[DesignAdjustments] Rate limited (HTTP), retrying in ${wait}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface DesignAdjustmentsProps {
  item: CollectionItem;
  brandId: string;
  onUpdateItem: (updates: Partial<CollectionItem>) => void;
}

/** Convert an image URL (or data URI) to raw base64 string. */
async function getImageBase64(imageUrl: string | null | undefined): Promise<string> {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('data:')) {
    return imageUrl.split(',')[1] || '';
  }
  try {
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const reader = new FileReader();
    return await new Promise<string>((resolve) => {
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export function DesignAdjustments({ item, brandId, onUpdateItem }: DesignAdjustmentsProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi, I'm Lux — your personal design stylist! I'm here to help you refine "${item.name}" until it's absolutely perfect. Want to tweak the colors, swap materials, adjust proportions, or try something completely new? Just say the word and I'll make it happen. What are we working on first?`,
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  // Local image URL — survives parent DB-polling so edits don't revert
  const [localImageUrl, setLocalImageUrl] = useState<string>(item.image_url || '');
  // Guard: when the typing agent sets localImageUrl, skip the voice-sync effect
  const typingAgentUpdating = useRef(false);
  // Debug: track image edit history for before/after comparison
  const [imageVersion, setImageVersion] = useState(0);
  const [previousImageUrl, setPreviousImageUrl] = useState<string>('');
  const [showBefore, setShowBefore] = useState(false);
  const [imageJustUpdated, setImageJustUpdated] = useState(false);

  // Sync local image when a different product is loaded
  useEffect(() => {
    setLocalImageUrl(item.image_url || '');
    setHasUnsavedChanges(false);
  }, [item.id]);

  // Sync when voice agent updates image externally (data: URLs only).
  // Skip if the typing agent just set localImageUrl (guard prevents overwrite).
  useEffect(() => {
    if (typingAgentUpdating.current) {
      typingAgentUpdating.current = false;
      return;
    }
    if (item.image_url?.startsWith('data:') && item.image_url !== localImageUrl) {
      setLocalImageUrl(item.image_url);
      setHasUnsavedChanges(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.image_url]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Voice recognition setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast.error('Voice input is not supported in this browser');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const buildProductContext = () => ({
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    colors: item.design_spec_json?.colors,
    materials: item.design_spec_json?.materials,
    inspiration: item.design_spec_json?.inspiration,
  });

  const saveCurrentDesign = async () => {
    setIsSaving(true);
    try {
      // Use local (potentially edited) image, not the stale prop
      const currentImageUrl = localImageUrl || item.image_url;
      const imageBase64 = await getImageBase64(currentImageUrl);

      // 1. Analyze the current image to get updated specs for ALL tabs
      const analysis = await saveDesignAnalysis({
        image_base64: imageBase64,
        product_context: buildProductContext(),
        brand_id: brandId,
      });

      // 2. Upload image to Supabase Storage if needed
      let persistedImageUrl = currentImageUrl;
      if (currentImageUrl && !isSupabaseStorageUrl(currentImageUrl)) {
        const storagePath = `designs/${item.collection_id}/${item.id}-v${Date.now()}`;
        const publicUrl = await uploadProductImage(currentImageUrl, storagePath);
        if (publicUrl) {
          persistedImageUrl = publicUrl;
        }
        // Falls back to data URL if upload fails
      }

      // 3. Build the full update payload
      const updates: Partial<CollectionItem> = {
        image_url: persistedImageUrl,
        updated_at: new Date().toISOString(),
      };

      if (analysis.success && analysis.design_spec_json && Object.keys(analysis.design_spec_json).length > 0) {
        updates.design_spec_json = analysis.design_spec_json as CollectionItem['design_spec_json'];
      }
      if (analysis.success && analysis.fibo_prompt_json && Object.keys(analysis.fibo_prompt_json).length > 0) {
        updates.fibo_prompt_json = analysis.fibo_prompt_json as CollectionItem['fibo_prompt_json'];
      }
      if (analysis.brand_compliance_score) {
        updates.brand_compliance_score = analysis.brand_compliance_score;
      }

      // 4. Persist everything to DB and notify parent
      await collectionItemStorage.update(item.id, updates);
      onUpdateItem(updates);
      setHasUnsavedChanges(false);
      // After save, the DB now has the same image — local state stays in sync
      toast.success('Design saved — all tabs updated!');
    } catch (error) {
      console.error('Error saving design:', error);
      toast.error('Failed to save design. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAgentResponse = async (result: Awaited<ReturnType<typeof designCompanionChat>>) => {
    // Show agent's text response
    if (result.response) {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    }

    // If agent edited/generated an image, update the preview (don't auto-save)
    if (result.action?.image_base64) {
      const b64 = result.action.image_base64;
      console.log(`[DesignAdjustments] Image received: ${b64.length} chars, first 40: ${b64.slice(0, 40)}`);
      const imageDataUrl = `data:image/png;base64,${b64}`;
      const prevUrl = localImageUrl;
      console.log(`[DesignAdjustments] Previous URL type: ${prevUrl.startsWith('data:') ? 'data URL' : 'HTTP URL'}, length: ${prevUrl.length}`);
      // Store previous image for before/after comparison
      if (prevUrl) {
        setPreviousImageUrl(prevUrl);
      }
      // Update local state first — guard prevents voice-sync effect from overwriting
      typingAgentUpdating.current = true;
      setLocalImageUrl(imageDataUrl);
      setImageVersion(v => v + 1);
      // Flash the "updated" indicator
      setImageJustUpdated(true);
      setTimeout(() => setImageJustUpdated(false), 3000);
      console.log(`[DesignAdjustments] localImageUrl updated. Same as before: ${imageDataUrl === prevUrl}, version: ${imageVersion + 1}`);
      const updates: Partial<CollectionItem> = { image_url: imageDataUrl };
      if (result.action.compliance_score !== undefined) {
        updates.brand_compliance_score = result.action.compliance_score;
      }
      onUpdateItem(updates);
      setHasUnsavedChanges(true);
      toast.success('Design updated — click Save to keep it!');
    } else {
      console.log(`[DesignAdjustments] No image in response. action:`, result.action);
    }

    // If agent called save_design, persist to database
    if (result.action?.action === 'save_design') {
      await saveCurrentDesign();
    }
  };

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
      // Use local (potentially edited) image so the agent sees the latest version
      const imageBase64 = await getImageBase64(localImageUrl || item.image_url);

      const result = await withRetry(() => designCompanionChat({
        session_id: sessionId,
        user_message: userInput,
        product_context: buildProductContext(),
        image_base64: imageBase64,
        brand_id: brandId,
      }));

      await handleAgentResponse(result);

    } catch (error) {
      console.error('Error processing message:', error);
      toast.error('Failed to process your request. Please try again.');

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Oh no, I hit a little snag! Let me catch my breath — try that again in a moment, or rephrase and I\'ll figure it out.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const makeBrandCompliant = async () => {
    setIsLoading(true);

    try {
      // Use local (potentially edited) image so the agent sees the latest version
      const imageBase64 = await getImageBase64(localImageUrl || item.image_url);

      if (!imageBase64) {
        toast.error('No product image available to adjust.');
        return;
      }

      // Add a system message about the compliance action
      const actionMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: 'Make this product fully brand-compliant. Adjust colors and design to match the brand guidelines.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, actionMessage]);

      const result = await withRetry(() => designCompanionChat({
        session_id: sessionId,
        user_message: 'Make this product fully brand-compliant. Adjust colors and design to match the brand guidelines.',
        product_context: buildProductContext(),
        image_base64: imageBase64,
        brand_id: brandId,
      }));

      await handleAgentResponse(result);

    } catch (error) {
      console.error('Error applying brand compliance:', error);
      toast.error('Failed to apply brand compliance. Please try again.');

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'I ran into a hiccup with brand compliance — double-check that your brand colors are set up in the Brand Editor, and then let\'s give it another shot!',
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
            <div className="circular-icon w-10 h-10 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #5B9BD5 0%, #6BB5B5 100%)' }}>
              <Wand2 size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-pastel-navy">Lux <span className="text-sm font-normal text-pastel-text-light">- Design Stylist</span></h3>
              <p className="text-sm text-pastel-text-light">Your personal AI fashion advisor — type or speak</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <button
                onClick={saveCurrentDesign}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 hover:shadow-neumorphic-hover transition-all bg-green-500 text-white font-medium"
                title="Save the current design to your collection"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Save Design
                  </>
                )}
              </button>
            )}
            <button
              onClick={makeBrandCompliant}
              disabled={isLoading}
              className="btn-primary px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 hover:shadow-neumorphic-hover transition-all"
              title="Automatically adjust colors and design to match brand guidelines"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Working...
                </>
              ) : (
                <>
                  <Shield size={18} />
                  Brand Comply
                </>
              )}
            </button>
          </div>
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

          {/* Quick Actions */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {[
              { label: 'Switch to brand colors', value: 'Switch the colors to our brand palette' },
              { label: 'Make it longer', value: 'Make the length longer' },
              { label: 'Change material', value: 'Suggest a different material that feels more premium' },
              { label: 'Simplify details', value: 'Simplify the design details, make it more minimal' },
            ].map((chip) => (
              <button
                key={chip.label}
                onClick={() => { setInput(chip.value); }}
                className="px-3 py-1.5 text-xs rounded-full neumorphic-card hover:shadow-neumorphic-hover transition-all text-pastel-navy font-medium"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <div className="neumorphic-card p-3">
        <div className="flex gap-2">
          <button
            onClick={toggleListening}
            className={`px-3 py-2 rounded-lg flex items-center justify-center transition-all ${
              isListening
                ? 'bg-red-100 text-red-500 shadow-neumorphic-inset animate-pulse'
                : 'neumorphic-card hover:shadow-neumorphic-hover text-pastel-navy'
            }`}
            title={isListening ? 'Stop listening' : 'Voice input'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={isListening ? 'Listening...' : 'Tell me what to change...'}
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
          </button>
        </div>
      </div>
    </div>

        {/* Right Column - Product Preview */}
        <div className="w-1/3 min-w-[300px]">
          <div className="neumorphic-card p-4 h-full">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-pastel-navy">Product Preview</h4>
              {imageVersion > 0 && (
                <div className="flex items-center gap-2">
                  {previousImageUrl && (
                    <button
                      onClick={() => setShowBefore(!showBefore)}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
                        showBefore
                          ? 'bg-amber-100 text-amber-700 font-bold'
                          : 'bg-pastel-bg-light text-pastel-muted hover:bg-pastel-bg-dark/10'
                      }`}
                    >
                      {showBefore ? 'BEFORE' : 'Compare'}
                    </button>
                  )}
                  <span className="text-[10px] font-mono text-pastel-teal bg-pastel-teal/10 px-1.5 py-0.5 rounded">
                    v{imageVersion}
                  </span>
                </div>
              )}
            </div>
            <div className={`aspect-square neumorphic-inset rounded-xl overflow-hidden mb-3 relative transition-all duration-300 ${
              imageJustUpdated ? 'ring-2 ring-green-400 ring-offset-2' : ''
            }`}>
              {imageJustUpdated && (
                <div className="absolute top-2 left-2 z-10 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full animate-pulse">
                  Updated!
                </div>
              )}
              {(localImageUrl || item.image_url) ? (
                <img
                  key={showBefore ? 'before' : `v${imageVersion}`}
                  src={showBefore ? previousImageUrl : (localImageUrl || item.image_url)}
                  alt={showBefore ? `${item.name} (before)` : item.name}
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
                <div className="space-y-1.5 mt-2">
                  {item.design_spec_json.colors.slice(0, 4).map((color, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(`Change the color from ${color.name} (${color.hex}) to `)}
                      className="flex items-center gap-2 w-full px-2 py-1 rounded-lg hover:bg-pastel-bg-dark/10 transition-colors cursor-pointer group"
                      title={`Click to use "${color.name}" in chat`}
                    >
                      <div
                        className="w-5 h-5 rounded shadow-neumorphic-sm flex-shrink-0 group-hover:scale-110 transition-transform"
                        style={{ backgroundColor: color.hex }}
                      />
                      <span className="text-xs font-medium text-pastel-navy truncate">{color.name}</span>
                      <span className="text-[10px] text-pastel-muted font-mono ml-auto">{color.hex}</span>
                    </button>
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
