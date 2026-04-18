/**
 * OBSERVABILITY TELEMETRY REGISTRY
 *
 * Central module for all Prometheus metrics in the enrichment runtime.
 *
 * Design principles:
 *  - Low cardinality labels only (no company_id, URL, raw error messages)
 *  - Clear semantic separation: business outcomes vs technical status
 *  - Every metric answers a specific operational question
 *  - Compatible with prom-client v15.x (already in dependencies)
 *
 * Label cardinality budget:
 *  outcome        : 4  values  (FOUND_COMPLETE | ENRICHMENT_ONLY_NO_WEBSITE | NOT_FOUND | WORKER_EXCEPTION)
 *  lane           : 8  values  (INPUT_WEBSITE | EMAIL_DOMAIN | HYPER_GUESSER | PG_PHONE | SERP_COMPANY | SERP_REGISTRY | LLM_ORACLE | NONE)
 *  stage          : 4  values  (input_validation | website_discovery | financial_enrichment | unknown)
 *  stage_status   : 4  values  (success | not_found | failed | skipped)
 *  provider_family: 7  values  (serp | http | llm | browser | oracle | financial | unknown)
 *  field          : 7  values  (website | email | vat | pec | revenue | employees | decision_maker)
 *  nav_status     : 5  values  (ok | failed | captcha | waf | timeout)
 *  pool_state     : 3  values  (total | busy | idle)
 *  cache_layer    : 3  values  (l1 | l2 | miss)
 *  event          : 4  values  (structured_ok | fallback_json | parse_failure | rejected)
 *  cause          : 3  values  (high_cost | high_error_rate | system_saturation)
 *  oracle_decision: 3  values  (accepted | rejected | corroborated)
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED ENUM TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Terminal business outcome – what happened for the company overall */
export type BusinessOutcome =
    | 'FOUND_COMPLETE'             // Website found + enrichment processed
    | 'ENRICHMENT_ONLY_NO_WEBSITE' // No website, but useful data (vat/pec/revenue/employees)
    | 'NOT_FOUND'                  // Nothing meaningful found
    | 'WORKER_EXCEPTION';          // Job failed with uncaught exception

/** Which discovery path produced (or failed to produce) a website */
export type DiscoveryLane =
    | 'INPUT_WEBSITE'  // Pre-validated website from input data
    | 'EMAIL_DOMAIN'   // Domain extracted from input email
    | 'HYPER_GUESSER'  // Heuristic domain construction
    | 'PG_PHONE'       // Domain derived from PagineGialle phone/pg_url probe
    | 'SERP_COMPANY'   // Web search for company name
    | 'SERP_REGISTRY'  // Web search targeting registry/CCIAA
    | 'LLM_ORACLE'     // LLM-assisted disambiguation
    | 'NONE';          // Discovery failed – no candidate accepted

/** Named processing stages */
export type StageName =
    | 'input_validation'
    | 'website_discovery'
    | 'financial_enrichment'
    | 'unknown';

/** Per-stage terminal status */
export type StageStatus = 'success' | 'not_found' | 'failed' | 'skipped';

/** Provider family grouping (keep ≤ 8 to avoid cardinality creep) */
export type ProviderFamily =
    | 'serp'      // SERP search APIs (Serper, DDG, Bing)
    | 'http'      // Direct HTTP fetchers (direct)
    | 'llm'       // LLM calls (GLM, OpenAI, DeepSeek, Kimi)
    | 'browser'   // Browser automation (Puppeteer)
    | 'oracle'    // LLM-Oracle disambiguation loop
    | 'financial' // Financial/registry APIs (VIES, CCIAA, Bilancio)
    | 'unknown';

/** Error category – grouped to avoid raw error messages as label values */
export type ErrorCategory = 'NETWORK' | 'AUTH' | 'BROWSER' | 'PARSING' | 'VALIDATION' | 'INTERNAL';

