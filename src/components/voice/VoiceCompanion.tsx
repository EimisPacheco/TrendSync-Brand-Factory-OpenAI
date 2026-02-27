import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Loader2, Wand2 } from 'lucide-react';
import { getVoiceCompanionWsUrl, saveDesignAnalysis } from '../../lib/api-client';
import { collectionItemStorage } from '../../services/db-storage';
import { toast } from 'sonner';
import type { View } from '../layout';
import type { CollectionItem } from '../../types/database';

type ToolAction = {
  action: string;
  status: string;
  message?: string;
  [key: string]: unknown;
};

/** Designer avatar icon for the floating voice button. */
function DesignerAvatar({ size = 38, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Head */}
      <circle cx="32" cy="20" r="12" fill={active ? '#fecaca' : '#fde8d8'} />
      {/* Hair — stylish bob */}
      <path d="M20 18c0-8 5-14 12-14s12 6 12 14c0 1-1 2-2 2h-1c0-6-4-10-9-10s-9 4-9 10h-1c-1 0-2-1-2-2z"
        fill={active ? '#991b1b' : '#4a3728'} />
      {/* Side hair strands */}
      <path d="M19 20c-1 3-1 6 0 9 0 .5.5.5.5 0 0-3 .5-6 1.5-8.5.2-.5-.1-.8-.5-.5z"
        fill={active ? '#991b1b' : '#4a3728'} opacity="0.7" />
      <path d="M45 20c1 3 1 6 0 9 0 .5-.5.5-.5 0 0-3-.5-6-1.5-8.5-.2-.5.1-.8.5-.5z"
        fill={active ? '#991b1b' : '#4a3728'} opacity="0.7" />
      {/* Face details */}
      <circle cx="28" cy="20" r="1.2" fill="#3d3d3d" />
      <circle cx="36" cy="20" r="1.2" fill="#3d3d3d" />
      <path d="M29 25c1.5 1.5 4.5 1.5 6 0" stroke="#e8967a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* Glasses — designer flair */}
      <rect x="24" y="17.5" width="7" height="5" rx="2.5" stroke={active ? '#fff' : '#d4a574'} strokeWidth="1" fill="none" />
      <rect x="33" y="17.5" width="7" height="5" rx="2.5" stroke={active ? '#fff' : '#d4a574'} strokeWidth="1" fill="none" />
      <line x1="31" y1="20" x2="33" y2="20" stroke={active ? '#fff' : '#d4a574'} strokeWidth="1" />
      {/* Body — stylish top */}
      <path d="M18 52c0-10 6-18 14-18s14 8 14 18" fill={active ? '#dc2626' : '#2c3e6b'} />
      {/* Collar / neckline */}
      <path d="M26 34c3 3 9 3 12 0" stroke={active ? '#fecaca' : '#fde8d8'} strokeWidth="1.5" fill="none" />
      {/* Pencil in hand */}
      <line x1="42" y1="38" x2="50" y2="28" stroke={active ? '#fbbf24' : '#e8b84b'} strokeWidth="2" strokeLinecap="round" />
      <polygon points="50,27 52,26 50.5,30" fill={active ? '#fbbf24' : '#e8b84b'} />
      {/* Measuring tape draped */}
      <path d="M15 42c4-2 7 1 10 0s5-3 8-1" stroke={active ? '#fca5a5' : '#f0a0c0'} strokeWidth="1.5" strokeLinecap="round" fill="none" strokeDasharray="2 2" />
    </svg>
  );
}

