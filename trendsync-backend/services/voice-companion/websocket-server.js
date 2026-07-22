/**
 * WebSocket bridge: TrendSync frontend  <->  OpenAI Realtime API.
 *
 * Frontend protocol (preserved from the previous Python/ADK service so the
 * existing React VoiceCompanion needs no protocol changes):
 *   • Text frames (JSON):
 *       {type:"start", productName, productImageBase64, brandId, …}
 *       {type:"update_context", productImageBase64, productName, brandId, …}
 *       {type:"stop"}
 *   • Binary frames: raw 24kHz mono PCM16 audio chunks from the mic.
 *
 * Outbound to the frontend:
 *   • Binary frames: raw 24kHz PCM16 audio from the assistant (played directly).
 *   • JSON text frames mirroring the ADK shape the React client already parses:
 *       {type:"ack", event:"start"}
 *       {inputTranscription:{text:"…"}}
 *       {outputTranscription:{text:"…"}}
 *       {type:"image_updated", image_base64:"…", edit_instruction?:"…"}
 *       {content:{parts:[{functionResponse:{name, response:{action,status,…}}}]}}
 *       {type:"error", message}
 *
 * Upstream: a per-session WebSocket to the OpenAI Realtime API. Audio frames
 * from the client are forwarded as `input_audio_buffer.append` events; the
 * server responds with `response.output_audio.delta` chunks that we relay as raw PCM
 * binary back to the browser.
 */

const WebSocket = require('ws');
const { tools, toolsToOpenAIRealtimeFormat } = require('./tools');

