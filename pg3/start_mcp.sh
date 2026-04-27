#!/usr/bin/env bash
# PG3 MCP Server launcher — stdio transport
# Used by Claude Desktop / Cowork to boot the God Mode server with correct cwd.

set -euo pipefail

cd "$(dirname "$0")"

# Optional: load nvm to honour .nvmrc (Node 22.14.0)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  nvm use >/dev/null 2>&1 || true
fi

exec npx tsx src/mcp_server.ts
