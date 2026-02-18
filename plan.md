# PG-Scraper Minimal Patch Implementation Plan

## Overview
Implement the "Minimal Patch" phase (PR 1-5 from the industrialization report) across both pg1 and pg3, focusing on: zero silent drops, reason codes, backpressure writer, run context, and canonical URL fixes.

## Branch: `claude/pg-scraper-industrialization-mK1Ae`

---

## PR 1: Zero Silent Drops — Every record produces output

### pg1 changes:
**File: `pg1/src/pipeline/index.ts`**
- Replace 2 empty catch blocks (lines ~82, ~96) for seed URL parsing with proper error logging + fallback to empty candidates (instead of silently dropping URLs)
- Replace catch+continue in fetcher loop (line ~117) with error recording on the candidate object
- Wrap the outer row processing in catch that always writes a result row with `status: ERROR`

**File: `pg1/src/modules/seed-processor/index.ts`**
- Line ~49: Replace silent catch with error logging; return result with `error_reason` field

**File: `pg1/src/modules/extractor/index.ts`**
- Lines ~43, ~65, ~99: Add structured logging for Readability failure, JSON-LD parse failure, URL parse failure

**File: `pg1/src/modules/miner/index.ts`**
- Lines ~85-90: Log search result URL parse failures with query context

### pg3 changes:
**File: `pg3/src/enricher/core/discovery/unified_discovery_service.ts`**
- Lines ~528, ~633: Replace empty catches with `Logger.warn()` + reason tracking
- Lines ~639-641, ~275-276, ~297-306, ~380, ~413, ~439: Add error category to all catch blocks

**File: `pg3/src/enricher/core/discovery/nuclear_strategy.ts`**
- Lines ~46-48, ~85-107: Log provider failures with provider name + error category instead of silent catches

**File: `pg3/src/enricher/core/discovery/llm_oracle.ts`**
- Lines ~59-65: Log JSON parse errors and prediction failures with category

**File: `pg3/src/enricher/core/discovery/search_provider.ts`**
- Lines ~63-67, ~154-156: Log page.close() failures; log Serper errors with reason code

**File: `pg3/src/enricher/utils/scraper_client.ts`**
- Lines ~40, ~78, ~193: Add structured logging for URL parse, retry, and scrape.do failures

---

## PR 2: Reason Codes Standard

### pg1 changes:
**File: `pg1/src/types/index.ts`**
- Expand `DecisionStatus` enum:
  ```typescript
  enum DecisionStatus {
    OK_CONFIRMED = 'OK_CONFIRMED',
    OK_LIKELY = 'OK_LIKELY',
    AMBIGUOUS = 'AMBIGUOUS',
    NO_DOMAIN_FOUND = 'NO_DOMAIN_FOUND',
    REJECTED_DIRECTORY = 'REJECTED_DIRECTORY',
    ERROR_FETCH = 'ERROR_FETCH',
    ERROR_DNS = 'ERROR_DNS',
    ERROR_TIMEOUT = 'ERROR_TIMEOUT',
    ERROR_BLOCKED = 'ERROR_BLOCKED',
    ERROR_INTERNAL = 'ERROR_INTERNAL',
  }
  ```
- Add `reason_code: string` field to `OutputResult` type

**File: `pg1/src/modules/decider/index.ts`**
- Map existing decision logic to new granular status + reason_code

**File: `pg1/src/pipeline/index.ts`**
- Propagate reason codes from each stage (seed, mine, dedup, fetch, score) into the result

### pg3 changes:
**File: `pg3/src/enricher/core/discovery/unified_discovery_service.ts`**
- Add `reason_code` field to `DiscoveryResult` interface
- Map each failure path to a specific reason code:
  - `FOUND_VALID`, `FOUND_BLACKLISTED`, `FOUND_LOW_CONFIDENCE`
  - `NOT_FOUND_NO_CANDIDATES`, `NOT_FOUND_WAVES_EXHAUSTED`
  - `ERROR_NETWORK`, `ERROR_BROWSER`, `ERROR_LLM`, `ERROR_SEARCH`

**File: `pg3/src/enricher/db/index.ts`**
- Add `reason_code TEXT` column to `job_log` table
- Add `discovery_method TEXT` and `discovery_confidence REAL` columns to `enrichment_results` table

**File: `pg3/src/enricher/worker.ts`**
- Pass reason_code through from discovery result to job log and enrichment result

---

