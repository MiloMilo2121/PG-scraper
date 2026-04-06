# PG3 Enricher – Observability Reference

This document describes every metric, endpoint, and KPI in the pg3 enrichment
runtime observability system. Use it when:

- Something breaks and you want to know where
- You want to verify the system is healthy before a production run
- You're tuning discovery thresholds and need signal
- You want to add alerts or a dashboard

---

## Endpoints

| Endpoint | Port | Description |
|----------|------|-------------|
| `GET /metrics` | 9091 | Prometheus scrape target (text format) |
| `GET /stats` | 9091 | Rich JSON snapshot (outcomes, queue, runtime) |
| `GET /run-summary` | 9091 | In-memory run summary JSON (204 if no run) |
| `GET /health` | 3000 | Redis + queue liveness (used by load balancers) |
| `GET /stats` | 3000 | Same as 9091/stats but via the health server |

---

## Taxonomy

Before reading metrics, understand the four semantic layers:

| Layer | What it measures |
|-------|-----------------|
| **Business Outcome** | Terminal result for a company: did we produce value? |
| **Technical Job Status** | Did the BullMQ job succeed or fail? (separate from outcome) |
| **Stage Status** | Did an individual pipeline stage succeed, fail, or get skipped? |
| **Provider Status** | Did a specific provider call return data, fail, or time out? |

These are intentionally separated. A job can have `status=SUCCESS` and
`business_outcome=NOT_FOUND` (technically succeeded, but found nothing).
This distinction is critical for distinguishing business recall from technical stability.

---

## Business Outcome Values

| Value | Meaning |
|-------|---------|
| `FOUND_COMPLETE` | Website found + enrichment processed |
| `ENRICHMENT_ONLY_NO_WEBSITE` | No website, but useful data (vat/pec/revenue/employees) |
| `NOT_FOUND` | Nothing meaningful found |
| `WORKER_EXCEPTION` | Job failed with uncaught exception on final attempt |

**Useful outcome** = `FOUND_COMPLETE` + `ENRICHMENT_ONLY_NO_WEBSITE`

---

## Metrics Catalog

### Business Funnel

#### `pg_companies_processed_total{outcome}`
- **Type:** Counter
- **Labels:** `outcome` (4 values: see Business Outcome Values above)
- **Updated:** Once per company, at job completion
- **How to read:** Sum over all outcome values = total throughput. Divide each by total for rates.
- **Key queries:**
  ```promql
  # Useful outcome rate (last hour)
  sum(increase(pg_companies_processed_total{outcome=~"FOUND_COMPLETE|ENRICHMENT_ONLY_NO_WEBSITE"}[1h]))
  / sum(increase(pg_companies_processed_total[1h]))

  # Exception rate (alert if > 5%)
  rate(pg_companies_processed_total{outcome="WORKER_EXCEPTION"}[5m])
  / rate(pg_companies_processed_total[5m])
  ```
- **Alert:** Exception rate > 5% → check provider credentials and network

#### `pg_discovery_lane_total{lane, status}`
- **Type:** Counter
- **Labels:**
  - `lane`: `INPUT_WEBSITE` | `EMAIL_DOMAIN` | `HYPER_GUESSER` | `PG_PHONE` | `SERP_COMPANY` | `SERP_REGISTRY` | `LLM_ORACLE` | `NONE`
  - `status`: `found` | `not_found` | `error`
- **Updated:** Once per company, after website discovery completes
- **How to read:** Per-lane found rate = `{lane=X,status=found}` / `{lane=X}` total
- **Key queries:**
  ```promql
  # Lane yield (found rate per lane)
  rate(pg_discovery_lane_total{status="found"}[1h]) by (lane)
  / rate(pg_discovery_lane_total[1h]) by (lane)
  ```
- **Alert:** `PG_PHONE` found rate drops below 60% → PagineGialle may have changed format

#### `pg_enrichment_field_found_total{field}`
- **Type:** Counter
- **Labels:** `field`: `website` | `email` | `vat` | `pec` | `revenue` | `employees` | `decision_maker`
- **Updated:** Once per company, at job completion (one increment per populated field)
- **How to read:** Divide by `pg_companies_processed_total` total for coverage rates
- **Key queries:**
  ```promql
  # Website coverage rate
  increase(pg_enrichment_field_found_total{field="website"}[1h])
  / increase(pg_companies_processed_total[1h])
  ```

---

### Stage Metrics

