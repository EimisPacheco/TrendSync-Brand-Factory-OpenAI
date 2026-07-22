/**
 * TrendSync Voice Design Companion — Node.js entrypoint.
 *
 * Replaces the previous Python ADK / Gemini-Live service with an
 * OpenAI Realtime-backed equivalent. Listens on port 8002 with the same
 * WebSocket path the frontend already uses (/ws/voice-companion/{session_id}),
 * so the existing main-backend WS proxy and the React VoiceCompanion need
 * no protocol changes.
 *
 * Environment:
 *   OPENAI_API_KEY    (required)
 *   OPENAI_VOICE_MODEL default 'gpt-realtime-2.1'
 *   OPENAI_VOICE      default 'alloy'
 *   MAIN_BACKEND_URL  default 'http://localhost:8000'
 *   PORT              default 8002
 */

const path = require('path');

// Load .env from trendsync-backend/.env (mirrors the Python service behavior)
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (_e) {
  /* dotenv is optional */
}

const http = require('http');
const express = require('express');
const cors = require('cors');

const voiceRoutes = require('./voice-routes');
const { attachVoiceWebSocket } = require('./websocket-server');

const PORT = parseInt(process.env.PORT || '8002', 10);
// Use the current Realtime model with tool use and improved interruption
// handling. It remains overridable for controlled rollouts.
const OPENAI_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-realtime-2.1';
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:8000';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

// REST surface (health, tool registry, debug invocation)
app.use('/', voiceRoutes);

// Cloud Run / proxies use a "ready" probe at /
app.get('/', (_req, res) => {
  res.json({
    service: 'voice-companion',
    status: 'ok',
    model: OPENAI_MODEL,
    main_backend: MAIN_BACKEND_URL,
  });
});

const server = http.createServer(app);
attachVoiceWebSocket(server, { path: '/ws/voice-companion' });

server.listen(PORT, () => {
  console.log('============================================================');
  console.log(' TrendSync Voice Design Companion (Node.js / OpenAI Realtime)');
  console.log(`  Port:           ${PORT}`);
  console.log(`  Model:          ${OPENAI_MODEL}`);
  console.log(`  Main backend:   ${MAIN_BACKEND_URL}`);
  console.log(`  WS endpoint:    ws://0.0.0.0:${PORT}/ws/voice-companion/{session_id}`);
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'MISSING'}`);
  console.log('============================================================');
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[voice] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
