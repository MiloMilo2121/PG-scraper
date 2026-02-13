#!/bin/bash
# 🏭 MISSION: LOMBARDIA MANIFATTURA 🏭
# Target: Impianti, Officine Meccaniche, Manifatturiero
# Area: MI, PV, BG, LO, CR
# Server: Hetzner (High Power)

set -euo pipefail

# 1. SETUP ENVIRONMENT FOR MAX POWER
export MAX_CONCURRENCY=20
export RUNNER_CONCURRENCY_LIMIT=50
export SCRAPE_DO_ENFORCE=false
export HEADLESS=true
export LLM_MODEL_SMART="glm-4-plus"
export AI_MODEL_SMART="glm-4-plus"

# 🔑 ROOT CAUSE FIX: .env has PROXY_RESIDENTIAL_URL pointing to expired scrape.do proxy.
# Chrome launches with --proxy-server=proxy.scrape.do:8080, ALL navigations fail instantly
# with "Attempted to use detached Frame" because Chrome can't route through dead proxy.
# Fix: Bypass proxy entirely — PG and Maps work fine from Hetzner DC IP.
export DISABLE_PROXY=true
export DISABLE_STEALTH=true

# 2. DEFINE TARGETS - MANUAL OVERRIDE (LLM Bypass)
# Specific categories from pg_categories.ts to ensure coverage without LLM errors
QUERY="Impiantistica industriale,Officine meccaniche,Officine meccaniche di precisione,Officine metalmeccaniche,Lavorazioni meccaniche,Costruzioni meccaniche,Produzione industriale,Manifattura"
PROVINCES="MI,PV,BG,LO,CR"

echo "--- 🏭 STARTING MISSION LOMBARDIA MANIFATTURA 🏭 ---"
echo "🧹 Cleaning up previous instances..."
pkill -f "generate_campaign_v2.ts" || true
pkill -f "runner.ts" || true

echo "Query: $QUERY"
echo "Provinces: $PROVINCES"
echo "Concurrency: $MAX_CONCURRENCY (Browsers) / $RUNNER_CONCURRENCY_LIMIT (Enricher)"

# 3. GENERATE CAMPAIGN (Phase 1-3)
echo "--- 📡 GENERATING CAMPAIGN DATA ---"
echo "🔍 Logs: output/generation_lombardia.log"
nohup npx ts-node src/scraper/generate_campaign_v2.ts \
    --query="$QUERY" \
    --provinces="$PROVINCES" \
    > output/generation_lombardia.log 2>&1 &

# 4. LAUNCH ENRICHMENT (Phase 4-5)
echo "--- 🚀 LAUNCHING ENRICHMENT LOOP ---"
echo "🔍 Logs: output/enrichment_lombardia.log"
# We use the existing loop_meccatronica.sh which auto-detects the latest CSV
nohup ./ops/loop_meccatronica.sh > output/enrichment_lombardia.log 2>&1 &

echo "✅ MISSION LAUNCHED DETACHED!"
echo "📄 Generator Logs: output/generation_lombardia.log"
echo "📄 Enricher Logs: output/enrichment_lombardia.log"
