#!/bin/bash
# 🚀 BULLETPROOF LOOP SCRIPT 🚀
# Ensures the scraper runs indefinitely and recovers from crashes/memory leaks.

# cd /root/scraper/PG-Step3-Enrichment || exit 1
cd "$(dirname "$0")" || exit 1

echo "--- 🚀 GOD MODE RESTART 🚀 ---" >> output/bulletproof.log

while true; do
  echo "[LOOP] Starting batch execution at $(date)..." >> output/bulletproof.log
  
  # Run the scraper
  npx ts-node run_bulletproof_batch.ts input_phase1_cleaned.csv >> output/bulletproof.log 2>&1
  EXIT_CODE=$?
  
  echo "[LOOP] Process exited with code $EXIT_CODE." >> output/bulletproof.log
  
  # Cleanup
  echo "[LOOP] Cleaning zombie Chromes..." >> output/bulletproof.log
  pkill -f chrome || true
  pkill -f google-chrome || true
  
  # Wait before restart
  echo "[LOOP] Restarting batch in 2s..." >> output/bulletproof.log
  sleep 2
done