// ─────────────────────────────────────────────────────────────────────────────
// PROMETHEUS REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/** Dedicated registry – avoids polluting the global default registry */
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: 'pg3-enricher' });

// Collect standard Node.js process metrics (heap, gc, eventloop) into our registry
collectDefaultMetrics({ register: metricsRegistry, prefix: 'pg_node_' });

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS FUNNEL METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_companies_processed_total{outcome}
 *
 * Primary business KPI. Tells you immediately what fraction of runs produce value.
 *
 * Questions answered:
 *  - What is the useful-outcome rate today?
 *  - Is the WORKER_EXCEPTION rate rising? (→ regression signal)
 *  - How does throughput change over time?
 *
 * Alert: outcome="WORKER_EXCEPTION" rate > 5% of total → investigate immediately
 */
export const companiesProcessed = new Counter({
    name: 'pg_companies_processed_total',
    help: 'Total companies processed by terminal business outcome',
    labelNames: ['outcome'] as const,
    registers: [metricsRegistry],
});

/**
 * pg_discovery_lane_total{lane, status}
 *
 * Tells you which discovery path is producing results and where we lose recall.
 *
 * status values: found | not_found | error
 *
 * Questions answered:
 *  - Is INPUT_WEBSITE pre-validation rate still high?
 *  - Is SERP_COMPANY producing results or just noise?
 *  - Is LLM_ORACLE over-used (expensive) or under-used (recall left on table)?
 */
export const discoveryLaneTotal = new Counter({
    name: 'pg_discovery_lane_total',
    help: 'Website discovery outcomes by lane and result status (found|not_found|error)',
    labelNames: ['lane', 'status'] as const,
    registers: [metricsRegistry],
});

/**
 * pg_enrichment_field_found_total{field}
 *
 * Coverage metric: how many records have each enrichment field populated.
 *
 * field values: website | vat | pec | revenue | employees
 *
 * Questions answered:
 *  - What is the website coverage rate? (pg_enrichment_field_found_total{field="website"} / pg_companies_processed_total)
 *  - Is financial enrichment (vat/revenue) keeping up with discovery?
 *  - Has a PEC extraction regression occurred?
 */
