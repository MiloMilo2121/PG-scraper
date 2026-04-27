#!/usr/bin/env bash
# PG3 one-time bootstrap: Redis + deps + smoke test del server MCP.
# Esegui questo sul tuo Mac PRIMA di riavviare Claude Desktop.

set -e

cd "$(dirname "$0")"
echo "📁 cwd: $(pwd)"
echo ""

# 1. Docker disponibile?
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker non installato. Install: https://www.docker.com/products/docker-desktop"
  exit 1
fi

# 2. Redis up
echo "🐳 Avvio Redis..."
docker compose up -d redis

# 3. Health check Redis (max 30s)
echo "🩺 Aspetto Redis healthy..."
for i in {1..30}; do
  if docker exec antigravity-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "✅ Redis up & PONG"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "❌ Redis non risponde dopo 30s"
    exit 1
  fi
done

# 4. Node version check (.nvmrc dice 22.14.0)
WANTED=$(cat .nvmrc 2>/dev/null || echo "22")
CURRENT=$(node --version 2>/dev/null | tr -d 'v')
echo "🟢 Node attuale: $CURRENT (richiesto: $WANTED)"
if [ "${CURRENT%%.*}" != "${WANTED%%.*}" ]; then
  echo "⚠️ Versione major diversa. Se hai nvm, lancia: nvm use"
fi

# 5. npm install se node_modules vuoto/incompleto
if [ ! -d node_modules ] || [ ! -f node_modules/@modelcontextprotocol/sdk/package.json ]; then
  echo "📦 npm install (mancano deps)..."
  npm ci
else
  echo "📦 deps OK"
fi

# 6. Smoke test: launcher esiste ed eseguibile
if [ ! -x start_mcp.sh ]; then
  chmod +x start_mcp.sh
  echo "🔧 start_mcp.sh reso +x"
fi

# 7. Verifica config Claude Desktop ha pg3-god-mode
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ -f "$CFG" ]; then
  if grep -q "pg3-god-mode" "$CFG"; then
    echo "✅ claude_desktop_config.json contiene pg3-god-mode"
  else
    echo "⚠️ pg3-god-mode NON trovato in $CFG — rilancio config setup precedente"
  fi
else
  echo "❌ $CFG non esiste — esegui prima il config-setup"
fi

echo ""
echo "============================================"
echo "✅ BOOTSTRAP COMPLETO"
echo "👉 ORA: chiudi e riapri Claude Desktop (Cmd+Q)"
echo "👉 Dopo restart: i tools mcp__pg3-god-mode__* saranno live"
echo "📊 Bull dashboard: http://localhost:3001"
echo "============================================"