const OPENAI_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-realtime-2.1';
const FALLBACK_MODEL = 'gpt-realtime-2';
const REALTIME_BASE = 'wss://api.openai.com/v1/realtime?model=';
const VOICE = process.env.OPENAI_VOICE || 'alloy';
const MAIN_BACKEND_URL = (process.env.MAIN_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

const TOOLS_BY_NAME = Object.fromEntries(tools.map((t) => [t.name, t]));
const REALTIME_TOOLS = toolsToOpenAIRealtimeFormat();

function buildInstruction(ctx) {
  const lines = [
    "You are 'Lux', the Voice Design Companion for TrendSync Brand Factory — an AI-powered fashion design studio.",
    '',
    '=== LANGUAGE — STRICT ===',
    'You ALWAYS respond in ENGLISH ONLY. Never switch to another language mid-conversation, ',
    'even if you THINK the user spoke another language, even if a tool returns non-English content, ',
    'and even if your initial impulse is to greet in another language. ',
    'Every spoken response and every audio sample you produce must be in English. ',
    'If the user explicitly says "speak Spanish" or names another language, switch only then.',
    '',
    'You are a REAL assistant that EXECUTES actions through tools. When you call a tool, it runs immediately.',
    'Every tool you have connects to a live backend service and produces real results.',
    '',
    '=== YOUR TOOLS (ALL execute real actions) ===',
    '1. analyze_product_image(question) — get product context so you can comment on the visible image.',
    '2. edit_product_image(edit_instruction) — modifies the current product image.',
    '3. make_brand_compliant() — auto-adjusts the product to brand colors.',
    '4. fetch_trend_data(query, season, region, demographic) — real-time fashion trends.',
    '5. validate_brand_compliance(product_description, color_scheme) — compliance score.',
    '6. generate_image_variation(variation_description, category) — brand-new image.',
    '7. save_design() — signals the frontend to persist the current design.',
    '8. generate_ad_video(campaign_brief, ad_style) — Fal-powered ad video.',
    '9. navigate_to_page(page_name) — navigates the app.',
    '10. start_collection_generation(season, region, demographic, product_count) — full collection.',
    '',
    '=== CURRENT CONTEXT ===',
  ];
  if (ctx.product_name) lines.push(`Currently viewing product: ${ctx.product_name}`);
  if (ctx.product_description) lines.push(`Product description: ${ctx.product_description}`);
  if (ctx.collection_name) lines.push(`Current collection: ${ctx.collection_name}`);
  if (ctx.brand_name) lines.push(`Brand: ${ctx.brand_name}`);
  if (ctx.current_page) lines.push(`User is on page: ${ctx.current_page}`);
  lines.push(
    '',
    '=== BEHAVIOR RULES ===',
    '0. For design opinions, call analyze_product_image to ground yourself in the product first.',
    '1. ALWAYS call a tool when the user asks for an action — do not just describe what you would do.',
    '2. After a tool returns, summarize the result in a natural, conversational voice response.',
    '3. Read out trend highlights (top 3 colors, top 2 styles) when fetch_trend_data returns.',
    '4. State the compliance score and any critical issues when validate_brand_compliance returns.',
    '5. Confirm started background processes and give the ID (videos, collections).',
    '6. Be warm and professional; use fashion industry language naturally.',
    '7. Keep responses concise — 2-3 sentences max per voice turn.',
    '8. If unsure, ask one clarifying question instead of guessing.',
    '9. Chain actions in sequence when needed.',
    "10. Never say 'I would call' — just call the tool.",
  );
  return lines.join('\n');
}

async function fetchBrandStyle(brandId) {
  if (!brandId) return {};
  try {
    const axios = require('axios');
    const { data } = await axios.get(`${MAIN_BACKEND_URL}/brands/${brandId}/style`, { timeout: 8000 });
    return data?.style || {};
  } catch (_e) {
    return {};
  }
}

/**
 * Per-connection bridge object. Holds the upstream OpenAI WS and the mutable
 * session context (image, product info, brand style) that tools see.
 */
class VoiceSession {
  constructor(client, sessionId) {
    this.client = client; // ws to frontend
    this.sessionId = sessionId;
    this.openaiWs = null;
    this.context = {
      image_base64: '',
      product_name: '',
      product_description: '',
      product_category: '',
      product_subcategory: '',
      product_colors: [],
      product_materials: [],
      brand_id: '',
      brand_name: '',
      collection_name: '',
      current_page: '',
      brand_style: {},
    };
    this.started = false;
    this.modelInUse = OPENAI_MODEL;
    this.pendingFunctionCalls = new Map(); // call_id -> { name, args:'' }
    this.executedFunctionCalls = new Set();
  }

  // ------------------ frontend → server ------------------

  async handleClientText(text) {
    console.log(`[voice] ⬇ text frame ${text.length} chars session=${this.sessionId}`);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      console.error(`[voice] ⚠ JSON.parse failed for ${text.length}-char frame: ${e.message}; head=${JSON.stringify(text.slice(0, 80))}`);
      return;
    }
    console.log(`[voice]  payload.type=${payload.type} session=${this.sessionId}`);

    if (payload.type === 'start') {
      Object.assign(this.context, {
        image_base64: payload.productImageBase64 || '',
        product_name: payload.productName || '',
        product_description: payload.productDescription || '',
        product_category: payload.productCategory || '',
        product_subcategory: payload.productSubcategory || '',
        product_colors: payload.productColors || [],
        product_materials: payload.productMaterials || [],
        brand_id: payload.brandId || '',
        brand_name: payload.brandName || '',
        collection_name: payload.collectionName || '',
        current_page: payload.currentPage || '',
      });
      console.log(`[voice]  start: brand_id=${this.context.brand_id} product='${this.context.product_name}' image=${(this.context.image_base64||'').length}ch`);
      this.context.brand_style = await fetchBrandStyle(this.context.brand_id);
      console.log(`[voice]  brand_style fetched (${Object.keys(this.context.brand_style || {}).length} keys)`);
      // Inject the per-tool image-queue helper bound to *this* session.
      this.context.__queueImage__ = (img) => this.queueImageForFrontend(img);

      console.log(`[voice]  connecting to OpenAI Realtime (model=${this.modelInUse})...`);
      await this.connectOpenAI();
      console.log(`[voice]  connectOpenAI() resolved; sending session.update`);
      await this.sendInitialSessionUpdate();
      this.started = true;
      this.safeSendJson({ type: 'ack', event: 'start' });
      console.log(`[voice]  ✅ session ready, ack sent`);
      // Kick off greeting
      this.requestResponse(
        this.context.product_name
          ? `Briefly introduce yourself as Lux and comment on the product '${this.context.product_name}'.`
          : "Briefly introduce yourself as Lux, the voice design companion for TrendSync. Be warm and invite the user to try something.",
      );
      return;
    }

    if (payload.type === 'update_context') {
      if (payload.productImageBase64) this.context.image_base64 = payload.productImageBase64;
      if (payload.productName) this.context.product_name = payload.productName;
      if (payload.productDescription) this.context.product_description = payload.productDescription;
      if (payload.productCategory) this.context.product_category = payload.productCategory;
      if (payload.productSubcategory) this.context.product_subcategory = payload.productSubcategory;
      if (payload.productColors) this.context.product_colors = payload.productColors;
      if (payload.productMaterials) this.context.product_materials = payload.productMaterials;
      if (payload.collectionName) this.context.collection_name = payload.collectionName;
      if (payload.brandName) this.context.brand_name = payload.brandName;
      if (payload.currentPage) this.context.current_page = payload.currentPage;
      if (payload.brandId && payload.brandId !== this.context.brand_id) {
        this.context.brand_id = payload.brandId;
        this.context.brand_style = await fetchBrandStyle(payload.brandId);
      }
      // Push a fresh instruction so the model sees the new product
      if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
        this.openaiWs.send(JSON.stringify({
          type: 'session.update',
          session: { instructions: buildInstruction(this.context) },
        }));
      }
      return;
    }

    if (payload.type === 'stop') {
      this.shutdown('client_stop');
      return;
    }
  }

  handleClientBinary(buffer) {
    if (!this.started || !this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) return;
    // Forward raw PCM16 24kHz mono to OpenAI Realtime as base64.
    const b64 = Buffer.from(buffer).toString('base64');
    this.openaiWs.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: b64,
    }));
  }

  // ------------------ upstream OpenAI Realtime ------------------

  async connectOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.safeSendJson({ type: 'error', message: 'OPENAI_API_KEY not configured' });
      throw new Error('OPENAI_API_KEY missing');
    }
    const tryConnect = (model) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${REALTIME_BASE}${encodeURIComponent(model)}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        ws.once('open', () => resolve(ws));
        ws.once('error', (err) => reject(err));
      });

    try {
      this.openaiWs = await tryConnect(this.modelInUse);
      console.log(`[voice] OpenAI Realtime connected (model=${this.modelInUse}) session=${this.sessionId}`);
    } catch (err) {
      console.warn(`[voice] primary model ${this.modelInUse} failed: ${err.message}; falling back to ${FALLBACK_MODEL}`);
      this.modelInUse = FALLBACK_MODEL;
      this.openaiWs = await tryConnect(FALLBACK_MODEL);
      console.log(`[voice] OpenAI Realtime connected via fallback (model=${FALLBACK_MODEL}) session=${this.sessionId}`);
    }

    this.openaiWs.on('message', (data) => this.handleOpenAIEvent(data));
    this.openaiWs.on('close', (code) => {
      console.log(`[voice] OpenAI WS closed code=${code} session=${this.sessionId}`);
      this.shutdown('openai_closed');
    });
    this.openaiWs.on('error', (err) => {
      console.error('[voice] OpenAI WS error:', err.message);
      this.safeSendJson({ type: 'error', message: 'Voice provider error', detail: err.message });
    });
  }

  async sendInitialSessionUpdate() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: buildInstruction(this.context),
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            // Keep a user-visible transcript in English. GPT-4o mini
            // Transcribe improves accuracy and language recognition over
            // Whisper while keeping the realtime session cost-efficient.
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: VOICE,
          },
        },
        tools: REALTIME_TOOLS,
        tool_choice: 'auto',
      },
    };
    this.openaiWs.send(JSON.stringify(sessionUpdate));
  }

  requestResponse(extraInstruction) {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) return;
    this.openaiWs.send(JSON.stringify({
      type: 'response.create',
      response: {
        // Realtime audio responses include transcript events, so requesting
        // audio alone keeps this compatible with the GA API schema.
        output_modalities: ['audio'],
        ...(extraInstruction ? { instructions: extraInstruction } : {}),
      },
    }));
  }

  handleOpenAIEvent(raw) {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }

    switch (event.type) {
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        // base64 PCM16 24kHz — forward as raw binary frame
        const buf = Buffer.from(event.delta, 'base64');
        this.safeSendBinary(buf);
        break;
      }

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        if (event.delta) this.safeSendJson({ outputTranscription: { text: event.delta } });
        break;
      }

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        if (event.transcript) {
          // Optional: emit a final transcript marker (frontend tolerates duplicates via dedup)
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (event.transcript) {
          this.safeSendJson({ inputTranscription: { text: event.transcript } });
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        const entry = this.pendingFunctionCalls.get(event.call_id) || { name: event.name || '', args: '' };
        if (event.name) entry.name = event.name;
        entry.args += event.delta || '';
        this.pendingFunctionCalls.set(event.call_id, entry);
        break;
      }

      case 'response.function_call_arguments.done': {
        const entry = this.pendingFunctionCalls.get(event.call_id) || {};
        entry.name = entry.name || event.name;
        entry.args = entry.args || event.arguments || '';
        this.pendingFunctionCalls.set(event.call_id, entry);
        this.executeToolCall(event.call_id, entry.name, entry.args).catch((err) => {
          console.error('[voice] tool execution error:', err);
        });
        break;
      }

      case 'response.output_item.created':
      case 'response.output_item.added':
      case 'response.output_item.done': {
        // The current GA API surfaces a function call as an output item and
        // streams its arguments separately. Keep the item metadata so the
        // argument-complete event can execute it.
        const item = event.item;
        if (item && item.type === 'function_call') {
          this.pendingFunctionCalls.set(item.call_id || item.id, {
            name: item.name,
            args: item.arguments || '',
          });
        }
        break;
      }

      case 'response.done': {
        // The GA API includes complete tool calls in response.done. This
        // covers clients that omit a separate arguments.done event.
        for (const item of event.response?.output || []) {
          if (item.type !== 'function_call') continue;
          const callId = item.call_id || item.id;
          if (!callId) continue;
          const entry = {
            name: item.name || this.pendingFunctionCalls.get(callId)?.name || '',
            args: item.arguments || this.pendingFunctionCalls.get(callId)?.args || '',
          };
          this.pendingFunctionCalls.set(callId, entry);
          this.executeToolCall(callId, entry.name, entry.args).catch((err) => {
            console.error('[voice] tool execution error:', err);
          });
        }
        break;
      }

      case 'error': {
        console.error('[voice] OpenAI Realtime error event:', event.error);
        this.safeSendJson({ type: 'error', message: event.error?.message || 'OpenAI Realtime error' });
        break;
      }

      default:
        // Ignore other event types; kept for forward compatibility.
        break;
    }
  }

  // ------------------ Tool dispatch ------------------

  async executeToolCall(callId, name, argsRaw) {
    if (this.executedFunctionCalls.has(callId)) return;
    this.executedFunctionCalls.add(callId);

    const tool = TOOLS_BY_NAME[name];
    if (!tool) {
      this.sendFunctionResult(callId, name, { error: `Unknown tool: ${name}` });
      return;
    }
    let args = {};
    try { args = argsRaw ? JSON.parse(argsRaw) : {}; } catch (e) {
      console.warn(`[voice] could not parse args for ${name}:`, argsRaw);
    }
    let parsed;
    try { parsed = tool.parameters.parse(args); } catch (e) {
      this.sendFunctionResult(callId, name, { error: `Invalid arguments: ${e.message}` });
      return;
    }

    let result;
    try {
      result = await tool.execute(parsed, this.context);
    } catch (err) {
      result = { action: 'error', status: 'error', message: err.message || String(err) };
    }

    // Mirror the ADK functionResponse shape so the existing React extractor picks it up.
    this.safeSendJson({
      content: {
        parts: [{ functionResponse: { name, response: result } }],
      },
    });

    this.sendFunctionResult(callId, name, result);
    // Ask the model to respond to the tool result
    this.requestResponse();
  }

  sendFunctionResult(callId, name, result) {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) return;
    // Strip large fields before sending back to OpenAI to keep token cost low
    const trimmed = { ...result };
    if (trimmed.image_base64) delete trimmed.image_base64;
    this.openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(trimmed),
      },
    }));
  }

  // ------------------ Frontend image delivery ------------------

  queueImageForFrontend({ image_base64, ...extra }) {
    if (!image_base64) return;
    this.safeSendJson({
      type: 'image_updated',
      image_base64,
      ...extra,
    });
  }

  // ------------------ helpers / shutdown ------------------

  safeSendJson(obj) {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
    try { this.client.send(JSON.stringify(obj)); } catch (_e) { /* ignore */ }
  }

  safeSendBinary(buf) {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
    try { this.client.send(buf, { binary: true }); } catch (_e) { /* ignore */ }
  }

  shutdown(reason) {
    if (this.openaiWs) {
      try { this.openaiWs.close(); } catch (_e) { /* ignore */ }
      this.openaiWs = null;
    }
    try { this.client?.close(); } catch (_e) { /* ignore */ }
    console.log(`[voice] session ${this.sessionId} closed (${reason})`);
  }
}

