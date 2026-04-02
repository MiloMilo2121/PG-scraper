#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

for dotenv_file in ".env" ".env.local"; do
  if [ -f "$dotenv_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$dotenv_file"
    set +a
  fi
done

MISSION_TAG="${MISSION_TAG:-lombardia_immobiliare_it}"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
MISSION_ID="${MISSION_TAG}_${TIMESTAMP}"
MISSION_DIR="output/missions/${MISSION_ID}"
LOG_FILE="${MISSION_DIR}/mission.log"
CHECKPOINT_FILE="${MISSION_DIR}/campaign_checkpoint.csv"
OUTPUT_FILE="${MISSION_DIR}/campaign_COMBINED_lombardia_immobiliare.csv"
QUERY="${QUERY:-Agenzie immobiliari}"
PROVINCES="${PROVINCES:-BG,BS,CO,CR,LC,LO,MN,MB,MI,PV,SO,VA}"

mkdir -p "$MISSION_DIR" output/campaigns

export HEADLESS="${HEADLESS:-true}"
export DISABLE_PROXY="${DISABLE_PROXY:-false}"
export SCRAPER_TARGET_CONCURRENCY="${SCRAPER_TARGET_CONCURRENCY:-3}"
export SCRAPER_PREFLIGHT_CONCURRENCY="${SCRAPER_PREFLIGHT_CONCURRENCY:-3}"
export CONCURRENCY_LIMIT="${CONCURRENCY_LIMIT:-3}"

{
  echo "MISSION_ID=${MISSION_ID}"
  echo "QUERY=${QUERY}"
  echo "PROVINCES=${PROVINCES}"
  echo "HEADLESS=${HEADLESS}"
  echo "DISABLE_PROXY=${DISABLE_PROXY}"
  echo "SCRAPER_TARGET_CONCURRENCY=${SCRAPER_TARGET_CONCURRENCY}"
  echo "SCRAPER_PREFLIGHT_CONCURRENCY=${SCRAPER_PREFLIGHT_CONCURRENCY}"
} > "${MISSION_DIR}/mission.env"

echo "[Immobiliare] Starting Lombardia mission ${MISSION_ID}" | tee "$LOG_FILE"
npx ts-node src/scraper/generate_campaign_v2.ts \
  --query="${QUERY}" \
  --provinces="${PROVINCES}" \
  --checkpoint-file="${CHECKPOINT_FILE}" \
  --resume \
  --include-immobiliare >> "$LOG_FILE" 2>&1

LATEST_COMBINED="$(ls -t output/campaigns/campaign_COMBINED_*.csv 2>/dev/null | head -n 1 || true)"
if [ -n "$LATEST_COMBINED" ]; then
  cp "$LATEST_COMBINED" "$OUTPUT_FILE"
  echo "[Immobiliare] Copied combined CSV to ${OUTPUT_FILE}" | tee -a "$LOG_FILE"
else
  echo "[Immobiliare] Warning: no combined CSV found in output/campaigns" | tee -a "$LOG_FILE"
fi

echo "[Immobiliare] Completed. Output: ${OUTPUT_FILE}" | tee -a "$LOG_FILE"
