#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

MISSION_TAG="${MISSION_TAG:-lombardia_manifattura}"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
MISSION_ID="${MISSION_TAG}_${TIMESTAMP}"
MISSION_DIR="output/missions/${MISSION_ID}"
GENERATION_LOG="${MISSION_DIR}/generation.log"
E2E_LOG="${MISSION_DIR}/e2e.log"
META_FILE="${MISSION_DIR}/mission.env"

QUERY="${QUERY:-Officine meccaniche,Officine meccaniche di precisione,Officine metalmeccaniche,Lavorazioni meccaniche,Costruzioni meccaniche,Carpenterie metalliche,Tornerie metalli,Fonderie,Stampaggio metalli,Stampaggio materie plastiche,Lavorazione materie plastiche,Automazione industriale,Assemblaggi industriali,Impiantistica industriale,Produzione industriale,Manifattura}"
PROVINCES="${PROVINCES:-BG,BS,CO,CR,LC,LO,MN,MI,MB,PV,SO,VA}"

mkdir -p "$MISSION_DIR" output/campaigns data

resolve_chrome_bin() {
  if [ -n "${CHROME_BIN:-}" ] && [ -x "${CHROME_BIN}" ]; then
    echo "${CHROME_BIN}"
    return
  fi

  for candidate in /usr/bin/chromium-browser /usr/bin/chromium /snap/bin/chromium; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done

  if command -v chromium-browser >/dev/null 2>&1; then
    command -v chromium-browser
    return
  fi

  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return
  fi

  echo ""
}

export HEADLESS="${HEADLESS:-true}"
export SCRAPE_DO_ENFORCE="${SCRAPE_DO_ENFORCE:-false}"
export DISABLE_PROXY="${DISABLE_PROXY:-true}"
export DISABLE_STEALTH="${DISABLE_STEALTH:-true}"
export MAX_CONCURRENCY="${MAX_CONCURRENCY:-4}"
export CONCURRENCY_LIMIT="${CONCURRENCY_LIMIT:-4}"
export RUNNER_CONCURRENCY_LIMIT="${RUNNER_CONCURRENCY_LIMIT:-4}"
export CHROME_BIN="${CHROME_BIN:-$(resolve_chrome_bin)}"
export CHROME_PATH="${CHROME_PATH:-$CHROME_BIN}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/15}"
export SCRAPER_RESUME="${SCRAPER_RESUME:-false}"

if [ -z "$CHROME_BIN" ]; then
  echo "❌ Chromium binary not found. Set CHROME_BIN/CHROME_PATH explicitly." >&2
  exit 1
fi

write_meta() {
  {
    echo "MISSION_ID=$MISSION_ID"
    echo "MISSION_DIR=$MISSION_DIR"
    echo "QUERY=$QUERY"
    echo "PROVINCES=$PROVINCES"
    echo "REDIS_URL=$REDIS_URL"
    echo "MAX_CONCURRENCY=$MAX_CONCURRENCY"
    echo "CONCURRENCY_LIMIT=$CONCURRENCY_LIMIT"
    echo "RUNNER_CONCURRENCY_LIMIT=$RUNNER_CONCURRENCY_LIMIT"
    echo "CHROME_PATH=$CHROME_PATH"
  } > "$META_FILE"
}

ensure_redis() {
  if (echo > /dev/tcp/127.0.0.1/6379) >/dev/null 2>&1; then
    return
  fi

  if docker compose version >/dev/null 2>&1; then
    docker compose up -d redis >/dev/null
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d redis >/dev/null
    return
  fi

  if docker ps --format '{{.Names}}' | grep -qx 'antigravity-redis'; then
    return
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx 'antigravity-redis'; then
    docker start antigravity-redis >/dev/null
    return
  fi

  docker run -d \
    --name antigravity-redis \
    --restart unless-stopped \
    -p 6379:6379 \
    redis:7-alpine \
    redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru >/dev/null
}

find_latest_combined_csv() {
  ls -t output/campaigns/campaign_COMBINED_*.csv 2>/dev/null | head -n 1
}

write_meta

echo "=========================================================="
echo "🏭 STARTING LOMBARDIA MANIFATTURA E2E MISSION"
echo "=========================================================="
echo "Mission ID: $MISSION_ID"
echo "Query: $QUERY"
echo "Provinces: $PROVINCES"
echo "Logs:"
echo "  - $GENERATION_LOG"
echo "  - $E2E_LOG"

ensure_redis

START_TS="$(date +%s)"

echo "--- 📡 PHASE 1: SCRAPING / CAMPAIGN GENERATION ---"
SCRAPER_ARGS=(
  "--query=$QUERY"
  "--provinces=$PROVINCES"
)

if [ "$SCRAPER_RESUME" = "true" ]; then
  SCRAPER_ARGS+=("--resume")
fi

npx ts-node src/scraper/generate_campaign_v2.ts "${SCRAPER_ARGS[@]}" > "$GENERATION_LOG" 2>&1

LATEST_CSV="$(find_latest_combined_csv)"
if [ -z "$LATEST_CSV" ]; then
  echo "❌ No combined CSV found under output/campaigns." >&2
  exit 1
fi

CSV_MTIME="$(stat -c %Y "$LATEST_CSV" 2>/dev/null || stat -f %m "$LATEST_CSV")"
if [ "$CSV_MTIME" -lt "$START_TS" ]; then
  echo "❌ Latest combined CSV predates this mission: $LATEST_CSV" >&2
  exit 1
fi

cp "$LATEST_CSV" "${MISSION_DIR}/input_campaign.csv"
echo "LATEST_CSV=$LATEST_CSV" >> "$META_FILE"
echo "COPIED_INPUT=${MISSION_DIR}/input_campaign.csv" >> "$META_FILE"

echo "--- 🚀 PHASE 2: ENRICHMENT E2E ---"
bash scripts/run_e2e_enrichment.zsh "${MISSION_DIR}/input_campaign.csv" "$MISSION_TAG" > "$E2E_LOG" 2>&1

TEST_ID="$(grep '^READY:' "$E2E_LOG" | tail -n 1 | awk '{print $2}')"
if [ -z "$TEST_ID" ]; then
  echo "❌ E2E enrichment finished without READY marker. Check $E2E_LOG" >&2
  exit 1
fi

TEST_DIR="output/e2e_tests/${TEST_ID}"
SUMMARY_PATH="${TEST_DIR}/summary.json"

echo "TEST_ID=$TEST_ID" >> "$META_FILE"
echo "TEST_DIR=$TEST_DIR" >> "$META_FILE"
echo "SUMMARY_PATH=$SUMMARY_PATH" >> "$META_FILE"

if [ -f "$SUMMARY_PATH" ]; then
  cp "$SUMMARY_PATH" "${MISSION_DIR}/summary.json"
  echo "--- ✅ SUMMARY ---"
  cat "$SUMMARY_PATH"
else
  echo "⚠️ Summary file missing: $SUMMARY_PATH"
fi

echo "✅ Mission complete."
echo "Mission directory: $MISSION_DIR"
echo "E2E directory: $TEST_DIR"
