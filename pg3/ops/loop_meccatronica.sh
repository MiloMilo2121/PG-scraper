#!/bin/bash
# MECCATRONICA ENRICHMENT LOOP
# BUG-02 FIX: Graceful Chrome cleanup instead of pkill

cd "$(dirname "$0")/.." || exit 1

# Trova l'ultimo file CSV generato nella cartella campaigns del modulo di generazione
LATEST_INPUT=$(ls -t output/campaigns/*.csv 2>/dev/null | head -n 1)

if [ -z "$LATEST_INPUT" ]; then
  INPUT_FILE="input_phase1_cleaned.csv"
  echo "[LOOP] WARNING: No campaign files found. Using fallback: $INPUT_FILE"
else
  INPUT_FILE="$LATEST_INPUT"
  echo "[LOOP] AUTO-DETECTED LATEST CAMPAIGN: $INPUT_FILE"
fi

echo "--- STARTING MECCATRONICA ENRICHMENT $(date) ---" >> output/enrichment_meccatronica.log

# Graceful cleanup function: send SIGTERM first, then SIGKILL after timeout
cleanup_chrome() {
  echo "[LOOP] Graceful Chrome cleanup..." >> output/enrichment_meccatronica.log

  # Find Chrome/Chromium processes spawned by this user
  CHROME_PIDS=$(pgrep -f "chromium|chrome" -U "$(id -u)" 2>/dev/null || true)

  if [ -n "$CHROME_PIDS" ]; then
    # Send SIGTERM (graceful shutdown)
    echo "$CHROME_PIDS" | xargs kill -TERM 2>/dev/null || true

    # Wait up to 5 seconds for graceful exit
    for i in 1 2 3 4 5; do
      REMAINING=$(pgrep -f "chromium|chrome" -U "$(id -u)" 2>/dev/null || true)
      if [ -z "$REMAINING" ]; then
        echo "[LOOP] All Chrome processes exited gracefully." >> output/enrichment_meccatronica.log
        return
      fi
      sleep 1
    done

    # Force kill remaining zombies
    REMAINING=$(pgrep -f "chromium|chrome" -U "$(id -u)" 2>/dev/null || true)
    if [ -n "$REMAINING" ]; then
      echo "[LOOP] Force killing remaining zombie Chrome processes." >> output/enrichment_meccatronica.log
      echo "$REMAINING" | xargs kill -9 2>/dev/null || true
    fi
  else
    echo "[LOOP] No Chrome processes to clean." >> output/enrichment_meccatronica.log
  fi

  # Clean up temporary browser profiles
  if [ -d "temp_profiles" ]; then
    rm -rf temp_profiles/browser_* 2>/dev/null || true
    echo "[LOOP] Cleaned temp_profiles." >> output/enrichment_meccatronica.log
  fi
}

# Trap signals for clean shutdown
trap 'echo "[LOOP] Received shutdown signal."; cleanup_chrome; exit 0' SIGINT SIGTERM

while true; do
  echo "[LOOP] Starting enrichment at $(date)..." >> output/enrichment_meccatronica.log

  # Run the enrichment batch
  npx ts-node src/enricher/runner.ts "$INPUT_FILE" >> output/enrichment_meccatronica.log 2>&1
  EXIT_CODE=$?

  echo "[LOOP] Process exited with code $EXIT_CODE." >> output/enrichment_meccatronica.log

  # Graceful cleanup instead of pkill
  cleanup_chrome

  # Wait before restart
  echo "[LOOP] Restarting in 5s..." >> output/enrichment_meccatronica.log
  sleep 5
done
