#!/bin/bash
# 🚀 DEPLOY LOMBARDIA MISSION 🚀
set -euo pipefail

# Configuration
SERVER_IP="46.225.21.199"
SSH_KEY="$HOME/.ssh/hetzner_key"
REMOTE_DIR="/root/PG-scraper/pg3"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "--- 🔄 Syncing Files to $SERVER_IP ---"

# Create remote directory first
$SSH_CMD root@"$SERVER_IP" "mkdir -p \"$REMOTE_DIR\""

# Sync from project root (one level up from ops/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

echo "--- 🚀 Launching Remote Mission ---"
$SSH_CMD root@"$SERVER_IP" "bash -s" <<EOF
  set -euo pipefail
  cd $REMOTE_DIR
  
  # Ensure scripts are executable
  chmod +x ops/mission_lombardia_manifattura.sh
  chmod +x ops/loop_meccatronica.sh
  
  # Install dependencies (fast)
  echo "📦 Updating dependencies..."
  npm install --omit=dev

  # Launch Mission (Detached)
  echo "🔥 executing mission_lombardia_manifattura.sh (DETACHED)..."
  nohup ./ops/mission_lombardia_manifattura.sh > output/mission.log 2>&1 &
  echo "✅ Mission launched in background. Check output/mission.log"
EOF

echo "--- ✨ DEPLOY & LAUNCH COMPLETE ✨ ---"
