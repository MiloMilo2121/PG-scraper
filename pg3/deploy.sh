#!/bin/bash
# 🚀 MECCATRONICA DEPLOY SCRIPT 🚀

# Configuration
SERVER_IP="46.225.21.199"
SSH_KEY="$HOME/.ssh/hetzner_key"
REMOTE_DIR="/root/PG/pg3"

echo "--- 🔄 Syncing Files to $SERVER_IP ---"

# Create remote directory first
ssh -i $SSH_KEY -o StrictHostKeyChecking=no root@$SERVER_IP "mkdir -p $REMOTE_DIR"

# Fixed rsync with direct exclusions
rsync -avzP -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
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
    ./ root@$SERVER_IP:$REMOTE_DIR

echo "--- 🚀 Launching Remote enrichment loop ---"
ssh -i $SSH_KEY -o StrictHostKeyChecking=no root@$SERVER_IP "bash -s" <<EOF
  cd $REMOTE_DIR
  mkdir -p output
  chmod +x loop_meccatronica.sh
  
  # Check if npm install is needed
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing node_modules on server..."
    npm install
  fi

  # Start the loop
  nohup ./loop_meccatronica.sh > output/remote_manager.log 2>&1 &
  echo "✅ Enrichment started on server! Log: $REMOTE_DIR/output/remote_manager.log"
EOF

echo "--- ✨ DEPLOY COMPLETE ✨ ---"
