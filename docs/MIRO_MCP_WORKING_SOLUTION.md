# Miro MCP Working Solution (AITX Hackathon Team)

This is the exact flow that worked for us, including the fallback that allows reliable board creation.

## 1) Connect the official Miro MCP in Codex

1. Install the Miro MCP app from Marketplace: [Miro MCP for OpenAI Codex](https://miro.com/marketplace/miro-mcp-for-openai-codex)
2. In Miro, select team: `AITX Community Hackathon and Miro`.
3. Restart Codex (or start a new Codex session).
4. In terminal, authenticate the MCP server:

```bash
codex mcp login miro
codex mcp list
```

If `miro` shows `enabled` + `OAuth`, auth is good.

## 2) Create a Miro developer app and get an OAuth token

1. In Miro Developer settings, create/configure your app.
2. Add Redirect URI:

```text
http://localhost:9876/callback
```

3. Ensure scopes include at least:
   - `boards:read`
   - `boards:write`
   - `team:read`
4. Click **Install app and get OAuth token**.
5. Choose organization and team: `AITX Community Hackathon and Miro`.
6. Copy the access token from the install modal.

## 3) Export env vars (`MIRO_ACCESS_TOKEN`, `MIRO_TEAM_ID`)

```bash
export MIRO_ACCESS_TOKEN="PASTE_ACCESS_TOKEN"
```

Get the team ID from the token introspection endpoint:

```bash
curl -s -H "Authorization: Bearer $MIRO_ACCESS_TOKEN" \
  https://api.miro.com/v1/oauth-token
```

Copy `team.id` from the response, then:

```bash
export MIRO_TEAM_ID="PASTE_TEAM_ID"
```

## 4) Verify REST access before MCP fallback

```bash
curl -s -H "Authorization: Bearer $MIRO_ACCESS_TOKEN" \
  "https://api.miro.com/v2/boards?team_id=$MIRO_TEAM_ID&limit=1"
```

If this returns board data, your token and team ID are correct.

## 5) Add the custom REST MCP server (board-creation fallback)

Use the local server in this repo:
`tools/miro-rest-mcp/server.js`

```bash
codex mcp add miro-rest \
  --env MIRO_ACCESS_TOKEN="$MIRO_ACCESS_TOKEN" \
  --env MIRO_TEAM_ID="$MIRO_TEAM_ID" \
  -- node "/Users/eimis/Documents/HACKTHONS-2025/GOOGLE-AGENT-DEVELOPMENT-KIT/TrendSync Brand Factory Open AI/tools/miro-rest-mcp/server.js"
```

Verify config:

```bash
codex mcp get miro-rest --json
```

## 6) Create a test board ("hello world")

### Option A (recommended): use the script in this repo

```bash
./scripts/create-miro-board.sh --name "hello world"
```

### Option B: direct REST call

```bash
curl -s -X POST "https://api.miro.com/v2/boards" \
  -H "Authorization: Bearer $MIRO_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"hello world\",\"description\":\"custom mcp test\",\"teamId\":\"$MIRO_TEAM_ID\"}"
```

Open the returned `viewLink`.

## 7) If board looks blank in browser

In our case, creation worked; visibility issue was browser-side.

1. Hard refresh the board tab.
2. Open the `viewLink` in a new tab or incognito.
3. Reset zoom / fit canvas.
4. If needed, place larger test objects so they are easy to spot.

## Notes

- Keep secrets local; do not commit tokens or client secrets.
- If a token was pasted/shared accidentally, rotate it in Miro Developer settings.
- Use one primary flow for creation: custom `miro-rest` MCP or direct REST script.
