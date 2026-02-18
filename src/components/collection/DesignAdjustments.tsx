import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Shield, Package, Mic, MicOff, Wand2, Save } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { collectionItemStorage } from '../../services/db-storage';
import { toast } from 'sonner';
import { designCompanionChat, saveDesignAnalysis } from '../../lib/api-client';

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

  // Sync local image when a different product is loaded (item.id changes)
  useEffect(() => {
    setLocalImageUrl(item.image_url || '');
    setHasUnsavedChanges(false);
  }, [item.id]);
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

      // 2. Build the full update payload
      const updates: Partial<CollectionItem> = {
        image_url: currentImageUrl,
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

      // 3. Persist everything to DB and notify parent
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
      const imageDataUrl = `data:image/png;base64,${result.action.image_base64}`;
      // Update local state first — this is immune to parent DB-polling
      setLocalImageUrl(imageDataUrl);
      const updates: Partial<CollectionItem> = { image_url: imageDataUrl };
      if (result.action.compliance_score !== undefined) {
        updates.brand_compliance_score = result.action.compliance_score;
      }
      onUpdateItem(updates);
      setHasUnsavedChanges(true);
      toast.success('Design updated — click Save to keep it!');
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

      const result = await designCompanionChat({
        session_id: sessionId,
        user_message: userInput,
        product_context: buildProductContext(),
        image_base64: imageBase64,
        brand_id: brandId,
      });

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

      const result = await designCompanionChat({
        session_id: sessionId,
        user_message: 'Make this product fully brand-compliant. Adjust colors and design to match the brand guidelines.',
        product_context: buildProductContext(),
        image_base64: imageBase64,
        brand_id: brandId,
      });

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
            <h4 className="text-sm font-bold text-pastel-navy mb-3">Product Preview</h4>
            <div className="aspect-square neumorphic-inset rounded-xl overflow-hidden mb-3">
              {(localImageUrl || item.image_url) ? (
                <img
                  src={localImageUrl || item.image_url}
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
