#!/bin/bash
# 🚀 DEPLOY TO SERVER SCRIPT 🚀
# Usage: ./deploy_to_server.sh [user@ip] [remote_path]

TARGET=$1
REMOTE_PATH=${2:-"~/PG-Enrichment-Meccatronica"}

if [ -z "$TARGET" ]; then
  echo "Usage: ./deploy_to_server.sh user@ip [remote_dir]"
  exit 1
fi

echo "--- 📦 Deploying to $TARGET:$REMOTE_PATH ---"

# 1. Create Remote Directory
ssh -i ~/.ssh/hetzner_key -o StrictHostKeyChecking=no "$TARGET" "mkdir -p $REMOTE_PATH"

# 2. Sync Files (fast, excludes node_modules and big logs)
echo "--- 🔄 Syncing files... ---"
rsync -avz -e "ssh -i ~/.ssh/hetzner_key -o StrictHostKeyChecking=no" --exclude 'node_modules' --exclude 'output' --exclude '.git' --exclude '.DS_Store' --exclude 'temp_profiles' ./ "$TARGET:$REMOTE_PATH"

# 3. Remote Setup & Launch
echo "--- 🚀 Launching Remote Process... ---"
ssh -i ~/.ssh/hetzner_key -o StrictHostKeyChecking=no "$TARGET" "bash -s" <<EOF
  cd $REMOTE_PATH
  
  # Install dependencies if needed (fast if already cached)
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing modules (first run)..."
    npm install
    npm install -g ts-node typescript
  fi
  
  # Make executable
  chmod +x loop_meccatronica.sh
  
  # Start Loop in background
  nohup ./loop_meccatronica.sh > output/remote_manager.log 2>&1 &
  
  echo "✅ STARTED! Log: $REMOTE_PATH/output/remote_manager.log"
  echo "PID: \$!"
EOF

echo "--- ✨ DEPLOY COMPLETE ✨ ---"