/**
 * Attach the voice-companion WebSocket endpoint to an existing http.Server.
 */
function attachVoiceWebSocket(server, { path = '/ws/voice-companion' } = {}) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    if (!url.startsWith(path)) return; // not ours
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    const url = request.url || '';
    // /ws/voice-companion/{session_id}
    const tail = url.replace(path, '').replace(/^\/+/, '').split('?')[0];
    const sessionId = tail || `sess_${Date.now()}`;
    console.log(`[voice] client connected session=${sessionId}`);

    const session = new VoiceSession(ws, sessionId);

    ws.on('message', (data, isBinary) => {
      // ws@8 ALWAYS delivers Buffer regardless of frame type; the only
      // reliable signal is the `isBinary` flag. Old code that also tested
      // `Buffer.isBuffer(data)` mis-routed every text frame (including the
      // JSON 'start' message) to the binary handler, which silently dropped
      // it because `started` was false — hence the eternal "Listening...".
      if (isBinary) {
        session.handleClientBinary(data);
      } else {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        session.handleClientText(text).catch((e) => {
          console.error('[voice] handleClientText error:', e);
        });
      }
    });
    ws.on('close', () => session.shutdown('client_close'));
    ws.on('error', (err) => {
      console.error('[voice] client ws error:', err.message);
      session.shutdown('client_error');
    });
  });

  return wss;
}

module.exports = { attachVoiceWebSocket };
