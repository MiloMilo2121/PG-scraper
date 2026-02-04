#!/bin/bash
# 🚀 MECCATRONICA ENRICHMENT LOOP 🚀

cd "$(dirname "$0")" || exit 1

# Trova l'ultimo file CSV generato nella cartella campaigns del modulo di generazione
# (Supponendo che vengano generati in output/campaigns/ o nella directory corrente)
LATEST_INPUT=$(ls -t output/campaigns/*.csv 2>/dev/null | head -n 1)

if [ -z "$LATEST_INPUT" ]; then
  # Fallback se non trova CSV nelle campaigns (es. se lanciato da root)
  INPUT_FILE="input_phase1_cleaned.csv"
  echo "[LOOP] WARNING: No campaign files found. Using fallback: $INPUT_FILE"
else
  INPUT_FILE="$LATEST_INPUT"
  echo "[LOOP] AUTO-DETECTED LATEST CAMPAIGN: $INPUT_FILE"
fi

echo "--- 🚀 STARTING MECCATRONICA ENRICHMENT $(date) 🚀 ---" >> output/enrichment_meccatronica.log

while true; do
  echo "[LOOP] Starting enrichment at $(date)..." >> output/enrichment_meccatronica.log
  
  # Run the enrichment batch for 1 hour or until completion
  npx ts-node src/enricher/runner.ts "$INPUT_FILE" >> output/enrichment_meccatronica.log 2>&1
  EXIT_CODE=$?
  
  echo "[LOOP] Process exited with code $EXIT_CODE." >> output/enrichment_meccatronica.log
  
  # Cleanup zombie processes
  echo "[LOOP] Cleaning zombie Chromes..." >> output/enrichment_meccatronica.log
  pkill -f chrome || true
  
  # Wait before restart
  echo "[LOOP] Restarting in 5s..." >> output/enrichment_meccatronica.log
  sleep 5
done