/** Deep-scan an ADK event payload for tool call results (deduplicated). */
function extractToolActions(payload: unknown): ToolAction[] {
  const actions: ToolAction[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.action === 'string' && typeof obj.status === 'string') {
      // Deduplicate by action+status+message fingerprint
      const key = `${obj.action}:${obj.status}:${String(obj.message || '').slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push(obj as unknown as ToolAction);
      }
      return; // Don't recurse into a found action (avoids duplicates at deeper nesting)
    }
    if (obj.name && obj.response) visit(obj.response);
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object') visit(obj[k]);
    }
  };
  visit(payload);
  return actions;
}

/** Convert an image URL (including data: URLs) to raw base64 string. */
async function imageUrlToBase64(url: string): Promise<string> {
  if (!url) return '';
  // Already a data URL — extract the base64 portion
  if (url.startsWith('data:')) {
    return url.split(',')[1] || '';
  }
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || '');
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
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

interface VoiceCompanionProps {
  /** Current page/view the user is on */
  currentView: string;
  /** Navigate to a different view */
  onNavigate: (view: View) => void;
  /** Current brand name (for context) */
  brandName?: string;
  /** Currently selected product item (if any) */
  productItem?: CollectionItem | null;
  /** Brand ID */
  brandId?: string;
  /** Callback when voice agent updates the product image */
  onUpdateItem?: (updates: Partial<CollectionItem>) => void;
}

export function VoiceCompanion({ currentView, onNavigate, brandName, productItem, brandId, onUpdateItem }: VoiceCompanionProps) {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  const [lastAction, setLastAction] = useState<ToolAction | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(false);

  // Keep stable refs so WebSocket handlers always see the latest values
  const onUpdateItemRef = useRef(onUpdateItem);
  useEffect(() => { onUpdateItemRef.current = onUpdateItem; }, [onUpdateItem]);
  const productItemRef = useRef(productItem);
  useEffect(() => { productItemRef.current = productItem; }, [productItem]);
  const brandIdRef = useRef(brandId);
  useEffect(() => { brandIdRef.current = brandId; }, [brandId]);

  // Map backend route strings to app View names
  const routeToView: Record<string, View> = {
    '/dashboard': 'dashboard',
    '/brand-style': 'brand-style',
    '/brand-guardian': 'brand-guardian',
    '/collection': 'collection',
    '/trends': 'trends',
    '/settings': 'settings',
  };

  // Global dedup for tool actions across WebSocket messages (TTL-based)
  const seenActionsRef = useRef<Map<string, number>>(new Map());

  const handleToolAction = useCallback(
    (action: ToolAction) => {
      // Dedup: skip if we've seen the same action in the last 15 seconds
      const key = `${action.action}:${action.status}:${String(action.message || '').slice(0, 60)}`;
      const now = Date.now();
      const lastSeen = seenActionsRef.current.get(key);
      if (lastSeen && now - lastSeen < 15000) return;
      seenActionsRef.current.set(key, now);

      console.log('[VoiceCompanion] Tool action:', action);
      setLastAction(action);

      switch (action.action) {
        case 'navigate':
          if (action.route && typeof action.route === 'string') {
            const view = routeToView[action.route];
            if (view) onNavigate(view);
          }
          break;
        case 'start_collection':
          if (action.status === 'started') onNavigate('collection');
          break;
        case 'trend_data':
          if (action.status === 'success') onNavigate('trends');
          break;
        case 'validation':
          if (action.status === 'success') onNavigate('brand-guardian');
          break;
        case 'save_design': {
          // Persist the current (edited) image + updated specs to DB — same as typing version
          const item = productItemRef.current;
          const currentBrandId = brandIdRef.current;
          if (!item) break;
          (async () => {
            try {
              const currentImageUrl = item.image_url || '';
              const imageBase64 = await getImageBase64(currentImageUrl);

              const analysis = await saveDesignAnalysis({
                image_base64: imageBase64,
                product_context: {
                  name: item.name,
                  category: item.category,
                  subcategory: item.subcategory,
                  colors: item.design_spec_json?.colors,
                  materials: item.design_spec_json?.materials,
                  inspiration: item.design_spec_json?.inspiration,
                },
                brand_id: currentBrandId || '',
              });

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

              await collectionItemStorage.update(item.id, updates);
              const cb = onUpdateItemRef.current;
              if (cb) cb(updates);
              toast.success('Design saved — all tabs updated!');
              console.log('[VoiceCompanion] Design saved to DB for item', item.id);
            } catch (err) {
              console.error('[VoiceCompanion] Failed to save design:', err);
              toast.error('Failed to save design. Please try again.');
            }
          })();
          break;
        }
      }
    },
    [onNavigate],
  );

  const nextPlayTimeRef = useRef(0);

  /** Play raw PCM16 audio (binary ArrayBuffer from WebSocket). */
  const playAudioChunk = useCallback((pcmData: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') void ctx.resume();

    // Convert Int16 PCM to Float32 for Web Audio API
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Schedule chunks back-to-back with no gaps
    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }, []);

  const stopSession = useCallback(async () => {
    console.log('[VoiceCompanion] 🛑 Stopping session...');
    isActiveRef.current = false;
    setIsActive(false);
    setIsConnecting(false);
    setIsProcessing(false);
    setStatusMessage('');

    if (workletNodeRef.current) {
      try { workletNodeRef.current.disconnect(); } catch { /* empty */ }
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); } catch { /* empty */ }
      audioContextRef.current = null;
    }
    if (playbackCtxRef.current) {
      try { await playbackCtxRef.current.close(); } catch { /* empty */ }
      playbackCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      } catch { /* empty */ }
      wsRef.current = null;
    }
    setTranscription('');
    setAgentResponse('');
  }, []);

  useEffect(() => {
    return () => { void stopSession(); };
  }, [stopSession]);

  const startSession = async () => {
    setIsConnecting(true);
    setTranscription('');
    setAgentResponse('');
    setLastAction(null);
    setShowPanel(true);

    try {
      const sessionId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const wsUrl = getVoiceCompanionWsUrl(sessionId);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      // Pre-create playback AudioContext during user gesture (Chrome requires this)
      if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
        playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
        console.log('[VoiceCompanion] Playback AudioContext created, state:', playbackCtxRef.current.state);
      }

      ws.onmessage = (ev) => {
        // Binary frame = raw PCM audio from the agent
        if (ev.data instanceof ArrayBuffer) {
          console.log('[VoiceCompanion] 🔊 Audio chunk received:', ev.data.byteLength, 'bytes');
          playAudioChunk(ev.data);
          return;
        }

        try {
          const raw = String(ev.data ?? '{}');
          const payload = JSON.parse(raw);
          console.log('[VoiceCompanion] 📨 WS message:', payload.type || 'event', payload);

          // Input transcription (what the user said)
          if (payload.inputTranscription?.text) {
            const text = String(payload.inputTranscription.text).trim();
            if (text) {
              console.log('[VoiceCompanion] 🎤 USER:', text);
              setTranscription((prev) => (prev ? prev + ' ' + text : text));
              setStatusMessage('Processing your request...');
              setIsProcessing(true);
            }
          }

          // Output transcription (what the agent said)
          if (payload.outputTranscription?.text) {
            const text = String(payload.outputTranscription.text).trim();
            if (text) {
              console.log('[VoiceCompanion] 🤖 AGENT:', text);
              setAgentResponse((prev) => (prev ? prev + ' ' + text : text));
              setIsProcessing(false);
              setStatusMessage('');
            }
          }

          // Tool calls — show status based on tool name
          if (payload.toolCall || payload.tool_call) {
            const toolName = payload.toolCall?.name || payload.tool_call?.name || 'unknown';
            console.log('[VoiceCompanion] 🔧 Tool call detected:', toolName);
            const toolStatusMap: Record<string, string> = {
              edit_product_image: 'Editing product image...',
              get_trend_data: 'Fetching latest trends...',
              validate_brand_compliance: 'Checking brand compliance...',
              generate_ad_video: 'Generating ad video...',
              save_design: 'Saving design...',
              navigate_to_page: 'Navigating...',
              start_collection: 'Starting collection...',
              make_brand_compliant: 'Adjusting for brand compliance...',
              get_design_advice: 'Getting design advice...',
            };
            setStatusMessage(toolStatusMap[toolName] || `Running ${toolName}...`);
            setIsProcessing(true);
          }

          // Tool results — clear processing
          if (payload.toolResponse || payload.tool_response) {
            const toolName = payload.toolResponse?.name || payload.tool_response?.name || 'unknown';
            console.log('[VoiceCompanion] ✅ Tool response received:', toolName);
            setIsProcessing(false);
            setStatusMessage('');
          }

          const actions = extractToolActions(payload);
          for (const action of actions) {
            console.log('[VoiceCompanion] 🎬 Action extracted:', action.action, action.status);
            // Show processing status for specific actions
            if (action.status !== 'success' && action.status !== 'error') {
              const actionStatusMap: Record<string, string> = {
                edit_product_image: 'Editing product image...',
                trend_data: 'Fetching trends...',
                validation: 'Running validation...',
                generate_ad_video: 'Creating ad video...',
                save_design: 'Saving design...',
                start_collection: 'Building collection...',
                brand_compliant: 'Checking compliance...',
                design_advice: 'Getting advice...',
              };
              if (actionStatusMap[action.action]) {
                setStatusMessage(actionStatusMap[action.action]);
                setIsProcessing(true);
              }
            } else {
              setIsProcessing(false);
              setStatusMessage('');
            }
            handleToolAction(action);
          }

          // Handle tool_status messages from backend (tool execution progress)
          if (payload.type === 'tool_status') {
            const toolDisplayNames: Record<string, string> = {
              edit_product_image: 'Editing image',
              analyze_product_image: 'Analyzing image',
              make_brand_compliant: 'Adjusting compliance',
              fetch_trend_data: 'Fetching trends',
              generate_image_variation: 'Generating variation',
              validate_brand_compliance: 'Validating design',
            };
            const displayName = toolDisplayNames[payload.tool] || payload.tool;
            if (payload.status === 'started') {
              console.log(`[VoiceCompanion] 🔧 Tool STARTED: ${payload.tool} — ${payload.message}`);
              setStatusMessage(payload.message || `${displayName}...`);
              setIsProcessing(true);
            } else if (payload.status === 'completed') {
              console.log(`[VoiceCompanion] ✅ Tool COMPLETED: ${payload.tool} — ${payload.message}`);
              setStatusMessage(payload.message || `${displayName} done`);
              setIsProcessing(false);
              setTimeout(() => setStatusMessage(''), 3000);
            }
          }

          // Handle image updates from voice agent tools (_pending_images delivery)
          if (payload.type === 'image_updated' && payload.image_base64) {
            console.log('[VoiceCompanion] 🖼️ Image update received, base64 length:', payload.image_base64.length);
            setStatusMessage('Applying image update...');
            const cb = onUpdateItemRef.current;
            if (cb) {
              const imageDataUrl = `data:image/png;base64,${payload.image_base64}`;
              cb({ image_url: imageDataUrl });
              console.log('[VoiceCompanion] ✅ Product image updated from voice agent');
              setStatusMessage('Image updated!');
              setTimeout(() => setStatusMessage(''), 3000);
            } else {
              console.warn('[VoiceCompanion] ⚠️ image_updated received but onUpdateItem is not set');
            }
            setIsProcessing(false);
          }

          // Session start ack
          if (payload.type === 'ack') {
            console.log('[VoiceCompanion] ✅ Session acknowledged:', payload.event);
            setStatusMessage('Connected — speak naturally');
            setTimeout(() => setStatusMessage(''), 3000);
          }

          if (payload.type === 'error') {
            console.error('[VoiceCompanion] ❌ Agent error:', payload.message);
            setAgentResponse(payload.message || 'Voice agent encountered an error.');
            setStatusMessage('Error occurred');
            setIsProcessing(false);
            setTimeout(() => setStatusMessage(''), 5000);
          }
        } catch (e) {
          console.error('[VoiceCompanion] ❌ Error processing WS message:', e);
          setIsProcessing(false);
        }
      };

      ws.onclose = (ev) => {
        console.log('[VoiceCompanion] 🔌 WebSocket closed, code:', ev.code, 'reason:', ev.reason);
        isActiveRef.current = false;
        setIsActive(false);
        setIsConnecting(false);
        setIsProcessing(false);
        setStatusMessage('Disconnected');
      };

      ws.onerror = (ev) => {
        console.error('[VoiceCompanion] ❌ WebSocket error:', ev);
        setIsConnecting(false);
        setIsProcessing(false);
        setStatusMessage('Connection error');
        setAgentResponse('Could not connect to voice companion. Make sure the backend is running on port 8002.');
      };

      console.log('[VoiceCompanion] 🔗 Connecting to WebSocket:', wsUrl);
      setStatusMessage('Connecting to voice service...');

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log('[VoiceCompanion] ✅ WebSocket connected');
          setStatusMessage('Connected — preparing session...');
          resolve();
        };
        ws.onerror = () => reject(new Error('Voice WS failed'));
      });

      // Convert product image to base64 for the voice agent
      let productImageBase64 = '';
      if (productItem?.image_url) {
        console.log('[VoiceCompanion] 🖼️ Converting product image to base64...');
        setStatusMessage('Sending product image...');
        productImageBase64 = await imageUrlToBase64(productItem.image_url);
        console.log('[VoiceCompanion] 🖼️ Image base64 ready, length:', productImageBase64.length);
      }

      // Send start message with full product context
      console.log('[VoiceCompanion] 📤 Sending start message with product context');
      setStatusMessage('Starting voice session...');
      ws.send(
        JSON.stringify({
          type: 'start',
          brandName: brandName || 'My Brand',
          brandId: brandId || '',
          currentPage: currentView,
          productName: productItem?.name || null,
          productDescription: productItem?.design_story || null,
          productCategory: productItem?.category || null,
          productSubcategory: productItem?.subcategory || null,
          productColors: productItem?.design_spec_json?.colors?.map((c: { name: string; hex: string }) => c.name) || [],
          productMaterials: productItem?.design_spec_json?.materials || [],
          productImageBase64,
          collectionName: null,
        }),
      );

      // Wait for ack
      console.log('[VoiceCompanion] ⏳ Waiting for session ack...');
      setStatusMessage('Waiting for agent to start...');
      await new Promise<void>((resolve) => {
        const handler = (ev: MessageEvent) => {
          try {
            const p = JSON.parse(String(ev.data));
            if (p.type === 'ack' && p.event === 'start') {
              console.log('[VoiceCompanion] ✅ Session ack received');
              ws.removeEventListener('message', handler);
              resolve();
            }
          } catch { /* empty */ }
        };
        ws.addEventListener('message', handler);
        setTimeout(() => {
          console.log('[VoiceCompanion] ⏳ Ack timeout (3s) — proceeding anyway');
          ws.removeEventListener('message', handler);
          resolve();
        }, 3000);
      });

      // Start mic capture at 16kHz (required by Gemini Live) using AudioWorkletNode
      console.log('[VoiceCompanion] 🎤 Requesting microphone access...');
      setStatusMessage('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ac = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ac;

      // Register the PCM capture worklet processor inline (no separate file needed)
      const workletCode = `
        class PcmCaptureProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0]?.[0];
            if (input) {
              const pcm16 = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) {
                const s = Math.max(-1, Math.min(1, input[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await ac.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = ac.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ac, 'pcm-capture-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        if (!isActiveRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
          return;
        wsRef.current.send(e.data as ArrayBuffer);
      };

      source.connect(workletNode);
      console.log('[VoiceCompanion] 🎤 Microphone capture active (16kHz PCM)');

      isActiveRef.current = true;
      setIsActive(true);
      setIsConnecting(false);
      setStatusMessage('Listening — speak naturally');
      console.log('[VoiceCompanion] ✅ Voice session fully ready');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('[VoiceCompanion] ❌ Start failed:', err);
      setIsConnecting(false);
      setIsProcessing(false);
      setStatusMessage('Failed to start');
      setAgentResponse('Failed to start voice companion. Please check microphone permissions.');
    }
  };

  const getActionColor = (action: ToolAction | null) => {
    if (!action) return '';
    switch (action.action) {
      case 'navigate': return 'bg-blue-100 text-blue-700';
      case 'trend_data': return 'bg-purple-100 text-purple-700';
      case 'validation':
        return action.status === 'success' && (action.compliance_score as number) >= 75
          ? 'bg-green-100 text-green-700'
          : 'bg-amber-100 text-amber-700';
      case 'image_updated': return 'bg-teal-100 text-teal-700';
      case 'generate_ad_video': return 'bg-pink-100 text-pink-700';
      case 'start_collection': return 'bg-indigo-100 text-indigo-700';
      case 'brand_compliant': return 'bg-orange-100 text-orange-700';
      case 'design_advice': return 'bg-cyan-100 text-cyan-700';
      case 'save_design': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <>
      {/* Floating voice button */}
      <button
        onClick={() => {
          if (isActive) {
            void stopSession();
            setShowPanel(false);
          } else {
            void startSession();
          }
        }}
        disabled={isConnecting}
        className={`fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center ${
          isActive
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : isConnecting
            ? 'bg-gray-400 cursor-wait'
            : 'bg-gradient-to-br from-pastel-navy to-pastel-teal hover:scale-110'
        }`}
        title={isActive ? 'Stop voice companion' : 'Start voice companion'}
      >
        {isConnecting ? (
          <Loader2 size={24} className="text-white animate-spin" />
        ) : (
          <DesignerAvatar size={40} active={isActive} />
        )}
      </button>

      {/* Voice companion panel */}
      {showPanel && (
        <div className="fixed bottom-28 right-8 z-50 w-96 neumorphic-card overflow-hidden shadow-2xl rounded-2xl">
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg, #2c3e6b, #3a7c8c)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Wand2 size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold">Voice Design Companion</p>
                <p className="text-white/60 text-xs">
                  {isProcessing
                    ? (statusMessage || 'Working...')
                    : statusMessage
                    ? statusMessage
                    : isActive ? 'Listening...' : isConnecting ? 'Connecting...' : 'Ready'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (isActive) void stopSession();
                setShowPanel(false);
              }}
              className="text-white/60 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 max-h-80 overflow-y-auto space-y-3">
            {/* Active indicator */}
            {isActive && (
              <div className="flex items-center gap-2 text-xs text-pastel-muted">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span>Microphone active — speak naturally</span>
              </div>
            )}

            {/* User transcription */}
            {transcription && (
              <div className="neumorphic-inset p-3 rounded-xl">
                <p className="text-xs font-semibold mb-1 text-pastel-navy">You said:</p>
                <p className="text-sm text-pastel-text-light">{transcription}</p>
              </div>
            )}

            {/* Agent response */}
            {agentResponse && (
              <div className="neumorphic-inset p-3 rounded-xl border-l-[3px] border-pastel-accent">
                <p className="text-xs font-semibold mb-1 text-pastel-accent">Companion:</p>
                <p className="text-sm text-pastel-text">{agentResponse}</p>
              </div>
            )}

            {/* Last tool action */}
            {lastAction && (
              <div className="neumorphic-inset p-3 rounded-xl space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getActionColor(lastAction)}`}>
                    {lastAction.action.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      lastAction.status === 'success' || lastAction.status === 'started'
                        ? 'bg-green-100 text-green-700'
                        : lastAction.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {lastAction.status}
                  </span>
                </div>
                {lastAction.message && (
                  <p className="text-xs text-pastel-text-light">{lastAction.message as string}</p>
                )}
                {lastAction.action === 'trend_data' && Boolean(lastAction.trending_colors) && (
                  <p className="text-xs text-pastel-muted">
                    Colors: {String(lastAction.trending_colors)}
                  </p>
                )}
                {lastAction.action === 'validation' && lastAction.compliance_score !== undefined && (
                  <p className="text-xs font-semibold text-pastel-navy">
                    Score: {String(lastAction.compliance_score)}% — {String(lastAction.badge)}
                  </p>
                )}
              </div>
            )}

            {/* Idle hints */}
            {!transcription && !agentResponse && !isActive && !isConnecting && (
              <div className="text-center py-4">
                <p className="text-sm font-semibold mb-2 text-pastel-navy">Try saying:</p>
                <div className="space-y-1">
                  {[
                    '"What colors are trending in EU?"',
                    '"Generate a summer collection"',
                    '"Check brand compliance"',
                    '"Create an ad video for this product"',
                    '"Go to the brand editor"',
                    '"Show me this dress in silk"',
                  ].map((hint) => (
                    <p key={hint} className="text-xs italic text-pastel-muted">{hint}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Processing status bar — always visible above footer */}
          {(statusMessage || isProcessing) && (
            <div className="px-4 py-2 border-t border-pastel-accent/20 bg-gradient-to-r from-pastel-accent/10 to-pastel-teal/10 flex items-center gap-2">
              {isProcessing && <Loader2 size={14} className="text-pastel-accent animate-spin flex-shrink-0" />}
              <span className="text-xs font-medium text-pastel-accent">{statusMessage || 'Working...'}</span>
            </div>
          )}

          {/* Footer tool badges */}
          <div className="px-4 py-2 border-t border-pastel-muted/20 flex flex-wrap gap-1">
            {['trends', 'validate', 'generate', 'video', 'navigate', 'collection', 'edit'].map(
              (tool) => (
                <span
                  key={tool}
                  className="text-[10px] px-2 py-0.5 rounded-full neumorphic-inset text-pastel-muted"
                >
                  {tool}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
