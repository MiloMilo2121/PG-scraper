# pg4 Hardening Audit — R13

**Date:** 2026-06-01  
**Auditor:** Claude Code (automated audit)  
**Branch:** pg4/phase-4.4-structure-cleanup  
**Scope:** output_lock, cost_ledger, provider_router run-cap, scrape_pipeline checkpoint/resume, csv_writer, jsonl_writer, maps coverage variant keys, paid_evidence_gate.

---

## Findings Table

| # | Issue | Severity | Evidence (file:line) | Recommended Fix | Test Added? |
|---|-------|----------|---------------------|-----------------|-------------|
| 1 | **PID-reuse: lock is permanently stuck when a dead process's pid was recycled to an unrelated live process** | HIGH | `src/runtime/output_lock.ts:26-35` | Add a secondary staleness check: if `created_at` is older than N hours (e.g. 24 h) AND `isProcessAlive(pid)` returns true (which may be a false positive due to reuse), log a warning and reclaim the lock. An ops doc explaining how to manually remove the `.lock` file is a lower-effort mitigating control. | Yes — `hardening_output_lock.test.ts` documents the limitation |
| 2 | **`created_at` stored but never read** | MEDIUM | `src/runtime/output_lock.ts:21,62` + `readLock()` never uses `created_at` | Either use `created_at` to implement a max-age secondary gate (see #1) or remove the field from `LockPayload` to avoid implying it has protective value. | Yes — test confirms the field is inert |
| 3 | **Maps coverage `full` keys are correctly distinct — no collision** | INFO (non-issue confirmed) | `src/discovery/sources/maps_live.ts:48` + `src/runtime/checkpoint.ts:68` | No fix needed. `scrapeMapsLocation` receives `queryCategory` (the expanded variant) as `opts.category`, so `buildKey` uses the variant string. All keys are distinct. The anti-pattern test in the new file documents the hypothetical collision. | Yes — `hardening_maps_variant_checkpoint.test.ts` confirms correct isolation |
| 4 | **`filter()` uses `<= ceiling` while hot-path re-check uses `> ceiling` — both are semantically equivalent but the asymmetry is a readability hazard** | LOW | `src/providers/provider_router.ts:118,268` | Unify to a single helper `wouldExceedCeiling(ledger, reserved, cost, ceiling)` so both paths read identically and can be tested together. | Yes — `hardening_paid_cap_boundary.test.ts` confirms both paths agree at the boundary |
| 5 | **`reservedEur` is released in `finally` but it is instance-level state; if `ProviderRouter` is shared across concurrent runs with DIFFERENT `runCostCeilingEur` values, the counter is meaningless** | LOW | `src/providers/provider_router.ts:98,123,144` | One `ProviderRouter` per `Run` (current production pattern in `cli/enrich.ts`) makes this safe. Document this constraint explicitly in `ProviderRouter`'s class JSDoc. If multi-run sharing is ever attempted, move `reservedEur` into a per-call closure. | No — safe under current architecture; would need integration test to exercise |
| 6 | **CostLedger default `runId` (`run-{Date.now()}`) has millisecond granularity — two runs started within the same millisecond get the same `runId` if constructed with `new CostLedger()` directly** | LOW | `src/runtime/cost_ledger.ts:59` | `createRun()` in `run_context.ts` already appends 2 random hex bytes: `run-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`. The collision only affects direct `new CostLedger()` usage (tests and edge callers). Add `crypto.randomBytes` to `CostLedger` constructor fallback. | No |
| 7 | **`Checkpoint.flushSync` writes atomically via tmp+rename, but a crash BETWEEN `writeFileSync(tmp)` and `renameSync(tmp→file)` leaves a `.tmp` orphan; on the NEXT run, `load()` reads the `.json` (which may be missing or older) and ignores the `.tmp`** | LOW | `src/runtime/checkpoint.ts:87-91` | On `load()`, check for a `.tmp` sibling and promote it if the main file is missing. This is a very narrow crash window (sub-millisecond) but easy to guard. | No — the crash window is genuinely narrow and would require a chaos-test harness |
| 8 | **`CsvWriter` + `JsonlWriter` open streams at construction time; if `close()` is never called (exception in the calling pipeline), the write stream is never flushed and the file may be partially written** | MEDIUM | `src/io/csv_writer.ts:17-35` + `src/io/jsonl_writer.ts:44-47` | Both are used inside `try/finally` in `emitCsvJsonl` (`scrape_pipeline.ts:302-326`). However, `OutputManager` (`io/output_manager.ts:20`) does NOT use a try/finally. Add a `close()` call in a `finally` block for `OutputManager` usages in the enrichment pipeline. | No — requires tracing all `OutputManager` call sites |
| 9 | **`paid_evidence_gate.ts` `distinctVatCount()` counts ALL 11-digit substrings in raw HTML, not just text nodes — numeric strings embedded in class names, `data-*` attributes, or script tag constants could inflate the vat count and cause a false aggregator veto** | LOW | `src/discovery/website/paid_evidence_gate.ts:114-116` | Run `distinctVatCount` on `$('body').text()` (already stripped) or at minimum exclude `<script>` and `<style>` tag content before counting. | No — would require comparing VR/BL audit HTML samples |
| 10 | **`PaidEvidenceGate` `MIN_SECTOR_DENSITY=3` is a hand-tuned constant with no regression test** | LOW | `src/discovery/website/paid_evidence_gate.ts:94` | The existing `paid_evidence_gate.test.ts` tests gate decisions but not the density boundary specifically. Add a test that confirms sector density of exactly 3 = ACCEPT, density of 2 = REJECT (boundary). | No (existing test file covers overall acceptance/rejection but not this exact boundary) |

---

## What Was NOT Safely Testable

| Area | Why |
|------|-----|
| **`OutputManager` close-on-exception** | Tracing all `OutputManager` call sites in the enrichment pipeline requires live fs streams; safe to test with stubs but would be a larger addition than this audit scope |
| **`Checkpoint.flushSync` crash mid-rename** | Requires process-kill during a specific nanosecond window; not reproducible deterministically without OS-level fault injection |
| **`paid_evidence_gate` vat-in-attributes FP** | Would need fixture HTML with 11-digit numbers embedded in attribute values — valid test to add but requires manual HTML construction |
| **run_id mixing across runs** | `createRun()` uses timestamp + 2 random bytes; collision probability is ~1 in 65536 for same-millisecond starts. Practically zero. The `CostLedger` constructor fallback is the only exposed path and is only used in tests. |
| **Concurrent `OutputManager.write()` calls** | `csv_writer` and `jsonl_writer` both handle backpressure but two concurrent `write()` calls to the same writer could interleave. In production the pipeline processes leads sequentially (Backpressure controls concurrency at the lead level, not within a single lead). |

---

## Summary

The codebase is generally well-hardened. The most actionable finding is **#1 (pid-reuse lock hazard)**: a genuinely dead lock whose pid was recycled by an unrelated live process becomes permanently irrecoverable without manual operator intervention, and the `created_at` field that could serve as a safety net is stored but never consulted. All other findings are low-severity readability or narrow edge-case issues.

The checkpoint key collision concern (the task's explicit focus) was **confirmed as a non-issue**: the pipeline correctly passes the expanded variant category to `scrapeMapsLocation`, producing distinct checkpoint keys for each variant. The anti-pattern test in `hardening_maps_variant_checkpoint.test.ts` documents what would break if this were ever changed.

The run-cost ceiling boundary at `<= ceiling` is **consistent** between `filter()` and the hot-path re-check. The new boundary tests confirm this holds at the exact cap value.

---

## Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/unit/hardening_output_lock.test.ts` | 7 | Lock mutual exclusion, stale-pid reclaim, pid-reuse documented limitation, race-guard on release, double-release idempotency, payload shape |
| `tests/unit/hardening_maps_variant_checkpoint.test.ts` | 6 | Default vs full key uniqueness, checkpoint isolation, anti-pattern collision demo, cross-location key uniqueness |
| `tests/unit/hardening_paid_cap_boundary.test.ts` | 7 | Allows exactly N calls at ceiling, rejects N+1, inclusive boundary, paidEnabled=false override, ceiling=0, per-lead vs run-ceiling independence, total never exceeds ceiling |
