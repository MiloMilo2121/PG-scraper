#!/bin/bash
# 🚀 OMEGA V7 - PHASE 2: MASSIVE WEBSITE DISCOVERY
# Target: Elaborazione streaming dei `MASTER_CONSOLIDATED.csv` generati dalla Fase 1.
# Features: Merge automatico, Checkpoint automatico per riprendere dal crash, Streaming RAM-safe.

set -e

echo "=========================================================="
echo "🌐 STARTING PHASE 2: WEBSITE DISCOVERY (STREAMING RUNNER)"
echo "=========================================================="

# 1. Merge Campaign Files
echo "🔗 STEP 1: Consolidating Phase 1 CSV campaigns..."
npx ts-node src/scripts/merge_campaigns.ts

# 2. Find the newly generated Master file
DATE_STR=$(date -I)
MASTER_CSV="output_server/campaigns/MASTER_CONSOLIDATED_${DATE_STR}.csv"

if [ ! -f "$MASTER_CSV" ]; then
    echo "❌ ERROR: Master CSV not found at $MASTER_CSV"
    echo "Falling back to local output directory..."
    MASTER_CSV="output/campaigns/MASTER_CONSOLIDATED_${DATE_STR}.csv"
    if [ ! -f "$MASTER_CSV" ]; then
        echo "❌ FATAL: Cannot find any consolidated CSV to process."
        exit 1
    fi
fi

echo "✅ MASTER CSV FOUND: $MASTER_CSV"

# 3. Launch Resilient Streaming Engine
echo "🚀 STEP 2: Launching Engine (V6 Streaming Mode) on Master File..."
echo "ℹ️ Note: If a previous run crashed, the engine will automatically read the output file length and resume from where it left off."

npx ts-node src/foundation/RunnerV6.ts "$MASTER_CSV"

echo "=========================================================="
echo "🎯 PHASE 2: WEBSITE DISCOVERY COMPLETE!"
echo "=========================================================="