#### `pg_stage_duration_seconds{stage}`
- **Type:** Histogram
- **Labels:** `stage`: `input_validation` | `website_discovery` | `financial_enrichment` | `unknown`
- **Buckets:** 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120 seconds
- **Updated:** Once per company per stage
- **How to read:** p95 rising → stage is slowing down; investigate provider health
- **Key queries:**
  ```promql
  # p95 latency per stage
  histogram_quantile(0.95, rate(pg_stage_duration_seconds_bucket[5m])) by (stage)
  ```
- **Alert:** `website_discovery` p95 > 30s → reduce discovery depth or browser timeouts
- **Alert:** `financial_enrichment` p95 > 15s → VIES/registry provider may be down

#### `pg_stage_outcome_total{stage, status}`
- **Type:** Counter
- **Labels:** `stage` (same as above), `status`: `success` | `not_found` | `failed` | `skipped`
- **Updated:** Once per company per stage
- **How to read:** `{status="failed"}` / total for stage failure rate

#### `pg_company_processing_duration_seconds`
- **Type:** Histogram
- **Labels:** None (end-to-end, no per-stage label)
- **Buckets:** 1, 2, 5, 10, 20, 30, 60, 90, 120, 180, 300 seconds
- **Updated:** Once per company at job completion
- **How to read:** p99 should stay below configured timeout; rising = concurrency saturation
- **Key queries:**
  ```promql
  histogram_quantile(0.99, rate(pg_company_processing_duration_seconds_bucket[5m]))
  ```

---

### Runtime Health

#### `pg_event_loop_lag_seconds`
- **Type:** Gauge
- **Labels:** None
- **Updated:** Every 5 seconds
- **How to read:** Should be < 0.01s normally. > 0.1s = CPU contention. > 0.5s = critical.
- **Alert:** > 0.2s for 30s → reduce concurrency, check for blocking I/O

#### `pg_heap_used_bytes`, `pg_rss_bytes`, `pg_external_memory_bytes`
- **Type:** Gauge
- **Labels:** None
- **Updated:** Every 5 seconds
- **How to read:** Steady upward drift in `heap_used` → memory leak. Check browser instances not closed.
- **Alert:** `rss_bytes` > 4GB → restart worker before OOM

#### `pg_queue_jobs{queue, state}`
- **Type:** Gauge
- **Labels:** `queue`: `enrichment`, `state`: `waiting` | `active` | `failed` | `delayed` | `completed`
- **Updated:** Every 15 seconds (polled from BullMQ)
- **How to read:** Rising `waiting` with stable `active` = worker can't keep up. High `failed` = DLQ building.
- **Alert:** `{state="failed"}` > 50 → jobs permanently failing, investigate and drain DLQ

---

### Provider & Cost

#### `pg_provider_requests_total{provider_family, status}`
- **Type:** Counter
- **Labels:**
  - `provider_family`: `serp` | `http` | `llm` | `browser` | `oracle` | `financial` | `unknown`
  - `status`: `success` | `not_found` | `failed` | `timeout` | `rate_limited`
- **Updated:** Per provider call
- **How to read:** High `failed` or `rate_limited` for a family → that provider family is degraded
- **Key queries:**
  ```promql
  # Failure rate by provider family
  rate(pg_provider_requests_total{status=~"failed|timeout|rate_limited"}[5m]) by (provider_family)
  / rate(pg_provider_requests_total[5m]) by (provider_family)
  ```

#### `pg_provider_latency_seconds{provider_family}`
- **Type:** Histogram
- **Labels:** `provider_family` (same as above)
- **Buckets:** 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30 seconds
- **Updated:** Per provider call

#### `pg_cost_eur_total{provider_family}`
- **Type:** Counter (monotonically increasing, floating point EUR)
- **Labels:** `provider_family`
- **Updated:** Per provider call with non-zero cost
- **Key queries:**
  ```promql
  # Cost per hour by provider family
  increase(pg_cost_eur_total[1h]) by (provider_family)

  # Cost per useful outcome (approximation)
  sum(increase(pg_cost_eur_total[1h]))
  / sum(increase(pg_companies_processed_total{outcome=~"FOUND_COMPLETE|ENRICHMENT_ONLY_NO_WEBSITE"}[1h]))
  ```
- **Alert:** `llm` family cost > €5/hour → oracle is over-triggered

---

### Browser / Navigation Pressure

#### `pg_browser_pool_size{state}`
- **Type:** Gauge
- **Labels:** `state`: `total` | `busy` | `idle`
- **Updated:** Set by browser pool on each change
- **How to read:** `busy/total` → saturation ratio. > 0.9 = pool is the bottleneck.
- **Alert:** `busy/total` > 0.9 sustained for 2 minutes → reduce `MAX_CONCURRENCY` or add browser slots

