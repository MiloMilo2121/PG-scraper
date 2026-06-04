#!/bin/bash
# 🚀 V8 DISCOVERY DEPLOY SCRIPT 🚀
set -euo pipefail

# Configuration
SERVER_IP="46.225.21.199"
SSH_KEY="$HOME/.ssh/hetzner_key"
REMOTE_DIR="/root/PG-scraper/pg3"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "--- 🔄 Syncing Files to $SERVER_IP ---"

# Create remote directory first
$SSH_CMD root@"$SERVER_IP" "mkdir -p \"$REMOTE_DIR/output/campaigns\""

# Sync from project root
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -avzP --delete -e "$RSYNC_SSH" \
    --exclude 'node_modules' \
    --exclude 'browser_profile*' \
    --exclude 'search_profile*' \
    --exclude 'temp_profiles' \
    --exclude 'output' \
    --exclude 'output_server' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude '.DS_Store' \
    --exclude '*.log' \
    "$PROJECT_ROOT/" root@"$SERVER_IP":"$REMOTE_DIR"

# Upload the specific CSV we are working on
echo "--- 📄 Uploading Target CSV ---"
rsync -avzP -e "$RSYNC_SSH" "$PROJECT_ROOT/output/campaigns/MASTER_NO_WEBSITE.csv" root@"$SERVER_IP":"$REMOTE_DIR/output/campaigns/MASTER_NO_WEBSITE.csv"

echo "--- 🚀 Launching Remote V8 Discovery ---"
$SSH_CMD root@"$SERVER_IP" "bash -s" <<EOF
  set -euo pipefail
  cd $REMOTE_DIR
  
  echo "🛑 Stopping existing processes..."
  pkill -f "v8_discovery_only" || true
  pkill -f "loop_meccatronica.sh" || true
  pkill -f "ts-node" || true
  pkill -f "chrome" || true
  pkill -f "playwright" || true
  sleep 2
  
  echo "📦 Installing/Updating node_modules on server..."
  npm install --omit=dev

  echo "🔥 Starting V8 Discovery Pipeline (Concurrency: 15)..."
  nohup env WAVE1_CONCURRENCY=15 npx tsx src/scripts/v8_discovery_only.ts output/campaigns/MASTER_NO_WEBSITE.csv > output/remote_v8_discovery.log 2>&1 &
  echo "✅ V8 Discovery started on server! Log: $REMOTE_DIR/output/remote_v8_discovery.log"
EOF

echo "--- ✨ DEPLOY COMPLETE ✨ ---"
