#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(/usr/bin/dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

for dotenv_file in ".env" ".env.local"; do
  if [[ -f "$dotenv_file" ]]; then
    set -a
    source "$dotenv_file"
    set +a
  fi
done

INPUT_CSV="${1:-}"
TEST_PREFIX="${2:-e2e}"

if [[ -z "$INPUT_CSV" || ! -f "$INPUT_CSV" ]]; then
  echo "Usage: zsh scripts/run_e2e_enrichment.zsh <input.csv> [test_prefix]" >&2
  exit 1
fi

TEST_ID="${TEST_PREFIX}_$(date +%Y%m%d_%H%M%S)"
OUT_DIR="output/e2e_tests/$TEST_ID"
DB_PATH="data/e2e_${TEST_ID}.db"

mkdir -p "$OUT_DIR"
cp "$INPUT_CSV" "$OUT_DIR/input.csv"

echo "$TEST_ID" > "$OUT_DIR/test_id.txt"
echo "$DB_PATH" > "$OUT_DIR/db_path.txt"

echo "test_id=$TEST_ID" > "$OUT_DIR/run_meta.txt"
echo "sqlite_path=$DB_PATH" >> "$OUT_DIR/run_meta.txt"
echo "node=$(node -v)" >> "$OUT_DIR/run_meta.txt"

echo "input_csv=$INPUT_CSV" >> "$OUT_DIR/run_meta.txt"

echo "cwd=$(pwd)" >> "$OUT_DIR/run_meta.txt"

# Defaults for isolated runs
export DISABLE_PROXY="${DISABLE_PROXY:-false}"
export DISABLE_STEALTH="${DISABLE_STEALTH:-false}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/15}"
export SQLITE_PATH="$DB_PATH"
export OUT_DIR
export WORKER_PROCESSES="${WORKER_PROCESSES:-1}"
export USE_DIST_RUNTIME="${USE_DIST_RUNTIME:-false}"
export E2E_WAIT_TIMEOUT_MINUTES="${E2E_WAIT_TIMEOUT_MINUTES:-720}"
export E2E_PROGRESS_POLL_SECONDS="${E2E_PROGRESS_POLL_SECONDS:-5}"
export REQUIRE_ORACLE_STEALTH="${REQUIRE_ORACLE_STEALTH:-true}"
export E2E_WORKER_READY_TIMEOUT_SECONDS="${E2E_WORKER_READY_TIMEOUT_SECONDS:-30}"
export E2E_BROWSER_PREFLIGHT="${E2E_BROWSER_PREFLIGHT:-false}"
export QUEUE_PREFIX="${QUEUE_PREFIX:-e2e_${TEST_ID}}"
export E2E_REDIS_FLUSH="${E2E_REDIS_FLUSH:-false}"

echo "env.DISABLE_PROXY=${DISABLE_PROXY:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.DISABLE_STEALTH=${DISABLE_STEALTH:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.REDIS_URL=${REDIS_URL:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.SCRAPE_DO_TOKEN=${SCRAPE_DO_TOKEN:+(set)}" >> "$OUT_DIR/run_meta.txt"
echo "env.PROXY_RESIDENTIAL_URL=${PROXY_RESIDENTIAL_URL:+(set)}" >> "$OUT_DIR/run_meta.txt"
echo "env.PROXY_DATACENTER_URL=${PROXY_DATACENTER_URL:+(set)}" >> "$OUT_DIR/run_meta.txt"
echo "env.CONCURRENCY_LIMIT=${CONCURRENCY_LIMIT:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.BACKPRESSURE_INITIAL_CONCURRENCY=${BACKPRESSURE_INITIAL_CONCURRENCY:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.BACKPRESSURE_MAX_CONCURRENCY=${BACKPRESSURE_MAX_CONCURRENCY:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.BROWSER_POOL_MAX_INSTANCES=${BROWSER_POOL_MAX_INSTANCES:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.E2E_WAIT_TIMEOUT_MINUTES=${E2E_WAIT_TIMEOUT_MINUTES:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.REQUIRE_ORACLE_STEALTH=${REQUIRE_ORACLE_STEALTH:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.E2E_WORKER_READY_TIMEOUT_SECONDS=${E2E_WORKER_READY_TIMEOUT_SECONDS:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.E2E_BROWSER_PREFLIGHT=${E2E_BROWSER_PREFLIGHT:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.QUEUE_PREFIX=${QUEUE_PREFIX:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.E2E_REDIS_FLUSH=${E2E_REDIS_FLUSH:-}" >> "$OUT_DIR/run_meta.txt"

