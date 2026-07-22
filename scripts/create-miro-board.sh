#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Create a Miro board via REST API.

Usage:
  ./scripts/create-miro-board.sh --name "hello world" [--description "text"] [--no-verify]

Required environment variables:
  MIRO_ACCESS_TOKEN   OAuth access token with boards:write and boards:read
  MIRO_TEAM_ID        Team ID where the board should be created

Optional environment variables:
  MIRO_API_BASE       Defaults to https://api.miro.com/v2
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

parse_args() {
  BOARD_NAME=""
  BOARD_DESCRIPTION="custom mcp automation test"
  VERIFY=1

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        shift
        BOARD_NAME="${1:-}"
        ;;
      --description)
        shift
        BOARD_DESCRIPTION="${1:-}"
        ;;
      --no-verify)
        VERIFY=0
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
    shift
  done

  if [[ -z "${BOARD_NAME}" ]]; then
    echo "Missing required --name argument." >&2
    usage
    exit 1
  fi
}

require_env() {
  if [[ -z "${MIRO_ACCESS_TOKEN:-}" ]]; then
    echo "Missing MIRO_ACCESS_TOKEN environment variable." >&2
    exit 1
  fi

  if [[ -z "${MIRO_TEAM_ID:-}" ]]; then
    echo "Missing MIRO_TEAM_ID environment variable." >&2
    exit 1
  fi
}

http_request() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  local data="${4:-}"

  if [[ -n "$data" ]]; then
    curl -sS -o "$body_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer ${MIRO_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -sS -o "$body_file" -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Authorization: Bearer ${MIRO_ACCESS_TOKEN}"
  fi
}

main() {
  require_cmd curl
  require_cmd node
  parse_args "$@"
  require_env

  local api_base="${MIRO_API_BASE:-https://api.miro.com/v2}"
  local create_url="${api_base}/boards"
  local create_body_file
  create_body_file="$(mktemp)"
  local verify_body_file
  verify_body_file="$(mktemp)"
  trap 'rm -f "${create_body_file:-}" "${verify_body_file:-}"' EXIT

  local payload
  payload="$(node -e '
    const name = process.argv[1];
    const description = process.argv[2];
    const teamId = process.argv[3];
    process.stdout.write(JSON.stringify({ name, description, teamId }));
  ' "$BOARD_NAME" "$BOARD_DESCRIPTION" "$MIRO_TEAM_ID")"

  local create_status
  create_status="$(http_request "POST" "$create_url" "$create_body_file" "$payload")"

  if [[ "${create_status}" -lt 200 || "${create_status}" -ge 300 ]]; then
    echo "Create board failed (HTTP ${create_status}):" >&2
    cat "$create_body_file" >&2
    exit 1
  fi

  local board_id
  board_id="$(node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(obj.id || "");
  ' "$create_body_file")"

  local board_name
  board_name="$(node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(obj.name || "");
  ' "$create_body_file")"

  local board_link
  board_link="$(node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(obj.viewLink || "");
  ' "$create_body_file")"

  echo "Board created successfully:"
  echo "  id: ${board_id}"
  echo "  name: ${board_name}"
  echo "  viewLink: ${board_link}"

  if [[ "$VERIFY" -eq 0 ]]; then
    exit 0
  fi

  local encoded_query
  encoded_query="$(node -p 'encodeURIComponent(process.argv[1])' "$BOARD_NAME")"
  local verify_url="${api_base}/boards?team_id=${MIRO_TEAM_ID}&query=${encoded_query}&limit=5"
  local verify_status
  verify_status="$(http_request "GET" "$verify_url" "$verify_body_file")"

  if [[ "${verify_status}" -lt 200 || "${verify_status}" -ge 300 ]]; then
    echo "Verify list failed (HTTP ${verify_status}):" >&2
    cat "$verify_body_file" >&2
    exit 1
  fi

  echo ""
  echo "Verification matches (up to 5):"
  node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const rows = Array.isArray(obj.data) ? obj.data : [];
    if (!rows.length) {
      console.log("  (none)");
      process.exit(0);
    }
    for (const board of rows) {
      console.log(`  - ${board.id} | ${board.name}`);
    }
  ' "$verify_body_file"
}

main "$@"