#### `pg_browser_navigation_total{status}`
- **Type:** Counter
- **Labels:** `status`: `ok` | `failed` | `captcha` | `waf` | `timeout`
- **Updated:** Per navigation attempt
- **How to read:** Rising `captcha` or `waf` for specific domains → those domains are blocking us
- **Alert:** `captcha` rate > 20% → browser fingerprint may be stale, rotate user agents

---

### Cache Effectiveness

#### `pg_cache_operations_total{layer, operation}`
- **Type:** Counter
- **Labels:**
  - `layer`: `l1` (in-memory) | `l2` (Redis) | `miss` (neither)
  - `operation`: `get` | `set`
- **How to read:** L1 hit rate = `{layer=l1,operation=get}` / total gets. Low hit rate = every request hits APIs.
- **Key queries:**
  ```promql
  # L1 cache hit rate
  rate(pg_cache_operations_total{layer="l1",operation="get"}[5m])
  / rate(pg_cache_operations_total{operation="get"}[5m])
  ```

---

### Bleeding Mode

#### `pg_bleeding_mode_active`
- **Type:** Gauge (0 or 1)
- **Updated:** On circuit breaker state change
- **Alert:** = 1 for > 10 minutes → investigate root cause before resuming

#### `pg_bleeding_mode_activations_total{cause}`
- **Type:** Counter
- **Labels:** `cause`: `high_cost` | `high_error_rate` | `system_saturation`
- **Alert:** > 3 activations/hour → system structurally unstable

#### `pg_bleeding_mode_duration_seconds_total`
- **Type:** Counter (cumulative seconds in bleeding mode)
- **How to read:** `increase([1h])` > 600 (10 minutes) → system was throttled for >10min in the hour

---

### AI / LLM Quality

#### `pg_llm_output_quality_total{event}`
- **Type:** Counter
- **Labels:** `event`: `structured_ok` | `fallback_json` | `parse_failure` | `rejected`
- **Updated:** Per LLM structured output attempt
- **Alert:** `parse_failure` rate > 10% → prompt regression, fix before scaling

#### `pg_oracle_decisions_total{decision}`
- **Type:** Counter
- **Labels:** `decision`: `accepted` | `rejected` | `corroborated`
- **Updated:** Per Oracle invocation
- **How to read:** `accepted/(accepted+rejected)` = oracle acceptance rate. < 30% = oracle over-triggered for hopeless cases.

---

## Node.js Default Metrics

The `pg_node_*` prefix contains standard Node.js metrics collected automatically:
`pg_node_heap_space_size_total`, `pg_node_gc_duration_seconds`, etc.
These are useful for deep JVM-style memory diagnostics.

---

## KPI Priority List

When something goes wrong, check in this order:

1. **`pg_queue_jobs{state="failed"}`** – Is the DLQ building up?
2. **`pg_companies_processed_total{outcome="WORKER_EXCEPTION"}`** – Are jobs crashing?
3. **`pg_event_loop_lag_seconds`** – Is the Node.js process responsive?
4. **`pg_stage_duration_seconds` p95** – Which stage is the bottleneck?
5. **`pg_provider_requests_total{status="failed"}`** – Which provider is degraded?
6. **`pg_bleeding_mode_active`** – Is the circuit breaker active?
7. **`pg_cost_eur_total{provider_family="llm"}`** – Is LLM Oracle over-spending?
8. **`pg_discovery_lane_total` by lane** – Which discovery lane is losing recall?

---

## Degradation Signals (leading indicators)

These signals appear **before** business metrics drop:

| Signal | Metric | Threshold | Implication |
|--------|--------|-----------|-------------|
| Slow discovery | `pg_stage_duration_seconds{stage=website_discovery}` p95 rising | > 20s | Browser pressure or provider slowdown |
| Provider degrading | `pg_provider_requests_total{status=~"failed\|timeout"}` rate rising | > 20% for family | Provider incident or rate limit |
| Memory growing | `pg_heap_used_bytes` steady upward trend | +10%/hour | Memory leak, browser instances not closed |
| Event loop blocked | `pg_event_loop_lag_seconds` > 0.1s | Any sustained reading | Blocking I/O, reduce concurrency |
| LLM parse failures | `pg_llm_output_quality_total{event="parse_failure"}` rate | > 5% | Prompt regression after model update |
| Cache miss rate | `pg_cache_operations_total{layer="miss"}` fraction | > 60% | Cache TTL too low or Redis unavailable |
| DLQ building | `pg_queue_jobs{queue=dead-letter,state=waiting}` | > 10 | Systematic failure pattern |

---

## Run Summary JSON (per-run artifact)