export const enrichmentFieldFound = new Counter({
    name: 'pg_enrichment_field_found_total',
    help: 'Companies where a given enrichment field was successfully populated',
    labelNames: ['field'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// STAGE TIMING & OUTCOME METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_stage_duration_seconds{stage}
 *
 * Per-stage latency histogram. Use to find bottlenecks.
 *
 * Questions answered:
 *  - Which stage is the slowest at p95?
 *  - Has website_discovery slowed down after a config change?
 *  - Is financial_enrichment consistently timing out?
 *
 * Query: histogram_quantile(0.95, rate(pg_stage_duration_seconds_bucket[5m])) by (stage)
 */
export const stageDuration = new Histogram({
    name: 'pg_stage_duration_seconds',
    help: 'Processing time per enrichment stage in seconds',
    labelNames: ['stage'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    registers: [metricsRegistry],
});

/**
 * pg_stage_outcome_total{stage, status}
 *
 * Stage-level success/failure/skip rates.
 * Complements timing histograms with discrete outcome counts.
 */
export const stageOutcome = new Counter({
    name: 'pg_stage_outcome_total',
    help: 'Stage processing outcomes by stage and status (success|not_found|failed|skipped)',
    labelNames: ['stage', 'status'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY-LEVEL END-TO-END TIMING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_company_processing_duration_seconds
 *
 * End-to-end duration per company (wall clock from job start to completion).
 * p95/p99 rising → system slowing, concurrency may be saturated.
 *
 * Query: histogram_quantile(0.99, rate(pg_company_processing_duration_seconds_bucket[5m]))
 */
export const companyProcessingDuration = new Histogram({
    name: 'pg_company_processing_duration_seconds',
    help: 'End-to-end processing time per company from job start to completion',
    labelNames: [] as const,
    buckets: [1, 2, 5, 10, 20, 30, 60, 90, 120, 180, 300],
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_event_loop_lag_seconds
 *
 * Node.js event loop lag. Rising values indicate CPU contention or blocking I/O.
 * Alert: > 0.1s → event loop is blocked; > 0.5s → critical
 */
export const eventLoopLag = new Gauge({
    name: 'pg_event_loop_lag_seconds',
    help: 'Node.js event loop lag in seconds (sampled every 5s)',
    registers: [metricsRegistry],
});

/** pg_heap_used_bytes – watch for memory leaks (steady upward drift) */
export const heapUsed = new Gauge({
    name: 'pg_heap_used_bytes',
    help: 'V8 heap memory currently in use',
    registers: [metricsRegistry],
});

/** pg_rss_bytes – total OS-level process memory */
export const rssBytes = new Gauge({
    name: 'pg_rss_bytes',
    help: 'Process RSS (Resident Set Size) in bytes',
    registers: [metricsRegistry],
});

/** pg_external_memory_bytes – native Buffer / C++ objects memory */
export const externalMemory = new Gauge({
    name: 'pg_external_memory_bytes',
    help: 'External (Buffer/native) memory in bytes',
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_queue_jobs{queue, state}
 *
 * BullMQ queue depth by state. Tells you if the queue is backing up.
 * state values: waiting | active | failed | delayed | completed
 *
 * Alert: state="failed" > 50 → jobs are permanently failing, DLQ building up
 * Alert: state="waiting" growing → worker can't keep up with producer
 */
export const queueJobs = new Gauge({
    name: 'pg_queue_jobs',
    help: 'Number of jobs in queue by queue name and state',
    labelNames: ['queue', 'state'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// COST METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_cost_eur_total{provider_family}
 *
 * Cumulative cost in EUR by provider family. Use Counter to support rate queries.
 *
 * Questions answered:
 *  - How much did the LLM oracle cost vs SERP in the last hour?
 *  - What is the cost-per-company for useful outcomes?
 *  - Is cost spiking after a config change?
 *
 * Query: increase(pg_cost_eur_total[1h]) by (provider_family)  → cost per hour
 */
export const costEurTotal = new Counter({
    name: 'pg_cost_eur_total',
    help: 'Cumulative API cost in EUR by provider family',
    labelNames: ['provider_family'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_provider_requests_total{provider_family, status}
 *
 * Provider request outcomes. Tells you which providers are failing.
 * status values: success | not_found | failed | timeout | rate_limited
 *
 * Questions answered:
 *  - Is SERP failing at a higher rate than normal?
 *  - Is the LLM oracle timing out?
 *  - Which provider family has the worst reliability?
 */
export const providerRequests = new Counter({
    name: 'pg_provider_requests_total',
    help: 'Provider request outcomes by family and status (success|not_found|failed|timeout|rate_limited)',
    labelNames: ['provider_family', 'status'] as const,
    registers: [metricsRegistry],
});

/**
 * pg_provider_latency_seconds{provider_family}
 *
 * Provider request latency histogram.
 * Identifies slow providers before they become bottlenecks.
 *
 * Query: histogram_quantile(0.95, rate(pg_provider_latency_seconds_bucket[5m])) by (provider_family)
 */
export const providerLatency = new Histogram({
    name: 'pg_provider_latency_seconds',
    help: 'Provider request latency by family',
    labelNames: ['provider_family'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER / BLEEDING MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_bleeding_mode_activations_total{cause}
 *
 * Counts how often the stop-the-bleeding circuit breaker fires.
 * cause values: high_cost | high_error_rate | system_saturation
 *
 * Alert: more than 3 activations/hour → system is structurally unstable
 */
export const bleedingModeActivations = new Counter({
    name: 'pg_bleeding_mode_activations_total',
    help: 'Number of times the stop-the-bleeding circuit breaker activated, by trigger cause',
    labelNames: ['cause'] as const,
    registers: [metricsRegistry],
});

/** pg_bleeding_mode_active – 1 if circuit breaker is currently active */
export const bleedingModeActive = new Gauge({
    name: 'pg_bleeding_mode_active',
    help: '1 if stop-the-bleeding circuit breaker is currently active, 0 otherwise',
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// LLM / AI OUTPUT QUALITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_llm_output_quality_total{event}
 *
 * LLM structured output quality. Rising parse failures → prompt regression.
 * event values: structured_ok | fallback_json | parse_failure | rejected
 *
 * Alert: parse_failure rate > 10% → prompt/model regression, fix before scale
 */
export const llmOutputQuality = new Counter({
    name: 'pg_llm_output_quality_total',
    help: 'LLM structured output quality events (structured_ok|fallback_json|parse_failure|rejected)',
    labelNames: ['event'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER / NAVIGATION PRESSURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_browser_pool_size{state}
 *
 * Browser pool saturation. If busy ≈ total → pool is the bottleneck.
 * state values: total | busy | idle
 *
 * Alert: busy/total > 0.9 for more than 60s → add more browser slots or reduce concurrency
 */
export const browserPoolSize = new Gauge({
    name: 'pg_browser_pool_size',
    help: 'Browser pool instance count by state (total|busy|idle)',
    labelNames: ['state'] as const,
    registers: [metricsRegistry],
});

/**
 * pg_browser_navigation_total{status}
 *
 * Navigation outcomes. Increasing captcha/waf → domain is rate-limiting us.
 * status values: ok | failed | captcha | waf | timeout
 */
export const browserNavigationTotal = new Counter({
    name: 'pg_browser_navigation_total',
    help: 'Browser navigation outcomes by status (ok|failed|captcha|waf|timeout)',
    labelNames: ['status'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE EFFECTIVENESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_cache_operations_total{layer, operation}
 *
 * Cache hit rate by layer. Low l1+l2 hit rate means every request hits external APIs.
 * layer values: l1 | l2 | miss
 * operation values: get | set
 *
 * Query: rate(pg_cache_operations_total{operation="get",layer="l1"}[5m])
 *        / rate(pg_cache_operations_total{operation="get"}[5m])  → L1 hit rate
 */
export const cacheOperationsTotal = new Counter({
    name: 'pg_cache_operations_total',
    help: 'Cache get/set operations by layer (l1|l2|miss) and operation (get|set)',
    labelNames: ['layer', 'operation'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// BLEEDING MODE DURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_bleeding_mode_duration_seconds_total
 *
 * Cumulative time spent in circuit-breaker (stop-the-bleeding) mode.
 * High values mean the system is spending significant time throttled.
 *
 * Alert: > 10 minutes in a 1-hour window → structural instability
 */
export const bleedingModeDurationSeconds = new Counter({
    name: 'pg_bleeding_mode_duration_seconds_total',
    help: 'Cumulative seconds the stop-the-bleeding circuit breaker has been active',
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// ORACLE DECISION QUALITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pg_oracle_decisions_total{decision}
 *
 * LLM Oracle usage and quality. High rejection rate → oracle is being over-triggered
 * on cases it can't resolve. Low corroboration rate → oracle isn't adding value.
 * decision values: accepted | rejected | corroborated
 */
export const oracleDecisionsTotal = new Counter({
    name: 'pg_oracle_decisions_total',
    help: 'LLM Oracle disambiguation decisions (accepted|rejected|corroborated)',
    labelNames: ['decision'] as const,
    registers: [metricsRegistry],
});

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME MONITORING LOOP
// ─────────────────────────────────────────────────────────────────────────────

let _monitoringInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background process metrics sampling loop.
 * Samples event loop lag and memory every `intervalMs` milliseconds.
 * Call once during application startup; safe to call multiple times (idempotent).
 */
export function startRuntimeMonitoring(intervalMs: number = 5000): void {
    if (_monitoringInterval !== null) return;

    _monitoringInterval = setInterval(() => {
        const start = Date.now();
        setImmediate(() => {
            eventLoopLag.set((Date.now() - start) / 1000);
        });

        const mem = process.memoryUsage();
        heapUsed.set(mem.heapUsed);
        rssBytes.set(mem.rss);
        externalMemory.set(mem.external);
    }, intervalMs);

    // Don't hold the event loop open during graceful shutdown
    _monitoringInterval.unref();
}

/** Stop the monitoring loop (use during graceful shutdown or in tests). */
export function stopRuntimeMonitoring(): void {
    if (_monitoringInterval !== null) {
        clearInterval(_monitoringInterval);
        _monitoringInterval = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER / NORMALISATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw discovery method string (from UnifiedDiscoveryService)
 * to the controlled DiscoveryLane enum value.
 *
 * This function is the single authority for lane → label mapping.
 * All new discovery methods must be mapped here.
 */
export function normalizeDiscoveryLane(method: string | undefined): DiscoveryLane {
    if (!method) return 'NONE';
    const m = method.toLowerCase();

    // Explicit ordered checks (most specific first)
    if (m.includes('pre_validated_input') || m.includes('input_website')) return 'INPUT_WEBSITE';
    if (m.includes('email_domain') || m.includes('email-domain')) return 'EMAIL_DOMAIN';
    if (m.includes('hyper_guesser') || m.includes('hyperguesser') || m.includes('hyper-guesser')) return 'HYPER_GUESSER';
    if (m.includes('pg_phone') || m.includes('paginegialle') || m.includes('pg_url') || m.includes('phone_probe')) return 'PG_PHONE';
    if (m.includes('serp_registry') || m.includes('serp-registry') || m.includes('stage_5')) return 'SERP_REGISTRY';
    if (m.includes('serp_company') || m.includes('serp-company') || m.includes('serp') || m.includes('stage_4')) return 'SERP_COMPANY';
    if (m.includes('llm_oracle') || m.includes('oracle') || m.includes('stage_6')) return 'LLM_ORACLE';

    return 'NONE';
}

/**
 * Determine the terminal business outcome for a company.
 *
 * This is the canonical function for separating business outcome from
 * technical job status. It must NOT be inlined in the worker.
 *
 * @param websiteFound  - final validated website URL; truthy = website was found
 * @param hasFinancialData - true if at least one of vat/pec/revenue/employees was populated
 * @param isException   - true if the job failed due to an uncaught exception
 */
export function determineBusinessOutcome(
    websiteFound: string | undefined | null,
    hasFinancialData: boolean,
    isException: boolean
): BusinessOutcome {
    if (isException) return 'WORKER_EXCEPTION';
    if (websiteFound) return 'FOUND_COMPLETE';
    if (hasFinancialData) return 'ENRICHMENT_ONLY_NO_WEBSITE';
    return 'NOT_FOUND';
}

/**
 * Map a raw discovery method to a ProviderFamily for cost/latency tracking.
 */
export function discoveryMethodToProviderFamily(method: string | undefined): ProviderFamily {
    if (!method) return 'unknown';
    const m = method.toLowerCase();
    if (m.includes('serp') || m.includes('serper') || m.includes('bing') || m.includes('ddg') || m.includes('search')) return 'serp';
    if (m.includes('oracle')) return 'oracle';
    if (m.includes('llm') || m.includes('openai') || m.includes('deepseek') || m.includes('kimi') || m.includes('glm')) return 'llm';
    if (m.includes('browser') || m.includes('puppeteer')) return 'browser';
    if (m.includes('http') || m.includes('hyper') || m.includes('email')) return 'http';
    if (m.includes('financial') || m.includes('vies') || m.includes('registry') || m.includes('bilancio')) return 'financial';
    return 'unknown';
}
