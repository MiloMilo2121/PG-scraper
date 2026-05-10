# R10.b — TV paid run invalidated by concurrent writers

Status: **INVALID ARTIFACT — do not audit / do not use for KPI.**

The operator authorized R10.b paid TV with:

```bash
npm run enrich -- \
  --input output/p60_provincia_tv.csv \
  --out output/p_recal_tv_paid.csv \
  --enable-paid \
  --cost-ceiling-eur 0.005 \
  --run-cost-ceiling-eur 0.20
```

The first sandboxed `tsx` launch failed with `EPERM` while opening its
IPC pipe, but it still left a child enrich process running. The command
was retried with elevated permissions, creating a second enrich process
against the same output paths.

Evidence:

- `output/p_recal_tv_paid.cost-ledger.jsonl` contains two `run_id`s:
  - `run-1778454154951-508d`
  - `run-1778454183076-d255`
- The ledger contains two summary rows.
- Provider counts are approximately doubled (`serper` 395 entries).
- The final CSV is structurally corrupt: `csv-parse` fails at line 157
  with inconsistent column count.
- `wc -l` after completion showed only partial/interleaved final files,
  despite each process logging `441` rows internally.

The visible completed run summary for `run-1778454183076-d255` was:

```text
leads_processed: 441
leads_with_website: 160
leads_errored: 0
serper.calls: 199
cost: €0.199
direct_fetch breaker: closed
```

But because two writers touched the same CSV / JSONL / ledger, the
artifact is not trustworthy and must not be used to judge TV precision.

## Fix shipped

R10.b surfaced a live-safety bug: pg4 had no output-path mutex. A retry
or accidental double launch could corrupt outputs and double-spend paid
providers.

Fix:

- `src/runtime/output_lock.ts`
  - atomic `*.lock` file using `fs.openSync(..., 'wx')`
  - stores `pid`, timestamp, target path and command metadata
  - rejects a second active process on the same output
  - reclaims stale locks whose process is no longer alive
- `src/cli/enrich.ts`
  - acquires the lock before opening CSV / JSONL / cost ledger
  - releases it in `finally`
- `src/cli/scrape.ts`
  - same lock protection for raw scrape outputs
- `tests/unit/output_lock.test.ts`
  - create/release
  - reject active second lock
  - reclaim stale pid
  - avoid deleting another active owner lock

Verification:

```text
npm run typecheck  green
npm test           525 passed | 1 skipped
```

## Next valid step

The corrupted `output/p_recal_tv_paid.*` files should be ignored or
removed before any rerun.

R10.b must be rerun only after explicit renewed paid authorization:

```bash
npm run enrich -- \
  --input output/p60_provincia_tv.csv \
  --out output/p_recal_tv_paid_rerun.csv \
  --enable-paid \
  --cost-ceiling-eur 0.005 \
  --run-cost-ceiling-eur 0.20
```

Use a fresh output basename (`p_recal_tv_paid_rerun`) to avoid mixing
with the invalid artifact.
