# Miro REST MCP (Custom)

This is a local MCP stdio server that bypasses the official Miro MCP `board_create` gate by calling Miro REST API directly.

It exposes two tools:
- `create_board` -> `POST /v2/boards`
- `list_boards` -> `GET /v2/boards`

## Why this exists

In some environments, the official Miro MCP connection can read boards but cannot create new boards (for example: "Board creation is not available" or tool-call confirmation gating).

This custom server uses your own Miro REST token (`boards:write` + `boards:read`) for guaranteed automation after one-time auth/admin setup.

## Prerequisites

- Node.js 18+ (for built-in `fetch`)
- A Miro OAuth access token with these scopes:
  - `boards:write`
  - `boards:read`
- Optional default team ID (recommended): `MIRO_TEAM_ID`

## Environment variables

- `MIRO_ACCESS_TOKEN` (required)
- `MIRO_TEAM_ID` (optional default for board create/list)
- `MIRO_API_BASE` (optional, default: `https://api.miro.com/v2`)

## Connect to Codex (recommended)

From the repository root:

```bash
export MIRO_ACCESS_TOKEN="<your-miro-oauth-access-token>"
export MIRO_TEAM_ID="<your-team-id>"  # optional

codex mcp add miro-rest \
  --env MIRO_ACCESS_TOKEN="$MIRO_ACCESS_TOKEN" \
  --env MIRO_TEAM_ID="$MIRO_TEAM_ID" \
  -- node "$(pwd)/tools/miro-rest-mcp/server.js"
```

Then verify:

```bash
codex mcp list
codex mcp get miro-rest --json
```

## Tools

### `create_board`
Arguments:
- `name` (required string)
- `description` (optional string)
- `team_id` (optional string; falls back to `MIRO_TEAM_ID`)

### `list_boards`
Arguments (all optional):
- `query`
- `team_id` (falls back to `MIRO_TEAM_ID`)
- `project_id`
- `owner`
- `limit` (1-50)
- `offset`
- `sort` (`default`, `last_modified`, `last_opened`, `last_created`, `alphabetically`)

## Usage example in Codex

Ask Codex:

- `Use tool create_board with name "hello world" and description "MCP automation test".`
- `Use tool list_boards with query "hello world" and limit 5.`

## Remove server

```bash
codex mcp remove miro-rest
```