typeset -a WORKER_PIDS=()
typeset -a WORKER_LOGS=()
typeset -gi E2E_ERROR_HANDLED=0

report_failure_context() {
  local exit_code="${1:-1}"
  echo "ERROR: E2E launcher failed with exit code ${exit_code}" >&2
  echo "ERROR: test_id=${TEST_ID}" >&2
  echo "ERROR: out_dir=${OUT_DIR}" >&2

  if [[ -f "$OUT_DIR/scheduler.log" ]]; then
    echo "--- scheduler.log (tail) ---" >&2
    /usr/bin/tail -n 80 "$OUT_DIR/scheduler.log" >&2 || true
  fi

  for worker_log in "${WORKER_LOGS[@]}"; do
    if [[ -f "$worker_log" ]]; then
      echo "--- ${worker_log} (tail) ---" >&2
      /usr/bin/tail -n 80 "$worker_log" >&2 || true
    fi
  done

  if [[ -f "$OUT_DIR/oracle_ensure.log" ]]; then
    echo "--- oracle_ensure.log (tail) ---" >&2
    /usr/bin/tail -n 80 "$OUT_DIR/oracle_ensure.log" >&2 || true
  fi
}

on_error() {
  local exit_code="$?"
  if (( E2E_ERROR_HANDLED == 0 )); then
    E2E_ERROR_HANDLED=1
    report_failure_context "$exit_code"
  fi
  exit "$exit_code"
}

cleanup() {
  for pid in "${WORKER_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}

redis_host_port_db() {
  python3 - "$REDIS_URL" <<'PY'
import sys
from urllib.parse import urlparse

url = sys.argv[1]
parsed = urlparse(url)
host = parsed.hostname or "127.0.0.1"
port = parsed.port or 6379
db = (parsed.path or "/0").lstrip("/") or "0"
print(f"{host} {port} {db}")
PY
}

is_local_redis_host() {
  local host="$1"
  [[ "$host" == "127.0.0.1" || "$host" == "localhost" || "$host" == "::1" ]]
}

check_redis_ready() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" PING >/dev/null 2>&1
    return $?
  fi

  local redis_host redis_port redis_db
  read -r redis_host redis_port redis_db <<<"$(redis_host_port_db)"
  python3 - "$redis_host" "$redis_port" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(2)
sock.connect((host, port))
sock.close()
PY
}

ensure_local_redis_container() {
  local redis_host redis_port redis_db
  read -r redis_host redis_port redis_db <<<"$(redis_host_port_db)"

  if ! is_local_redis_host "$redis_host"; then
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  if docker ps --format '{{.Names}}' | grep -qx 'antigravity-redis'; then
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx 'antigravity-redis'; then
    docker start antigravity-redis >/dev/null
    return 0
  fi

  docker run -d \
    --name antigravity-redis \
    --restart unless-stopped \
    -p "${redis_port}:6379" \
    redis:7-alpine \
    redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy noeviction >/dev/null
}

require_redis_ready() {
  if check_redis_ready; then
    return
  fi

  if ensure_local_redis_container; then
    /bin/sleep 1
    if check_redis_ready; then
      return
    fi
  fi

  echo "ERROR: Redis is unavailable at ${REDIS_URL}. Start Redis or set REDIS_URL to a reachable instance." >&2
  exit 3
}

