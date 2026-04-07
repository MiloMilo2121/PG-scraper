/**
 * RUN SUMMARY COLLECTOR
 *
 * Accumulates per-run observability data in memory and persists a structured
 * JSON artifact at run completion.
 *
 * Usage:
 *   const collector = initRunSummary(runId);
 *   // ... throughout the run ...
 *   collector.recordOutcome('FOUND_COMPLETE');
 *   collector.recordDiscoveryLane('SERP_COMPANY');
 *   // ... at end of run ...
 *   const filePath = collector.persist('./output/summaries');
 *
 * The resulting JSON answers: what happened in this run, where did we fail,
 * what did it cost, and what are the top bottlenecks?
 */

import * as fs from 'fs';
import * as path from 'path';
import { BusinessOutcome, DiscoveryLane } from './telemetry';

// ─────────────────────────────────────────────────────────────────────────────
// DATA SHAPE
// ─────────────────────────────────────────────────────────────────────────────

export interface StageTiming {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    avg_ms: number;
    count: number;
}

export interface FieldCoverage {
    website: number;
    email: number;
    vat: number;
    pec: number;
    revenue: number;
    employees: number;
    decision_maker: number;
}

export interface RunCost {
    total_eur: number;
    per_company_eur: number;
    per_useful_outcome_eur: number;
    by_provider_family: Record<string, number>;
}

export interface ProviderFailureSummary {
    provider_family: string;
    failure_count: number;
    total_count: number;
    failure_rate: number;
}

export interface RunSummaryData {
    run_id: string;
    generated_at: string;
    duration_ms: number;

    // Business funnel
    total_companies: number;
    business_outcomes: Record<BusinessOutcome, number>;
    useful_outcome_rate: number; // (FOUND_COMPLETE + ENRICHMENT_ONLY_NO_WEBSITE) / total

    // Discovery lanes
    discovery_lanes: Partial<Record<DiscoveryLane, number>>;

    // Field coverage (absolute counts, not rates – divide by total_companies for rate)
    field_coverage: FieldCoverage;

    // Stage timings
    stage_timings: Record<string, StageTiming>;

    // Cost
    cost: RunCost;

    // Top failure signals
    top_reason_codes: Array<{ reason_code: string; count: number }>;
    top_provider_failures: ProviderFailureSummary[];

    // Runtime snapshot at summary time
    runtime: {
        heap_used_mb: number;
        rss_mb: number;
        uptime_seconds: number;
    };

