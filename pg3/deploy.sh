#!/bin/bash
# 🚀 MECCATRONICA DEPLOY SCRIPT 🚀
set -euo pipefail

# Configuration
SERVER_IP="46.225.21.199"
SSH_KEY="$HOME/.ssh/hetzner_key"
REMOTE_DIR="/root/PG/pg3"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "--- 🔄 Syncing Files to $SERVER_IP ---"

# Create remote directory first
$SSH_CMD root@"$SERVER_IP" "mkdir -p \"$REMOTE_DIR\""

# Fixed rsync with direct exclusions
rsync -avzP --delete-delay -e "$RSYNC_SSH" \
    --exclude 'node_modules' \
    --exclude 'browser_profile*' \
    --exclude 'search_profile*' \
    --exclude 'financial_profile*' \
    --exclude 'verification_profile*' \
    --exclude 'temp_profiles' \
    --exclude 'output' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude '.DS_Store' \
    --exclude '*.log' \
    --exclude 'archive' \
    ./ root@"$SERVER_IP":"$REMOTE_DIR"

echo "--- 🚀 Launching Remote enrichment loop ---"
$SSH_CMD root@"$SERVER_IP" "bash -s" <<EOF
  set -euo pipefail
  cd $REMOTE_DIR
  mkdir -p output
  chmod +x loop_meccatronica.sh
  
  # Check if npm install is needed
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing node_modules on server..."
    npm ci --omit=dev || npm install
  fi

  # Start the loop only if not already running
  if pgrep -f "loop_meccatronica.sh" > /dev/null; then
    echo "ℹ️ Loop already running. Skipping duplicate launch."
  else
    nohup ./loop_meccatronica.sh > output/remote_manager.log 2>&1 &
    echo "✅ Enrichment started on server! Log: $REMOTE_DIR/output/remote_manager.log"
  fi
EOF

echo "--- ✨ DEPLOY COMPLETE ✨ ---"
