#!/bin/bash
# MECCATRONICA ENRICHMENT LOOP
# BUG-02 FIX: Graceful Chrome cleanup instead of pkill

cd "$(dirname "$0")/.." || exit 1

LOG_FILE="output/enrichment_meccatronica.log"
LOG_MAX_BYTES=$((50 * 1024 * 1024))  # 50 MB

# Rotate log if it exceeds the size limit (keeps 1 backup)
rotate_log() {
  if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt "$LOG_MAX_BYTES" ]; then
      mv "$LOG_FILE" "${LOG_FILE}.1"
      echo "[LOOP] Log rotated at $(date) (was ${LOG_SIZE} bytes)" > "$LOG_FILE"
    fi
  fi
}

# Trova l'ultimo file CSV generato nella cartella campaigns del modulo di generazione
LATEST_INPUT=$(ls -t output/campaigns/*.csv 2>/dev/null | head -n 1)

if [ -z "$LATEST_INPUT" ]; then
  INPUT_FILE="input_phase1_cleaned.csv"
  echo "[LOOP] WARNING: No campaign files found. Using fallback: $INPUT_FILE"
else
  INPUT_FILE="$LATEST_INPUT"
  echo "[LOOP] AUTO-DETECTED LATEST CAMPAIGN: $INPUT_FILE"
fi

rotate_log
echo "--- STARTING MECCATRONICA ENRICHMENT $(date) ---" >> "$LOG_FILE"

# Graceful cleanup function: send SIGTERM first, then SIGKILL after timeout
cleanup_chrome() {
  echo "[LOOP] Graceful Chrome cleanup..." >> "$LOG_FILE"

  # Match only Chrome/Chromium processes using our temp_profiles directory
  # This avoids killing the user's personal browser sessions
  CHROME_PIDS=$(pgrep -f "chromium.*temp_profiles|chrome.*temp_profiles" -U "$(id -u)" 2>/dev/null || true)

  if [ -n "$CHROME_PIDS" ]; then
    # Send SIGTERM (graceful shutdown)
    echo "$CHROME_PIDS" | xargs kill -TERM 2>/dev/null || true

    # Wait up to 5 seconds for graceful exit
    for i in 1 2 3 4 5; do
      REMAINING=$(pgrep -f "chromium.*temp_profiles|chrome.*temp_profiles" -U "$(id -u)" 2>/dev/null || true)
      if [ -z "$REMAINING" ]; then
        echo "[LOOP] All Chrome processes exited gracefully." >> "$LOG_FILE"
        return
      fi
      sleep 1
    done

    # Force kill remaining zombies
    REMAINING=$(pgrep -f "chromium.*temp_profiles|chrome.*temp_profiles" -U "$(id -u)" 2>/dev/null || true)
    if [ -n "$REMAINING" ]; then
      echo "[LOOP] Force killing remaining zombie Chrome processes." >> "$LOG_FILE"
      echo "$REMAINING" | xargs kill -9 2>/dev/null || true
    fi
  else
    echo "[LOOP] No Chrome processes to clean." >> "$LOG_FILE"
  fi

  # Clean up temporary browser profiles
  if [ -d "temp_profiles" ]; then
    rm -rf temp_profiles/browser_* 2>/dev/null || true
    echo "[LOOP] Cleaned temp_profiles." >> "$LOG_FILE"
  fi
}

# Trap signals for clean shutdown
trap 'echo "[LOOP] Received shutdown signal."; cleanup_chrome; exit 0' SIGINT SIGTERM

while true; do
  rotate_log
  echo "[LOOP] Starting enrichment at $(date)..." >> "$LOG_FILE"

  # Run the enrichment batch
  npx ts-node src/enricher/runner.ts "$INPUT_FILE" >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?

  echo "[LOOP] Process exited with code $EXIT_CODE." >> "$LOG_FILE"

  # Graceful cleanup instead of pkill
  cleanup_chrome

  # Wait before restart
  echo "[LOOP] Restarting in 5s..." >> "$LOG_FILE"
  sleep 5
done