flush_redis() {
  local redis_host redis_port redis_db
  read -r redis_host redis_port redis_db <<<"$(redis_host_port_db)"

  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" FLUSHDB > "$OUT_DIR/redis_flush.log" 2>&1
    return
  fi

  if ! is_local_redis_host "$redis_host"; then
    echo "ERROR: Cannot FLUSHDB on non-local REDIS_URL without redis-cli." >&2
    exit 4
  fi

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx 'antigravity-redis'; then
    docker exec antigravity-redis redis-cli -n "$redis_db" FLUSHDB > "$OUT_DIR/redis_flush.log" 2>&1
    return
  fi

  echo "ERROR: Unable to flush Redis: redis-cli missing and antigravity-redis container not running." >&2
  exit 4
}

browser_preflight() {
  if [[ "$E2E_BROWSER_PREFLIGHT" != "true" ]]; then
    return
  fi

  if [[ -n "${CHROME_PATH:-}" && -x "${CHROME_PATH}" ]]; then
    echo "browser_preflight=ok (CHROME_PATH=${CHROME_PATH})" >> "$OUT_DIR/run_meta.txt"
    return
  fi

  if [[ -n "${CHROME_BIN:-}" && -x "${CHROME_BIN}" ]]; then
    echo "browser_preflight=ok (CHROME_BIN=${CHROME_BIN})" >> "$OUT_DIR/run_meta.txt"
    return
  fi

  if node - <<'NODE' >/dev/null 2>&1
const fs = require('fs');
const { chromium } = require('playwright');
const path = chromium.executablePath();
if (!path || !fs.existsSync(path)) {
  process.exit(1);
}
NODE
  then
    echo "browser_preflight=ok (playwright chromium)" >> "$OUT_DIR/run_meta.txt"
    return
  fi

  echo "ERROR: Browser preflight failed. Set CHROME_PATH/CHROME_BIN or install Playwright Chromium." >&2
  exit 5
}

all_workers_alive() {
  for pid in "${WORKER_PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
  done
  return 0
}

workers_ready_in_logs() {
  local ready_count=0
  local worker_log
  for worker_log in "${WORKER_LOGS[@]}"; do
    if [[ -f "$worker_log" ]] && /usr/bin/grep -q 'Worker ready' "$worker_log"; then
      ready_count=$((ready_count + 1))
    fi
  done

  [[ "$ready_count" -eq "${#WORKER_LOGS[@]}" ]]
}

wait_for_worker_readiness() {
  local timeout_seconds="$1"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if ! all_workers_alive; then
      echo "ERROR: One or more worker processes exited before readiness." >&2
      return 1
    fi

    if workers_ready_in_logs; then
      return 0
    fi

    /bin/sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "ERROR: Workers did not become ready within ${timeout_seconds}s." >&2
  return 1
}
trap on_error ERR
trap cleanup EXIT

if [[ "$REQUIRE_ORACLE_STEALTH" == "true" ]]; then
  if ! /bin/bash ops/oracle/manage_oracle.sh ensure > "$OUT_DIR/oracle_ensure.log" 2>&1; then
    echo "ERROR: Oracle stealth is unavailable. See $OUT_DIR/oracle_ensure.log" >&2
    exit 2
  fi
fi

require_redis_ready
if [[ "$E2E_REDIS_FLUSH" == "true" ]]; then
  flush_redis
else
  echo "redis_flush=skipped (isolated queue prefix ${QUEUE_PREFIX})" >> "$OUT_DIR/run_meta.txt"
fi
browser_preflight

# Prefer source runtime by default so we do not execute stale dist artifacts.
if [[ "$USE_DIST_RUNTIME" == "true" && -f "dist/src/index.js" ]]; then
  WORKER_CMD=(node dist/src/index.js worker)
  SCHEDULER_CMD=(node dist/src/index.js scheduler "$OUT_DIR/input.csv")
else
  WORKER_CMD=(npx ts-node src/index.ts worker)
  SCHEDULER_CMD=(npx ts-node src/index.ts scheduler "$OUT_DIR/input.csv")
  export TS_NODE_TRANSPILE_ONLY=1
fi

echo "env.WORKER_PROCESSES=$WORKER_PROCESSES" >> "$OUT_DIR/run_meta.txt"
echo "env.USE_DIST_RUNTIME=$USE_DIST_RUNTIME" >> "$OUT_DIR/run_meta.txt"

