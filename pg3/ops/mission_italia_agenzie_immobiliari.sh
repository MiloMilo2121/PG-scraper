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

MISSION_TAG="${MISSION_TAG:-italia_agenzie_immobiliari}"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
MISSION_ID="${MISSION_TAG}_${TIMESTAMP}"
MISSION_DIR="output/missions/${MISSION_ID}"
MASTER_LOG="${MISSION_DIR}/mission.log"
SHARD_CHECKPOINT_FILE="${MISSION_DIR}/shard_checkpoint.txt"
QUERY="${QUERY:-Agenzie immobiliari}"

PROVINCE_SHARDS=(
  "AG,AL,AN,AO,AR,AP,AT,AV,BA,BT,BL,BN"
  "BG,BI,BO,BZ,BS,BR,CA,CL,CB,CE,CT,CZ"
  "CH,CO,CS,CR,KR,CN,EN,FM,FE,FI,FG,FC"
  "FR,GE,GO,GR,IM,IS,SP,AQ,LT,LE,LC,LI"
  "LO,LU,MC,MN,MS,MT,ME,MI,MO,MB,NA,NO"
  "NU,OR,PD,PA,PR,PV,PG,PU,PE,PC,PI,PT"
  "PN,PZ,PO,RG,RA,RC,RE,RI,RN,RM,RO,SA"
  "SS,SV,SI,SR,SO,SU,TA,TE,TR,TO,TP,TN"
  "TV,TS,UD,VA,VE,VB,VC,VR,VV,VI,VT"
)

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

timestamp_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  local message="$1"
  printf '[%s] %s\n' "$(timestamp_now)" "$message" | tee -a "$MASTER_LOG"
}

mkdir -p "$MISSION_DIR" output/campaigns

export HEADLESS="${HEADLESS:-true}"
export CHROME_BIN="${CHROME_BIN:-$(resolve_chrome_bin)}"
export CHROME_PATH="${CHROME_PATH:-$CHROME_BIN}"
export SCRAPER_TARGET_CONCURRENCY="${SCRAPER_TARGET_CONCURRENCY:-3}"
export SCRAPER_PREFLIGHT_CONCURRENCY="${SCRAPER_PREFLIGHT_CONCURRENCY:-3}"
export CONCURRENCY_LIMIT="${CONCURRENCY_LIMIT:-3}"
export DISABLE_PROXY="${DISABLE_PROXY:-false}"
export DISABLE_STEALTH="${DISABLE_STEALTH:-false}"

if [ -z "$CHROME_BIN" ]; then
  echo "❌ Chromium binary not found. Set CHROME_BIN/CHROME_PATH explicitly." >&2
  exit 1
fi

TOTAL_SHARDS="${#PROVINCE_SHARDS[@]}"
START_SHARD=0
if [ -f "$SHARD_CHECKPOINT_FILE" ]; then
  START_SHARD="$(cat "$SHARD_CHECKPOINT_FILE")"
fi

{
  echo "MISSION_ID=$MISSION_ID"
  echo "QUERY=$QUERY"
  echo "TOTAL_SHARDS=$TOTAL_SHARDS"
  echo "SCRAPER_TARGET_CONCURRENCY=$SCRAPER_TARGET_CONCURRENCY"
  echo "SCRAPER_PREFLIGHT_CONCURRENCY=$SCRAPER_PREFLIGHT_CONCURRENCY"
  echo "CHROME_PATH=$CHROME_PATH"
} > "${MISSION_DIR}/mission.env"

log "=========================================================="
log "🏠 STARTING ITALIA AGENZIE IMMOBILIARI SCRAPE MISSION"
log "Mission ID: ${MISSION_ID}"
log "Query: ${QUERY}"
log "Shards: ${TOTAL_SHARDS}"
log "Resume shard index: ${START_SHARD}"
log "=========================================================="

for (( idx=START_SHARD; idx<TOTAL_SHARDS; idx++ )); do
  shard_no=$((idx + 1))
  provinces="${PROVINCE_SHARDS[$idx]}"
  shard_slug="$(printf 'shard_%02d' "$shard_no")"
  shard_log="${MISSION_DIR}/${shard_slug}.log"
  shard_checkpoint_csv="${MISSION_DIR}/${shard_slug}_checkpoint.csv"
  shard_combined_copy="${MISSION_DIR}/${shard_slug}_combined.csv"

  log "▶️  Starting ${shard_slug}/${TOTAL_SHARDS}: provinces=${provinces}"

  if npx ts-node src/scraper/generate_campaign_v2.ts \
    --query="${QUERY}" \
    --provinces="${provinces}" \
    --checkpoint-file="${shard_checkpoint_csv}" \
    --resume > "${shard_log}" 2>&1; then
    latest_combined="$(ls -t output/campaigns/campaign_COMBINED_*.csv 2>/dev/null | head -n 1 || true)"
    if [ -n "${latest_combined}" ]; then
      cp "${latest_combined}" "${shard_combined_copy}"
      log "✅ ${shard_slug} complete. Combined snapshot: ${shard_combined_copy}"
    else
      log "⚠️ ${shard_slug} complete but no combined CSV found in output/campaigns"
    fi

    echo "$((idx + 1))" > "$SHARD_CHECKPOINT_FILE"
    sleep 10
  else
    log "❌ ${shard_slug} failed. Check ${shard_log}"
    exit 1
  fi
done

python3 - <<'PY' "$MISSION_DIR"
import csv
import sys
from pathlib import Path

mission_dir = Path(sys.argv[1])
shard_files = sorted(mission_dir.glob('shard_*_combined.csv'))
if not shard_files:
    raise SystemExit(0)

def normalize_row(row):
    normalized = {}
    for key, value in row.items():
        normalized[key] = (value or '').strip()
    return normalized

def merge_rows(base, incoming):
    for key, value in incoming.items():
        if value and not base.get(key):
            base[key] = value
    return base

merged = {}
fieldnames = []
for shard_file in shard_files:
    with shard_file.open(newline='', encoding='utf-8') as fh:
      reader = csv.DictReader(fh)
      if reader.fieldnames:
        for field in reader.fieldnames:
          if field not in fieldnames:
            fieldnames.append(field)
      for raw_row in reader:
        row = normalize_row(raw_row)
        key = (
          row.get('company_name', '').lower(),
          ''.join(ch for ch in row.get('phone', '') if ch.isdigit()),
          row.get('address', '').lower(),
          row.get('province', '').upper(),
        )
        if key in merged:
          merged[key] = merge_rows(merged[key], row)
        else:
          merged[key] = row

output_file = mission_dir / 'campaign_COMBINED_italia_agenzie_immobiliari.csv'
with output_file.open('w', newline='', encoding='utf-8') as fh:
    writer = csv.DictWriter(fh, fieldnames=fieldnames)
    writer.writeheader()
    for row in merged.values():
        writer.writerow({field: row.get(field, '') for field in fieldnames})
PY

rm -f "$SHARD_CHECKPOINT_FILE"
log "✅ Mission complete. Final combined CSV: ${MISSION_DIR}/campaign_COMBINED_italia_agenzie_immobiliari.csv"
