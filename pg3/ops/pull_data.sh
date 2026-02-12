#!/bin/bash
# 📥 PULL DATA FROM SERVER 📥
set -euo pipefail

# Resolve project root (parent of ops/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Configuration
SERVER_IP="46.225.21.199"
SSH_KEY="$HOME/.ssh/hetzner_key"
REMOTE_DIR="/root/PG-scraper/pg3/output/"
LOCAL_DIR="$PROJECT_ROOT/output_server/"

mkdir -p "$LOCAL_DIR"

echo "--- 📥 Pulling Data from $SERVER_IP ($REMOTE_DIR) to $LOCAL_DIR ---"

# Sync everything FROM server TO local
rsync -avzP -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
    --exclude 'node_modules' \
    "root@$SERVER_IP:$REMOTE_DIR" "$LOCAL_DIR"

echo "--- ✨ SYNC COMPLETE ✨ ---"
echo "📂 Data is in: $LOCAL_DIR"
