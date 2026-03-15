#!/bin/bash
set -euo pipefail

SERVER_IP="${SERVER_IP:-46.225.21.199}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hetzner_key}"
REMOTE_DIR="${REMOTE_DIR:-/root/PG-scraper/pg3}"
REMOTE_LOG="${REMOTE_DIR}/output/mission_lombardia_manifattura_e2e.log"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "--- 🔄 Syncing files to ${SERVER_IP} ---"
$SSH_CMD root@"$SERVER_IP" "mkdir -p \"$REMOTE_DIR\""

rsync -avzP --delete -e "$RSYNC_SSH" \
  --exclude 'node_modules' \
  --exclude 'browser_profile*' \
  --exclude 'search_profile*' \
  --exclude 'financial_profile*' \
  --exclude 'verification_profile*' \
  --exclude 'temp_profiles' \
  --exclude 'output' \
  --exclude 'output_server' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude 'archive' \
  "$PROJECT_ROOT/" root@"$SERVER_IP":"$REMOTE_DIR"

echo "--- 🚀 Launching remote Lombardia E2E mission ---"
$SSH_CMD root@"$SERVER_IP" "bash -s" <<EOF
  set -euo pipefail
  cd "$REMOTE_DIR"
  mkdir -p output
  chmod +x ops/mission_lombardia_manifattura_e2e.sh

  echo "📦 Installing dependencies..."
  npm ci --omit=dev

  echo "🛑 Stopping previous mission launcher if present..."
  pkill -f "mission_lombardia_manifattura_e2e.sh" || true
  pkill -f "$REMOTE_DIR/node_modules/.bin/ts-node src/scraper/generate_campaign_v2.ts" || true
  pkill -f "$REMOTE_DIR/node_modules/.bin/ts-node src/index.ts worker" || true
  pkill -f "$REMOTE_DIR/node_modules/.bin/ts-node src/index.ts scheduler" || true

  echo "🔥 Starting mission in background..."
  nohup ./ops/mission_lombardia_manifattura_e2e.sh > "$REMOTE_LOG" 2>&1 &
  echo "REMOTE_LOG=$REMOTE_LOG"
EOF

echo "--- ✨ Deploy complete ---"
echo "Log: $REMOTE_LOG"