# Start workers
worker_count=0
while (( worker_count < WORKER_PROCESSES )); do
  worker_count=$((worker_count + 1))
  worker_log="$OUT_DIR/worker.log"
  worker_pid_file="$OUT_DIR/worker.pid"
  if (( worker_count > 1 )); then
    worker_log="$OUT_DIR/worker_${worker_count}.log"
    worker_pid_file="$OUT_DIR/worker_${worker_count}.pid"
  fi

  "${WORKER_CMD[@]}" > "$worker_log" 2>&1 &
  worker_pid=$!
  WORKER_PIDS+=("$worker_pid")
  WORKER_LOGS+=("$worker_log")
  echo "$worker_pid" > "$worker_pid_file"
done

printf '%s\n' "${WORKER_PIDS[@]}" > "$OUT_DIR/worker_pids.txt"

if ! wait_for_worker_readiness "$E2E_WORKER_READY_TIMEOUT_SECONDS"; then
  exit 6
fi

# Run scheduler
"${SCHEDULER_CMD[@]}" > "$OUT_DIR/scheduler.log" 2>&1

if /usr/bin/grep -q 'Scheduler overlap detected' "$OUT_DIR/scheduler.log" 2>/dev/null; then
  echo "ERROR: Scheduler lock overlap detected. See $OUT_DIR/scheduler.log" >&2
  exit 7
fi

# Wait for all jobs to reach terminal state (SUCCESS/FAILED)
WORKER_PIDS_CSV="$(IFS=,; echo "${WORKER_PIDS[*]}")"
export WORKER_PIDS_CSV
python3 - <<'PY'
import os, sqlite3, time, sys

db_path = os.environ["SQLITE_PATH"]
timeout_minutes = int(os.environ.get("E2E_WAIT_TIMEOUT_MINUTES", "720"))
poll_seconds = float(os.environ.get("E2E_PROGRESS_POLL_SECONDS", "5"))
worker_pids = [int(pid) for pid in os.environ.get("WORKER_PIDS_CSV", "").split(",") if pid.strip()]

expected = None
for _ in range(180):
    if not os.path.exists(db_path):
        time.sleep(1)
        continue
    try:
        con = sqlite3.connect(db_path)
        cur = con.cursor()
        cur.execute("SELECT COUNT(*) FROM companies")
        expected = cur.fetchone()[0]
        con.close()
        if expected and expected > 0:
            break
    except Exception:
        time.sleep(1)

if not expected:
    print("ERROR: DB not ready or no companies inserted", file=sys.stderr)
    sys.exit(2)

print(f"Expected companies: {expected}")
if timeout_minutes > 0:
    print(f"Timeout budget: {timeout_minutes} minutes")
else:
    print("Timeout budget: unlimited")

deadline = time.time() + timeout_minutes * 60 if timeout_minutes > 0 else None
while True:
    for pid in worker_pids:
        try:
            os.kill(pid, 0)
        except OSError:
            print(f"ERROR: worker process {pid} exited during run", file=sys.stderr)
            sys.exit(4)

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT COUNT(DISTINCT company_id) FROM enrichment_results WHERE deleted_at IS NULL")
    enriched = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT company_id) FROM job_log WHERE status IN (\"SUCCESS\", \"FAILED\")")
    terminal = cur.fetchone()[0]
    con.close()

    print(f"progress: enriched={enriched} terminal={terminal}/{expected}")

    if terminal >= expected:
        break
    if deadline is not None and time.time() > deadline:
        print(f"ERROR: timeout waiting for jobs after {timeout_minutes} minutes", file=sys.stderr)
        sys.exit(3)
    time.sleep(poll_seconds)
PY

# Stop workers
cleanup
WORKER_PIDS=()

# Export joined results + summary
python3 - <<'PY'
import os, sqlite3, csv, json
from collections import Counter

db_path = os.environ["SQLITE_PATH"]
out_dir = os.environ.get("OUT_DIR")
if not out_dir:
    # When called from zsh, OUT_DIR is in the parent env; fallback to derive from db name.
    out_dir = os.path.join(os.getcwd(), 'output', 'e2e_tests', os.path.basename(db_path).replace('e2e_', '').replace('.db',''))

