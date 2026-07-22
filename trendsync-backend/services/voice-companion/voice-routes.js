/**
 * Voice routes — HTTP endpoints for the voice-companion service.
 *
 * The frontend talks to the voice service via WebSocket (port 8002, see
 * websocket-server.js), but we also expose a small REST surface for health
 * checks, session inspection, and direct tool invocation (useful for
 * debugging and for the main-backend WS proxy fallback).
 */

const express = require('express');
const router = express.Router();
const { tools } = require('./tools');

const TOOL_NAMES = tools.map((t) => t.name);

const OPENAI_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-realtime-2.1';
const FALLBACK_MODEL = 'gpt-realtime-2';
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:8000';

/**
 * Health check.
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'voice-companion',
    model: OPENAI_MODEL,
    fallback_model: FALLBACK_MODEL,
    tools: TOOL_NAMES,
    backend_url: MAIN_BACKEND_URL,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
  });
});

/**
 * Tool registry — useful for debugging.
 */
router.get('/tools', (_req, res) => {
  res.json({
    count: tools.length,
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  });
});

/**
 * Direct tool invocation (debug + fallback for non-WebSocket clients).
 */
router.post('/tools/:name', express.json({ limit: '10mb' }), async (req, res) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return res.status(404).json({ error: `Unknown tool: ${req.params.name}` });
  }
  try {
    const args = req.body || {};
    const sessionContext = args.__session_context__ || {};
    delete args.__session_context__;
    const parsed = tool.parameters.parse(args);
    const result = await tool.execute(parsed, sessionContext);
    res.json({ success: true, tool: tool.name, result });
  } catch (error) {
    console.error(`[voice-routes] tool ${req.params.name} failed:`, error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

module.exports = router;
