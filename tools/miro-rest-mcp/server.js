#!/usr/bin/env node

/**
 * Minimal MCP stdio server that automates Miro board operations via REST API.
 *
 * Tools:
 *  - create_board (POST /v2/boards)
 *  - list_boards  (GET /v2/boards)
 *
 * Required env:
 *  - MIRO_ACCESS_TOKEN (OAuth access token with boards:write and boards:read)
 *
 * Optional env:
 *  - MIRO_TEAM_ID (default team ID for create/list when team_id is omitted)
 *  - MIRO_API_BASE (default: https://api.miro.com/v2)
 */

'use strict';

const SERVER_NAME = 'miro-rest-mcp';
const SERVER_VERSION = '0.1.0';
const API_BASE = process.env.MIRO_API_BASE || 'https://api.miro.com/v2';
const ACCESS_TOKEN = process.env.MIRO_ACCESS_TOKEN || '';
const DEFAULT_TEAM_ID = process.env.MIRO_TEAM_ID || '';
const SUPPORTED_PROTOCOL = '2025-03-26';

let initialized = false;

function log(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function cleanObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function encodeQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function miroRequest(method, path, { query, body } = {}) {
  if (!ACCESS_TOKEN) {
    throw new Error('MIRO_ACCESS_TOKEN is required.');
  }

  const url = `${API_BASE}${path}${encodeQuery(query)}`;
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = payload?.message || payload?.error || payload?.raw || response.statusText;
    throw new Error(`Miro API ${response.status}: ${detail}`);
  }

  return payload;
}

function toMcpResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError: false,
  };
}

function toMcpToolError(message, details) {
  const text = details ? `${message}\n${details}` : message;
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

const TOOLS = [
  {
    name: 'create_board',
    description:
      'Create a brand-new Miro board via REST API (POST /v2/boards). Requires boards:write scope.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Board name/title.',
        },
        description: {
          type: 'string',
          description: 'Optional board description.',
        },
        team_id: {
          type: 'string',
          description:
            'Optional Miro team ID. Falls back to MIRO_TEAM_ID env when omitted.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_boards',
    description:
      'List boards accessible to the token user via REST API (GET /v2/boards). Requires boards:read scope.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional board search query string.',
        },
        team_id: {
          type: 'string',
          description: 'Optional team filter. Falls back to MIRO_TEAM_ID env when omitted.',
        },
        project_id: {
          type: 'string',
          description: 'Optional project filter.',
        },
        owner: {
          type: 'string',
          description: 'Optional owner ID filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Result page size (1-50).',
        },
        offset: {
          type: 'string',
          description: 'Pagination offset token.',
        },
        sort: {
          type: 'string',
          enum: ['default', 'last_modified', 'last_opened', 'last_created', 'alphabetically'],
          description: 'Sort order.',
        },
      },
      additionalProperties: false,
    },
  },
];

async function handleToolCall(name, args) {
  if (name === 'create_board') {
    const boardName = typeof args?.name === 'string' ? args.name.trim() : '';
    if (!boardName) {
      return toMcpToolError('create_board validation error', 'Argument "name" must be a non-empty string.');
    }

    const teamId = args?.team_id || DEFAULT_TEAM_ID;
    const body = cleanObject({
      name: boardName,
      description: args?.description,
      teamId,
    });

    try {
      const response = await miroRequest('POST', '/boards', { body });
      const board = response?.data || response || {};
      return toMcpResult({
        created: true,
        board: {
          id: board.id,
          name: board.name,
          description: board.description,
          type: board.type,
          viewLink: board.viewLink || board.view_link || board.links?.self,
          teamId: board.team?.id || teamId || null,
        },
      });
    } catch (error) {
      return toMcpToolError('create_board failed', error instanceof Error ? error.message : String(error));
    }
  }

  if (name === 'list_boards') {
    const teamId = args?.team_id || DEFAULT_TEAM_ID;
    const query = cleanObject({
      team_id: teamId,
      project_id: args?.project_id,
      query: args?.query,
      owner: args?.owner,
      limit: args?.limit,
      offset: args?.offset,
      sort: args?.sort,
    });

    try {
      const response = await miroRequest('GET', '/boards', { query });
      const boardList = Array.isArray(response?.data) ? response.data : [];
      const mapped = boardList.map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        createdAt: board.createdAt || board.created_at,
        modifiedAt: board.modifiedAt || board.modified_at,
        viewLink: board.viewLink || board.view_link || board.links?.self,
        teamId: board.team?.id || null,
      }));

      return toMcpResult({
        count: mapped.length,
        total: response?.total ?? null,
        offset: response?.offset ?? null,
        limit: response?.limit ?? null,
        boards: mapped,
      });
    } catch (error) {
      return toMcpToolError('list_boards failed', error instanceof Error ? error.message : String(error));
    }
  }

  return toMcpToolError('Unknown tool', `Tool "${name}" is not implemented.`);
}

function send(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const error = data ? { code, message, data } : { code, message };
  send({ jsonrpc: '2.0', id, error });
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return;
  }

  const { id, method, params } = message;

  try {
    if (method === 'initialize') {
      initialized = true;
      const requestedProtocol = typeof params?.protocolVersion === 'string'
        ? params.protocolVersion
        : SUPPORTED_PROTOCOL;

      sendResult(id, {
        protocolVersion: requestedProtocol,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'ping') {
      sendResult(id, {});
      return;
    }

    if (!initialized) {
      sendError(id ?? null, -32002, 'Server not initialized');
      return;
    }

    if (method === 'tools/list') {
      sendResult(id, { tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      if (typeof toolName !== 'string' || !toolName) {
        sendResult(id, toMcpToolError('Invalid tools/call request', 'Missing "name".'));
        return;
      }
      const toolArgs = params?.arguments || {};
      const result = await handleToolCall(toolName, toolArgs);
      sendResult(id, result);
      return;
    }

    sendError(id ?? null, -32601, `Method not found: ${method}`);
  } catch (error) {
    sendError(
      id ?? null,
      -32603,
      'Internal server error',
      error instanceof Error ? error.message : String(error)
    );
  }
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;

  while (true) {
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) {
      break;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (!line) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      log(`Failed to parse JSON line: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    await handleMessage(message);
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.stack || error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${String(reason)}`);
  process.exit(1);
});

log('Started. Waiting for MCP messages on stdin...');