    // Auto-detected bottlenecks (human-readable, actionable)
    bottlenecks: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class RunSummaryCollector {
    private readonly runId: string;
    private readonly startTime: number;

    private readonly outcomes: Record<BusinessOutcome, number> = {
        FOUND_COMPLETE: 0,
        ENRICHMENT_ONLY_NO_WEBSITE: 0,
        NOT_FOUND: 0,
        WORKER_EXCEPTION: 0,
    };

    private readonly laneHits: Partial<Record<DiscoveryLane, number>> = {};

    private readonly fieldCoverage: FieldCoverage = {
        website: 0,
        email: 0,
        vat: 0,
        pec: 0,
        revenue: 0,
        employees: 0,
        decision_maker: 0,
    };

    private readonly reasonCodes: Map<string, number> = new Map();

    /** Raw duration arrays per stage – kept in memory for percentile computation */
    private readonly stageDurationArrays: Record<string, number[]> = {};

    private readonly costByFamily: Map<string, number> = new Map();
    private totalCost = 0;

    /** Provider request tracking: family → { total, failures } */
    private readonly providerStats: Map<string, { total: number; failures: number }> = new Map();

    constructor(runId: string) {
        this.runId = runId;
        this.startTime = Date.now();
    }

    // ── Recording methods ─────────────────────────────────────────────────────

    recordOutcome(outcome: BusinessOutcome): void {
        this.outcomes[outcome]++;
    }

    recordDiscoveryLane(lane: DiscoveryLane): void {
        this.laneHits[lane] = (this.laneHits[lane] ?? 0) + 1;
    }

    recordFieldFound(field: keyof FieldCoverage): void {
        this.fieldCoverage[field]++;
    }

    /**
     * Record a reason code. Normalised to max 80 chars to prevent unbounded keys.
     * Do NOT pass raw error message strings here – use categorized codes only.
     */
    recordReasonCode(code: string | undefined | null): void {
        if (!code) return;
        const key = code.trim().slice(0, 80);
        this.reasonCodes.set(key, (this.reasonCodes.get(key) ?? 0) + 1);
    }

    /** Record a stage duration sample in milliseconds */
    recordStageDuration(stage: string, durationMs: number): void {
        if (!this.stageDurationArrays[stage]) {
            this.stageDurationArrays[stage] = [];
        }
        this.stageDurationArrays[stage].push(durationMs);
    }

    /** Record a cost incurred by a provider family (in EUR) */
    recordCost(providerFamily: string, costEur: number): void {
        const prev = this.costByFamily.get(providerFamily) ?? 0;
        this.costByFamily.set(providerFamily, prev + costEur);
        this.totalCost += costEur;
    }

    /** Record a provider request outcome */
    recordProviderRequest(providerFamily: string, success: boolean): void {
        const stats = this.providerStats.get(providerFamily) ?? { total: 0, failures: 0 };
        stats.total++;
        if (!success) stats.failures++;
        this.providerStats.set(providerFamily, stats);
    }

    // ── Build & Persist ───────────────────────────────────────────────────────

    /**
     * Build a typed summary snapshot from accumulated data.
     * Can be called multiple times (non-destructive).
     */
    build(): RunSummaryData {
        const total = Object.values(this.outcomes).reduce((s, n) => s + n, 0);
        const useful = this.outcomes.FOUND_COMPLETE + this.outcomes.ENRICHMENT_ONLY_NO_WEBSITE;

        // Stage timings
        const stageTimings: Record<string, StageTiming> = {};
        for (const [stage, durations] of Object.entries(this.stageDurationArrays)) {
            if (durations.length === 0) continue;
            const sorted = [...durations].sort((a, b) => a - b);
            stageTimings[stage] = {
                p50_ms: percentile(sorted, 0.5),
                p95_ms: percentile(sorted, 0.95),
                p99_ms: percentile(sorted, 0.99),
                avg_ms: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
                count: sorted.length,
            };
        }

        // Top reason codes (top 15)
        const topReasonCodes = [...this.reasonCodes.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 15)
            .map(([reason_code, count]) => ({ reason_code, count }));

        // Top provider failures (only families with > 0 failures)
        const topProviderFailures: ProviderFailureSummary[] = [...this.providerStats.entries()]
            .filter(([, s]) => s.failures > 0)
            .map(([pf, s]) => ({
                provider_family: pf,
                failure_count: s.failures,
                total_count: s.total,
                failure_rate: s.total > 0 ? s.failures / s.total : 0,
            }))
            .sort((a, b) => b.failure_count - a.failure_count)
            .slice(0, 10);

        // Cost
        const costByFamily: Record<string, number> = {};
        for (const [k, v] of this.costByFamily.entries()) {
            costByFamily[k] = Math.round(v * 100000) / 100000; // 5 decimal places
        }
        const cost: RunCost = {
            total_eur: Math.round(this.totalCost * 100000) / 100000,
            per_company_eur: total > 0 ? Math.round((this.totalCost / total) * 100000) / 100000 : 0,
            per_useful_outcome_eur: useful > 0 ? Math.round((this.totalCost / useful) * 100000) / 100000 : 0,
            by_provider_family: costByFamily,
        };

        // Auto-detect bottlenecks
        const bottlenecks = detectBottlenecks({
            total,
            outcomes: this.outcomes,
            useful,
            stageTimings,
            providerStats: this.providerStats,
            totalCost: this.totalCost,
        });

        const mem = process.memoryUsage();

        return {
            run_id: this.runId,
            generated_at: new Date().toISOString(),
            duration_ms: Date.now() - this.startTime,

            total_companies: total,
            business_outcomes: { ...this.outcomes },
            useful_outcome_rate: total > 0 ? Math.round((useful / total) * 10000) / 10000 : 0,

            discovery_lanes: { ...this.laneHits },
            field_coverage: { ...this.fieldCoverage },

            stage_timings: stageTimings,
            cost,

            top_reason_codes: topReasonCodes,
            top_provider_failures: topProviderFailures,

            runtime: {
                heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
                rss_mb: Math.round(mem.rss / 1024 / 1024),
                uptime_seconds: Math.round(process.uptime()),
            },
            bottlenecks,
        };
    }

    /**
     * Write the summary to disk as a timestamped JSON file.
     * Returns the path of the written file.
     */
    persist(outputDir: string): string {
        const summary = this.build();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const filename = `run-summary-${this.runId}-${ts}.json`;
        const filePath = path.join(outputDir, filename);

        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf8');

        return filePath;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

let _activeCollector: RunSummaryCollector | null = null;

/**
 * Initialise a fresh RunSummaryCollector for a new run.
 * Replaces any previously active collector.
 */
export function initRunSummary(runId: string): RunSummaryCollector {
    _activeCollector = new RunSummaryCollector(runId);
    return _activeCollector;
}

/**
 * Retrieve the currently active RunSummaryCollector, or null if none was initialised.
 * Workers call this to record events without needing a direct reference.
 */
export function getActiveRunSummary(): RunSummaryCollector | null {
    return _activeCollector;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the p-th percentile from a pre-sorted array of numbers.
 * Returns 0 for empty arrays.
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
    return sorted[idx];
}

interface BottleneckInput {
    total: number;
    outcomes: Record<BusinessOutcome, number>;
    useful: number;
    stageTimings: Record<string, StageTiming>;
    providerStats: Map<string, { total: number; failures: number }>;
    totalCost: number;
}

/**
 * Detect and describe operational bottlenecks from run data.
 * Returns human-readable strings that appear in the run summary JSON.
 */
function detectBottlenecks(input: BottleneckInput): string[] {
    const { total, outcomes, useful, stageTimings, providerStats, totalCost } = input;
    const issues: string[] = [];

    if (total === 0) return issues;

    // Exception rate
    const exceptionRate = outcomes.WORKER_EXCEPTION / total;
    if (exceptionRate > 0.05) {
        issues.push(
            `HIGH EXCEPTION RATE: ${(exceptionRate * 100).toFixed(1)}% of jobs threw uncaught exceptions – check provider credentials and network`
        );
    }

    // Discovery failure rate
    const notFoundRate = (outcomes.NOT_FOUND + outcomes.WORKER_EXCEPTION) / total;
    if (notFoundRate > 0.6) {
        issues.push(
            `LOW DISCOVERY YIELD: ${(notFoundRate * 100).toFixed(1)}% of companies not found – consider enabling more discovery lanes or adjusting thresholds`
        );
    }

    // Stage latency
    const discoveryTiming = stageTimings['website_discovery'];
    if (discoveryTiming && discoveryTiming.p95_ms > 30_000) {
        issues.push(
            `SLOW WEBSITE DISCOVERY: p95 latency is ${(discoveryTiming.p95_ms / 1000).toFixed(1)}s – consider reducing NUCLEAR_RUN4 depth or browser timeouts`
        );
    }
    const financialTiming = stageTimings['financial_enrichment'];
    if (financialTiming && financialTiming.p95_ms > 15_000) {
        issues.push(
            `SLOW FINANCIAL ENRICHMENT: p95 latency is ${(financialTiming.p95_ms / 1000).toFixed(1)}s – check VIES/registry provider availability`
        );
    }

    // Provider failure rates
    for (const [family, stats] of providerStats.entries()) {
        if (stats.total >= 10) {
            const failRate = stats.failures / stats.total;
            if (failRate > 0.3) {
                issues.push(
                    `PROVIDER DEGRADED: ${family} failure rate is ${(failRate * 100).toFixed(1)}% (${stats.failures}/${stats.total} requests)`
                );
            }
        }
    }

    // Cost per useful outcome
    if (useful > 0) {
        const costPerUseful = totalCost / useful;
        if (costPerUseful > 0.05) {
            issues.push(
                `HIGH COST PER USEFUL OUTCOME: €${costPerUseful.toFixed(4)}/company – review LLM Oracle usage rate and provider tier selection`
            );
        }
    }

    return issues;
}