Each run writes a `run-summary-{runId}-{timestamp}.json` file containing:

```json
{
  "run_id": "...",
  "generated_at": "...",
  "duration_ms": 12345,
  "total_companies": 100,
  "useful_outcome_rate": 0.72,
  "business_outcomes": {
    "FOUND_COMPLETE": 60,
    "ENRICHMENT_ONLY_NO_WEBSITE": 12,
    "NOT_FOUND": 25,
    "WORKER_EXCEPTION": 3
  },
  "discovery_lanes": {
    "INPUT_WEBSITE": 20,
    "SERP_COMPANY": 45,
    "LLM_ORACLE": 5,
    "NONE": 30
  },
  "field_coverage": {
    "website": 60, "email": 35, "vat": 48,
    "pec": 20, "revenue": 30, "employees": 25, "decision_maker": 0
  },
  "stage_timings": {
    "website_discovery": { "p50_ms": 3200, "p95_ms": 22000, "p99_ms": 45000, "avg_ms": 5100, "count": 100 },
    "financial_enrichment": { "p50_ms": 1200, "p95_ms": 8000, "p99_ms": 12000, "avg_ms": 1800, "count": 100 }
  },
  "cost": {
    "total_eur": 0.45,
    "per_company_eur": 0.0045,
    "per_useful_outcome_eur": 0.00625,
    "by_provider_family": { "serp": 0.20, "llm": 0.15, "http": 0.10 }
  },
  "top_reason_codes": [
    { "reason_code": "OK_CONFIRMED_INPUT_WEBSITE", "count": 20 },
    { "reason_code": "NOT_FOUND_NO_CANDIDATES", "count": 25 },
    { "reason_code": "ERROR_TIMEOUT_FETCH", "count": 8 }
  ],
  "top_provider_failures": [
    { "provider_family": "serp", "failure_count": 5, "total_count": 45, "failure_rate": 0.11 }
  ],
  "runtime": { "heap_used_mb": 380, "rss_mb": 620, "uptime_seconds": 420 },
  "bottlenecks": [
    "SLOW WEBSITE DISCOVERY: p95 latency is 22.0s – consider reducing NUCLEAR_RUN4 depth"
  ]
}
```

### Answering operational questions from the run summary

| Question | Where to look |
|----------|--------------|
| Is the runtime sane or degrading? | `bottlenecks` array + `stage_timings` p95 |
| Provider or logic failure? | `top_provider_failures` vs `top_reason_codes` |
| Is PG_PHONE lane still working? | `discovery_lanes.PG_PHONE` vs other lanes |
| Website discovery OK but contacts not? | `field_coverage.website` vs `field_coverage.email` |
| Financial enrichment bottleneck? | `stage_timings.financial_enrichment` p95 |
| Oracle over-used? | `discovery_lanes.LLM_ORACLE` / total lanes |
| Spending too much for marginal outcomes? | `cost.per_useful_outcome_eur` |
| Failures technical or business? | `business_outcomes.WORKER_EXCEPTION` vs `.NOT_FOUND` |

---

## Database Analytics Queries

Use these directly on the SQLite database for ad-hoc analysis:

```sql
-- Outcome breakdown for a specific run
SELECT business_outcome, COUNT(*) as cnt
FROM job_log
WHERE run_id = 'your-run-id' AND business_outcome IS NOT NULL
GROUP BY business_outcome;

-- Top reason codes all-time
SELECT reason_code, COUNT(*) as cnt
FROM job_log
WHERE reason_code IS NOT NULL AND reason_code != ''
GROUP BY reason_code ORDER BY cnt DESC LIMIT 20;

-- Field coverage
SELECT
  COUNT(*) as total,
  ROUND(AVG(CASE WHEN website_validated IS NOT NULL THEN 1.0 ELSE 0 END), 3) as website_rate,
  ROUND(AVG(CASE WHEN vat IS NOT NULL THEN 1.0 ELSE 0 END), 3) as vat_rate,
  ROUND(AVG(CASE WHEN pec IS NOT NULL THEN 1.0 ELSE 0 END), 3) as pec_rate,
  ROUND(AVG(CASE WHEN revenue IS NOT NULL THEN 1.0 ELSE 0 END), 3) as revenue_rate
FROM enrichment_results;

-- Avg duration by business outcome
SELECT business_outcome, COUNT(*) as n,
  ROUND(AVG(duration_ms)) as avg_ms,
  ROUND(MIN(duration_ms)) as min_ms,
  ROUND(MAX(duration_ms)) as max_ms
FROM job_log
WHERE business_outcome IS NOT NULL
GROUP BY business_outcome ORDER BY avg_ms DESC;
```
