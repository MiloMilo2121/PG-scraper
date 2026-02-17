#!/bin/bash

# 🚀 ANTIGRAVITY HETZNER DEPLOYMENT SCRIPT
# Usage: ./deploy_hetzner.sh

echo "----------------------------------------"
echo "🚀 INITIATING ANTIGRAVITY DEPLOYMENT"
echo "----------------------------------------"

# 1. Pull latest changes
echo "📥 Pulling latest code..."
git pull origin main

# 2. Build and start containers
echo "🐳 Building and starting containers..."
# We use --build to ensure code changes are picked up
# We use -d to run in detached mode
docker-compose up -d --build --remove-orphans

# 3. Prune unused images to save space
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "----------------------------------------"
echo "✅ DEPLOYMENT COMPLETE"
echo "🌐 UI available at http://$(curl -s ifconfig.me):3000"
echo "----------------------------------------"
