#!/bin/bash
# 🏭 MISSION: LOMBARDIA MANIFATTURA 🏭
# Target: Impianti, Officine Meccaniche, Manifatturiero
# Area: MI, PV, BG, LO, CR
# Server: Hetzner (High Power)

set -euo pipefail

# 1. SETUP ENVIRONMENT FOR MAX POWER
# 1. SETUP ENVIRONMENT FOR MAX POWER
export MAX_CONCURRENCY=5
export RUNNER_CONCURRENCY_LIMIT=5
export SCRAPE_DO_ENFORCE=false
export HEADLESS=true
export LLM_MODEL_SMART="glm-4-plus"
export AI_MODEL_SMART="glm-4-plus"
export LLM_MODEL_FAST="glm-4-plus"
export CHROME_BIN="/usr/bin/chromium-browser"

# Proxy Bypass - Manual CURL verified this is safe from Hetzner
export DISABLE_PROXY=true
export DISABLE_STEALTH=true

# 2. DEFINE TARGETS - MANUAL OVERRIDE (LLM Bypass)
QUERY="Impiantistica industriale,Officine meccaniche,Officine meccaniche di precisione,Officine metalmeccaniche,Lavorazioni meccaniche,Costruzioni meccaniche,Produzione industriale,Manifattura"
PROVINCES="MI,PV,BG,LO,CR"

echo "--- 🏭 STARTING MISSION LOMBARDIA MANIFATTURA (GRANITIC SEQUENTIAL) 🏭 ---"
echo "🧹 Initializing environment..."
pkill -9 -f "generate_campaign_v2.ts" || true
pkill -9 -f "runner.ts" || true
pkill -9 -f "chrome" || true
pkill -9 -f "chromium" || true
sleep 2

echo "Query: $QUERY"
echo "Provinces: $PROVINCES"
echo "Concurrency: $MAX_CONCURRENCY (Scraper) / $RUNNER_CONCURRENCY_LIMIT (Enricher)"

# RECORD START TIME for output checking
START_TS=$(date +%s)

# 3. GENERATE CAMPAIGN (Phase 1-3) - BLOCKING
echo "--- 📡 PHASE 1: GENERATING CAMPAIGN DATA ---"
echo "🔍 Logs: output/generation_lombardia.log"
npx ts-node src/scraper/generate_campaign_v2.ts \
    --query="$QUERY" \
    --provinces="$PROVINCES" \
    > output/generation_lombardia.log 2>&1

echo "✅ GENERATION FINISHED."

# INTERMEDIATE CLEANUP
echo "🧹 Post-generation cleanup..."
pkill -9 -f "chrome" || true
pkill -9 -f "chromium" || true
sleep 2

# CHECK IF ANY FILE WAS GENERATED
LATEST_CSV=$(ls -t output/campaigns/*.csv 2>/dev/null | head -n 1)
if [ -z "$LATEST_CSV" ]; then
    echo "❌ NO CSV FOUND in output/campaigns/. Generation probably failed."
    exit 1
fi

CSV_MTIME=$(stat -c %Y "$LATEST_CSV")
if [ "$CSV_MTIME" -lt "$START_TS" ]; then
    echo "⚠️ NO NEW CSV generated in this run. (Latest is from a previous run)."
    echo "Aborting sequential enrichment to avoid redundant processing."
    exit 1
fi

echo "🚀 NEW DATA DETECTED: $LATEST_CSV"

# 4. LAUNCH ENRICHMENT (Phase 4-5) - BLOCKING
echo "--- 🚀 PHASE 2: LAUNCHING ENRICHMENT LOOP ---"
echo "🔍 Logs: output/enrichment_lombardia.log"
# Loop uses the latest CSV
./ops/loop_meccatronica.sh > output/enrichment_lombardia.log 2>&1