os.makedirs(out_dir, exist_ok=True)

con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row

query = """
SELECT
  c.id AS company_id,
  c.company_name,
  c.city,
  c.province,
  c.zip_code,
  c.region,
  c.address,
  c.phone,
  c.category,
  c.source,
  c.website AS original_website,
  c.vat_code AS input_vat_code,
  c.pg_url,
  c.email AS input_email,
  er.website_validated,
  er.vat,
  er.revenue,
  er.employees,
  er.is_estimated_employees,
  er.pec,
  er.email,
  er.decision_maker_name,
  er.decision_maker_role,
  er.decision_maker_linkedin_url,
  er.decision_maker_confidence,
  er.data_source AS enrichment_source,
  er.reason_code AS enrichment_reason_code,
  er.enriched_at,
  jl.status AS job_status,
  jl.attempt AS job_attempt,
  jl.duration_ms AS job_duration_ms,
  jl.error_category AS job_error_category,
  jl.error_message AS job_error_message,
  jl.reason_code AS job_reason_code,
  COALESCE(er.reason_code, jl.reason_code) AS final_reason_code,
  jl.processed_at AS job_processed_at
FROM companies c
LEFT JOIN (
  SELECT er1.*
  FROM enrichment_results er1
  WHERE er1.id = (
    SELECT er2.id
    FROM enrichment_results er2
    WHERE er2.company_id = er1.company_id AND er2.deleted_at IS NULL
    ORDER BY er2.updated_at DESC, er2.enriched_at DESC, er2.rowid DESC
    LIMIT 1
  )
) er ON er.company_id = c.id
LEFT JOIN (
  SELECT company_id, status, error_message, error_category, reason_code, duration_ms, attempt, processed_at
  FROM job_log
  WHERE id IN (SELECT MAX(id) FROM job_log GROUP BY company_id)
) jl ON jl.company_id = c.id
ORDER BY c.company_name COLLATE NOCASE
"""
rows = [dict(r) for r in con.execute(query).fetchall()]

json_path = os.path.join(out_dir, "enriched_results.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

csv_path = os.path.join(out_dir, "enriched_results.csv")
if rows:
    fieldnames = list(rows[0].keys())
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else r[k]) for k in fieldnames})

website_validated_count = sum(1 for r in rows if (r.get("website_validated") or "").strip())
vat_found_count = sum(1 for r in rows if (r.get("vat") or "").strip())
pec_found_count = sum(1 for r in rows if (r.get("pec") or "").strip())
email_found_count = sum(1 for r in rows if (r.get("email") or "").strip())
revenue_found_count = sum(1 for r in rows if (r.get("revenue") or "").strip())
employees_found_count = sum(1 for r in rows if (r.get("employees") or "").strip())
estimated_employees_count = sum(1 for r in rows if str(r.get("is_estimated_employees") or "0") in ("1", "true", "True"))
decision_maker_found_count = sum(1 for r in rows if (r.get("decision_maker_name") or "").strip())

job_status_counts = Counter((r.get("job_status") or "UNKNOWN") for r in rows)
final_reason_code_counts = Counter((r.get("final_reason_code") or "UNKNOWN") for r in rows)

summary = {
    "total_companies": len(rows),
    "job_status_counts": dict(job_status_counts),
    "final_reason_code_counts": dict(final_reason_code_counts),
    "website_validated_count": website_validated_count,
    "vat_found_count": vat_found_count,
    "pec_found_count": pec_found_count,
    "email_found_count": email_found_count,
    "revenue_found_count": revenue_found_count,
    "employees_found_count": employees_found_count,
    "estimated_employees_count": estimated_employees_count,
    "decision_maker_found_count": decision_maker_found_count,
}

summary_path = os.path.join(out_dir, "summary.json")
with open(summary_path, "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

con.close()
print("Wrote", json_path)
print("Wrote", csv_path)
print("Wrote", summary_path)
PY

# Mark done
{
  echo "ready=true"
  echo "output_dir=$OUT_DIR"
} >> "$OUT_DIR/run_meta.txt"

echo "READY: $TEST_ID"
