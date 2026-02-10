#!/usr/bin/env zsh
set -euo pipefail

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

echo "env.DISABLE_PROXY=${DISABLE_PROXY:-}" >> "$OUT_DIR/run_meta.txt"
echo "env.REDIS_URL=${REDIS_URL:-}" >> "$OUT_DIR/run_meta.txt"

echo "env.SCRAPE_DO_TOKEN=${SCRAPE_DO_TOKEN:+(set)}" >> "$OUT_DIR/run_meta.txt"

echo "env.PROXY_RESIDENTIAL_URL=${PROXY_RESIDENTIAL_URL:+(set)}" >> "$OUT_DIR/run_meta.txt"

echo "env.PROXY_DATACENTER_URL=${PROXY_DATACENTER_URL:+(set)}" >> "$OUT_DIR/run_meta.txt"

# Defaults for isolated runs
export DISABLE_PROXY="${DISABLE_PROXY:-true}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/15}"
export SQLITE_PATH="$DB_PATH"
export OUT_DIR

# Flush redis (best-effort)
(docker exec antigravity-redis redis-cli -n 15 FLUSHDB) > "$OUT_DIR/redis_flush.log" 2>&1 || true

WORKER_PID=""
cleanup() {
  if [[ -n "$WORKER_PID" ]]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Start worker
npx ts-node src/index.ts worker > "$OUT_DIR/worker.log" 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > "$OUT_DIR/worker.pid"

# Run scheduler
npx ts-node src/index.ts scheduler "$OUT_DIR/input.csv" > "$OUT_DIR/scheduler.log" 2>&1

# Wait for all jobs to reach terminal state (SUCCESS/FAILED)
python3 - <<'PY'
import os, sqlite3, time, sys

db_path = os.environ["SQLITE_PATH"]

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

deadline = time.time() + 40*60
while True:
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM enrichment_results")
    enriched = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT company_id) FROM job_log WHERE status IN (\"SUCCESS\", \"FAILED\")")
    terminal = cur.fetchone()[0]
    con.close()

    print(f"progress: enriched={enriched} terminal={terminal}/{expected}")

    if terminal >= expected:
        break
    if time.time() > deadline:
        print("ERROR: timeout waiting for jobs", file=sys.stderr)
        sys.exit(3)
    time.sleep(5)
PY

# Stop worker
kill "$WORKER_PID" 2>/dev/null || true
WORKER_PID=""

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
  c.email,
  er.website_validated,
  er.vat,
  er.revenue,
  er.employees,
  er.is_estimated_employees,
  er.pec,
  er.data_source AS enrichment_source,
  er.enriched_at,
  jl.status AS job_status,
  jl.attempt AS job_attempt,
  jl.duration_ms AS job_duration_ms,
  jl.error_category AS job_error_category,
  jl.error_message AS job_error_message,
  jl.processed_at AS job_processed_at
FROM companies c
LEFT JOIN enrichment_results er ON er.company_id = c.id
LEFT JOIN (
  SELECT company_id, status, error_message, error_category, duration_ms, attempt, processed_at
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
revenue_found_count = sum(1 for r in rows if (r.get("revenue") or "").strip())
employees_found_count = sum(1 for r in rows if (r.get("employees") or "").strip())
estimated_employees_count = sum(1 for r in rows if str(r.get("is_estimated_employees") or "0") in ("1", "true", "True"))

job_status_counts = Counter((r.get("job_status") or "UNKNOWN") for r in rows)

summary = {
    "total_companies": len(rows),
    "job_status_counts": dict(job_status_counts),
    "website_validated_count": website_validated_count,
    "vat_found_count": vat_found_count,
    "pec_found_count": pec_found_count,
    "revenue_found_count": revenue_found_count,
    "employees_found_count": employees_found_count,
    "estimated_employees_count": estimated_employees_count,
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
