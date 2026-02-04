#!/bin/bash
# 🚀 MECCATRONICA ENRICHMENT LOOP 🚀

cd "$(dirname "$0")" || exit 1

INPUT_FILE="input_new_campaign_meccatronica.csv"

echo "--- 🚀 STARTING MECCATRONICA ENRICHMENT $(date) 🚀 ---" >> output/enrichment_meccatronica.log

while true; do
  echo "[LOOP] Starting enrichment at $(date)..." >> output/enrichment_meccatronica.log
  
  # Run the enrichment batch for 1 hour or until completion
  npx ts-node run_bulletproof_batch.ts "$INPUT_FILE" >> output/enrichment_meccatronica.log 2>&1
  EXIT_CODE=$?
  
  echo "[LOOP] Process exited with code $EXIT_CODE." >> output/enrichment_meccatronica.log
  
  # Cleanup zombie processes
  echo "[LOOP] Cleaning zombie Chromes..." >> output/enrichment_meccatronica.log
  pkill -f chrome || true
  
  # Wait before restart
  echo "[LOOP] Restarting in 5s..." >> output/enrichment_meccatronica.log
  sleep 5
done