## PR 3: CSV Writer with Backpressure (pg1)

**File: `pg1/src/pipeline/index.ts`**
- Create `AsyncCsvWriter` class (or add as utility):
  ```typescript
  class AsyncCsvWriter {
    private queue: any[] = [];
    private writing = false;
    constructor(private stream: NodeJS.WritableStream) {}
    async write(row: any): Promise<void> {
      this.queue.push(row);
      if (!this.writing) await this.drainLoop();
    }
    private async drainLoop(): Promise<void> {
      this.writing = true;
      while (this.queue.length) {
        const row = this.queue.shift()!;
        const ok = this.stream.write(row);
        if (!ok) await once(this.stream, 'drain');
      }
      this.writing = false;
    }
    async end(): Promise<void> {
      await this.drainLoop();
      return new Promise(resolve => this.stream.end(resolve));
    }
  }
  ```
- Replace direct `csvStream.write(result)` call (line ~170) with `await writer.write(result)`
- Replace `csvStream.end()` with `await writer.end()`
- This ensures: no OOM from buffer overflow, no dropped writes, proper stream completion

---

## PR 4: Run Context Unique (both runtimes)

### pg1 changes:
**File: `pg1/src/pipeline/index.ts`**
- Generate `run_id` once at the start of `Pipeline.run()`: `const runId = 'run-' + crypto.randomUUID()`
- Pass `runId` to every result row instead of generating per-row (currently line ~164)
- Add `run_start` and `run_end` timestamps

### pg3 changes:
**File: `pg3/src/enricher/queue/index.ts`**
- Add `run_id?: string` and `correlation_id?: string` to `EnrichmentJobData` interface

**File: `pg3/src/enricher/runner.ts`**
- Generate run correlation ID at run start
- Pass it through to job data when enqueuing

**File: `pg3/src/enricher/worker.ts`**
- Extract run_id from job data and include in all log entries and DB writes

**File: `pg3/src/enricher/db/index.ts`**
- Add `run_id TEXT` column to `job_log` table

---

## PR 5: Canonical URL + Critical Infrastructure Fixes

### pg1 — URL Canonicalization:
**File: `pg1/src/pipeline/index.ts`** and **`pg1/src/modules/miner/index.ts`**
- Extract URL canonicalization into a shared utility function:
  ```typescript
  function canonicalDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '').toLowerCase();
    } catch { return null; }
  }
  ```
- Use consistently across pipeline (seed, miner, deduper)

### pg3 — Verification Cache Bounded:
**File: `pg3/src/enricher/core/discovery/unified_discovery_service.ts`**
- Replace unbounded `Map` cache with LRU implementation:
  - Max 5000 entries (configurable)
  - On set: if size >= max, delete oldest entry
  - On get: check TTL, delete if expired
  - Add periodic cleanup (every 5 min, sweep expired)

### pg3 — Browser Flags Safe Defaults:
**File: `pg3/src/enricher/core/browser/factory_v2.ts`**
- Remove `--single-process` flag (line ~205)
- Keep `--no-zygote` only when running as root/Docker (already conditional)
- Remove `--ignore-certificate-errors` or make it configurable

### pg3 — SQLite Pragmas:
**File: `pg3/src/enricher/db/index.ts`**
- Add missing pragmas after WAL setup:
  ```typescript
  db.pragma('busy_timeout = 30000');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('journal_size_limit = 16777216');
  ```

---

## Execution Order
1. **PR 5** first (infrastructure fixes: cache, SQLite, browser flags — low risk, high impact)
2. **PR 2** second (reason codes — foundation for everything else)
3. **PR 1** third (zero silent drops — uses new reason codes)
4. **PR 4** fourth (run context — enables correlation)
5. **PR 3** last (backpressure writer — pg1 specific, isolated)

## Testing Strategy
- Run existing pg3 test suite after each change: `cd pg3 && npm run test:unit`
- Run pg1 tests if functional: `cd pg1 && npx jest`
- Manual verification: TypeScript compilation clean on both projects
- All changes are backwards-compatible (new fields are optional, new enums are supersets)

## Risk Assessment
- **Low risk**: SQLite pragmas, browser flags, cache bounds, run_id fix
- **Medium risk**: Reason codes (touches many files, but additive only)
- **Medium risk**: Silent drops fix (changing catch behavior could surface previously hidden errors)
- **Low risk**: Backpressure writer (isolated to pg1 pipeline output)
