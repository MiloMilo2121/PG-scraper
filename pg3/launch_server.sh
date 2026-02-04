#!/bin/bash
# Server-side launch script
cd /root/PG-scraper/pg3

echo "🛑 Cleaning up old processes..."
pkill -9 -f node
pkill -9 -f ts-node
pkill -9 -f chrome
pkill -9 -f chromium

echo "🧹 Clearing profile locks..."
rm -rf temp_profiles/*

echo "🔄 Pulling latest code..."
git pull origin main

echo "🚀 Launching scraper..."
# Run with ts-node directly to avoid npm overhead and issues
nohup npx ts-node generate_campaign.ts > scrape_output.log 2>&1 &

echo "✅ Scraper launched in background!"
sleep 2
tail -n 20 scrape_output.log
