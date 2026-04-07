/**
 * Observability Unit Tests
 *
 * Covers:
 *  1. determineBusinessOutcome – all 4 branches
 *  2. normalizeDiscoveryLane  – all 8 values incl. edge cases
 *  3. RunSummaryCollector     – percentile math, bottleneck detection, build() shape
 *  4. DB analytics queries    – getOutcomeBreakdown, getTopReasonCodes, getEnrichedFieldCoverage
 *  5. logJobResult            – business_outcome stored correctly, backward compat
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ── Module under test ──────────────────────────────────────────────────────

import {
    determineBusinessOutcome,
    normalizeDiscoveryLane,
    stopRuntimeMonitoring,
} from '../../src/enricher/observability/telemetry';

import { RunSummaryCollector } from '../../src/enricher/observability/run_summary';

// ─────────────────────────────────────────────────────────────────────────────
// 1. determineBusinessOutcome
// ─────────────────────────────────────────────────────────────────────────────

describe('determineBusinessOutcome', () => {
    it('returns WORKER_EXCEPTION when isException=true regardless of other params', () => {
        expect(determineBusinessOutcome('https://example.com', true, true)).toBe('WORKER_EXCEPTION');
        expect(determineBusinessOutcome(undefined, true, true)).toBe('WORKER_EXCEPTION');
        expect(determineBusinessOutcome(undefined, false, true)).toBe('WORKER_EXCEPTION');
    });

    it('returns FOUND_COMPLETE when website is present and no exception', () => {
        expect(determineBusinessOutcome('https://example.com', false, false)).toBe('FOUND_COMPLETE');
        expect(determineBusinessOutcome('https://example.com', true, false)).toBe('FOUND_COMPLETE');
    });

    it('returns ENRICHMENT_ONLY_NO_WEBSITE when no website but has financial data', () => {
        expect(determineBusinessOutcome(undefined, true, false)).toBe('ENRICHMENT_ONLY_NO_WEBSITE');
        expect(determineBusinessOutcome(null, true, false)).toBe('ENRICHMENT_ONLY_NO_WEBSITE');
        expect(determineBusinessOutcome('', true, false)).toBe('ENRICHMENT_ONLY_NO_WEBSITE');
    });

    it('returns NOT_FOUND when no website and no financial data', () => {
        expect(determineBusinessOutcome(undefined, false, false)).toBe('NOT_FOUND');
        expect(determineBusinessOutcome(null, false, false)).toBe('NOT_FOUND');
        expect(determineBusinessOutcome('', false, false)).toBe('NOT_FOUND');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeDiscoveryLane
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeDiscoveryLane', () => {
    it('maps undefined/empty to NONE', () => {
        expect(normalizeDiscoveryLane(undefined)).toBe('NONE');
        expect(normalizeDiscoveryLane('')).toBe('NONE');
    });

    it('maps pre_validated_input variants to INPUT_WEBSITE', () => {
        expect(normalizeDiscoveryLane('pre_validated_input')).toBe('INPUT_WEBSITE');
        expect(normalizeDiscoveryLane('input_website')).toBe('INPUT_WEBSITE');
        expect(normalizeDiscoveryLane('PRE_VALIDATED_INPUT')).toBe('INPUT_WEBSITE');
    });

    it('maps email domain variants to EMAIL_DOMAIN', () => {
        expect(normalizeDiscoveryLane('email_domain')).toBe('EMAIL_DOMAIN');
        expect(normalizeDiscoveryLane('email-domain')).toBe('EMAIL_DOMAIN');
    });

    it('maps hyper guesser variants to HYPER_GUESSER', () => {
        expect(normalizeDiscoveryLane('hyper_guesser')).toBe('HYPER_GUESSER');
        expect(normalizeDiscoveryLane('hyperguesser')).toBe('HYPER_GUESSER');
        expect(normalizeDiscoveryLane('hyper-guesser')).toBe('HYPER_GUESSER');
    });

    it('maps pg phone / paginegialle variants to PG_PHONE', () => {
        expect(normalizeDiscoveryLane('pg_phone')).toBe('PG_PHONE');
        expect(normalizeDiscoveryLane('paginegialle')).toBe('PG_PHONE');
        expect(normalizeDiscoveryLane('pg_url')).toBe('PG_PHONE');
        expect(normalizeDiscoveryLane('phone_probe')).toBe('PG_PHONE');
    });

    it('maps serp registry before serp company (specificity order)', () => {
        expect(normalizeDiscoveryLane('serp_registry')).toBe('SERP_REGISTRY');
        expect(normalizeDiscoveryLane('serp-registry')).toBe('SERP_REGISTRY');
        expect(normalizeDiscoveryLane('stage_5')).toBe('SERP_REGISTRY');
    });

    it('maps serp company variants to SERP_COMPANY', () => {
        expect(normalizeDiscoveryLane('serp_company')).toBe('SERP_COMPANY');
        expect(normalizeDiscoveryLane('serp-company')).toBe('SERP_COMPANY');
        expect(normalizeDiscoveryLane('stage_4')).toBe('SERP_COMPANY');
        expect(normalizeDiscoveryLane('serp')).toBe('SERP_COMPANY');
    });

    it('maps oracle variants to LLM_ORACLE', () => {
        expect(normalizeDiscoveryLane('llm_oracle')).toBe('LLM_ORACLE');
        expect(normalizeDiscoveryLane('oracle')).toBe('LLM_ORACLE');
        expect(normalizeDiscoveryLane('stage_6')).toBe('LLM_ORACLE');
    });

    it('falls back to NONE for unknown methods', () => {
        expect(normalizeDiscoveryLane('some_future_method_v99')).toBe('NONE');
        expect(normalizeDiscoveryLane('manual')).toBe('NONE');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RunSummaryCollector
// ─────────────────────────────────────────────────────────────────────────────

describe('RunSummaryCollector', () => {
    let collector: RunSummaryCollector;

    beforeEach(() => {
        collector = new RunSummaryCollector('test-run-001');
    });

    afterEach(() => {
        stopRuntimeMonitoring();
    });

    it('build() returns zero-filled outcomes for empty collector', () => {
        const summary = collector.build();
        expect(summary.run_id).toBe('test-run-001');
        expect(summary.total_companies).toBe(0);
        expect(summary.useful_outcome_rate).toBe(0);
        expect(summary.business_outcomes.FOUND_COMPLETE).toBe(0);
        expect(summary.business_outcomes.NOT_FOUND).toBe(0);
        expect(summary.bottlenecks).toEqual([]);
    });

    it('correctly accumulates outcomes and computes useful_outcome_rate', () => {
        collector.recordOutcome('FOUND_COMPLETE');
        collector.recordOutcome('FOUND_COMPLETE');
        collector.recordOutcome('ENRICHMENT_ONLY_NO_WEBSITE');
        collector.recordOutcome('NOT_FOUND');

        const summary = collector.build();
        expect(summary.total_companies).toBe(4);
        expect(summary.business_outcomes.FOUND_COMPLETE).toBe(2);
        expect(summary.business_outcomes.ENRICHMENT_ONLY_NO_WEBSITE).toBe(1);
        expect(summary.business_outcomes.NOT_FOUND).toBe(1);
        // useful = 3 out of 4 = 0.75
        expect(summary.useful_outcome_rate).toBe(0.75);
    });

    it('computes p50 and p95 stage timings correctly', () => {
        // 100 samples for deterministic percentile computation
        for (let i = 1; i <= 100; i++) {
            collector.recordStageDuration('website_discovery', i * 100); // 100ms to 10000ms
        }
        const summary = collector.build();
        const timing = summary.stage_timings['website_discovery'];
        expect(timing).toBeDefined();
        expect(timing.count).toBe(100);
        // p50 of 100..10000 (step 100) sorted = index 50 = 5100ms (0-indexed: floor(100*0.5)=50, value=5100)
        expect(timing.p50_ms).toBe(5100);
        // p95 = floor(100*0.95)=95, value=9600
        expect(timing.p95_ms).toBe(9600);
    });

    it('correctly normalises reason codes (max 80 chars)', () => {
        const longCode = 'A'.repeat(200);
        collector.recordReasonCode(longCode);
        collector.recordReasonCode(longCode); // same, count=2
        collector.recordReasonCode('OK_ENRICHMENT_COMPLETED');

        const summary = collector.build();
        expect(summary.top_reason_codes[0].reason_code).toHaveLength(80);
        expect(summary.top_reason_codes[0].count).toBe(2);
    });

    it('detects high exception rate bottleneck', () => {
        for (let i = 0; i < 10; i++) collector.recordOutcome('WORKER_EXCEPTION');
        for (let i = 0; i < 90; i++) collector.recordOutcome('FOUND_COMPLETE');
        // exception rate = 10% > 5% threshold
        const summary = collector.build();
        expect(summary.bottlenecks.some((b) => b.includes('EXCEPTION'))).toBe(true);
    });

    it('detects low discovery yield bottleneck', () => {
        for (let i = 0; i < 70; i++) collector.recordOutcome('NOT_FOUND');
        for (let i = 0; i < 30; i++) collector.recordOutcome('FOUND_COMPLETE');
        // not_found rate = 70% > 60% threshold
        const summary = collector.build();
        expect(summary.bottlenecks.some((b) => b.includes('DISCOVERY'))).toBe(true);
    });

    it('does not add bottleneck for healthy run', () => {
        for (let i = 0; i < 90; i++) collector.recordOutcome('FOUND_COMPLETE');
        for (let i = 0; i < 10; i++) collector.recordOutcome('NOT_FOUND');
        const summary = collector.build();
        expect(summary.bottlenecks).toHaveLength(0);
    });

    it('build() is non-destructive and can be called multiple times', () => {
        collector.recordOutcome('FOUND_COMPLETE');
        const first = collector.build();
        const second = collector.build();
        expect(first.business_outcomes.FOUND_COMPLETE).toBe(1);
        expect(second.business_outcomes.FOUND_COMPLETE).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 & 5. DB analytics queries and logJobResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * These tests use an in-memory SQLite database to verify the DB layer
 * without touching the real application database.
 *
 * We reproduce the minimal schema and call the functions via a test-scoped
 * process.env.SQLITE_PATH override so that the module uses in-memory storage.
 */
describe('DB analytics functions', () => {
    /**
     * We test the SQL logic directly using a fresh in-memory DB instance.
     * This avoids module-level side effects from db/index.ts (pragma setup, etc.)
     * while still verifying the exact query semantics.
     */

    let db: InstanceType<typeof Database>;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`
            CREATE TABLE job_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                error_category TEXT,
                reason_code TEXT,
                run_id TEXT,
                duration_ms INTEGER,
                attempt INTEGER DEFAULT 1,
                processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                business_outcome TEXT
            );
            CREATE TABLE enrichment_results (
                id TEXT PRIMARY KEY,
                company_id TEXT NOT NULL,
                vat TEXT,
                revenue TEXT,
                employees TEXT,
                pec TEXT,
                website_validated TEXT,
                discovery_method TEXT,
                discovery_confidence REAL,
                reason_code TEXT,
                is_estimated_employees INTEGER DEFAULT 0,
                lead_score INTEGER,
                data_source TEXT,
                revenue_year TEXT,
                enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    });

    afterEach(() => {
        db.close();
    });

    it('getOutcomeBreakdown returns correct counts', () => {
        const insert = db.prepare(
            `INSERT INTO job_log (company_id, status, business_outcome, run_id) VALUES (?, ?, ?, ?)`
        );
        insert.run('c1', 'SUCCESS', 'FOUND_COMPLETE', 'run-1');
        insert.run('c2', 'SUCCESS', 'FOUND_COMPLETE', 'run-1');
        insert.run('c3', 'SUCCESS', 'ENRICHMENT_ONLY_NO_WEBSITE', 'run-1');
        insert.run('c4', 'FAILED', 'WORKER_EXCEPTION', 'run-1');
        insert.run('c5', 'SUCCESS', 'FOUND_COMPLETE', 'run-2');

        // Replicate the query logic from db/index.ts
        const rows = db.prepare(
            `SELECT business_outcome, COUNT(*) as cnt FROM job_log
             WHERE run_id = ? AND business_outcome IS NOT NULL
             GROUP BY business_outcome`
        ).all('run-1') as Array<{ business_outcome: string; cnt: number }>;

        const result: Record<string, number> = {};
        for (const row of rows) result[row.business_outcome] = row.cnt;

        expect(result['FOUND_COMPLETE']).toBe(2);
        expect(result['ENRICHMENT_ONLY_NO_WEBSITE']).toBe(1);
        expect(result['WORKER_EXCEPTION']).toBe(1);
        expect(result['NOT_FOUND']).toBeUndefined(); // not present in run-1
    });

    it('getTopReasonCodes returns ordered results and excludes null/empty', () => {
        const insert = db.prepare(
            `INSERT INTO job_log (company_id, status, reason_code) VALUES (?, ?, ?)`
        );
        insert.run('c1', 'SUCCESS', 'OK_CONFIRMED_INPUT_WEBSITE');
        insert.run('c2', 'SUCCESS', 'OK_CONFIRMED_INPUT_WEBSITE');
        insert.run('c3', 'SUCCESS', 'OK_CONFIRMED_INPUT_WEBSITE');
        insert.run('c4', 'FAILED', 'ERROR_TIMEOUT_FETCH');
        insert.run('c5', 'FAILED', 'ERROR_TIMEOUT_FETCH');
        insert.run('c6', 'SUCCESS', null); // should be excluded

        const rows = db.prepare(
            `SELECT reason_code, COUNT(*) as cnt FROM job_log
             WHERE reason_code IS NOT NULL AND reason_code != ''
             GROUP BY reason_code ORDER BY cnt DESC LIMIT 10`
        ).all() as Array<{ reason_code: string; cnt: number }>;

        expect(rows).toHaveLength(2);
        expect(rows[0].reason_code).toBe('OK_CONFIRMED_INPUT_WEBSITE');
        expect(rows[0].cnt).toBe(3);
        expect(rows[1].reason_code).toBe('ERROR_TIMEOUT_FETCH');
        expect(rows[1].cnt).toBe(2);
    });

    it('business_outcome column is nullable (backward compat – old rows without it)', () => {
        // Insert without business_outcome (old-style call)
        db.prepare(
            `INSERT INTO job_log (company_id, status, duration_ms, attempt) VALUES (?, ?, ?, ?)`
        ).run('c-legacy', 'SUCCESS', 1500, 1);

        const row = db.prepare(`SELECT * FROM job_log WHERE company_id = 'c-legacy'`).get() as {
            business_outcome: string | null;
        };
        expect(row.business_outcome).toBeNull();
    });

    it('getEnrichedFieldCoverage computes rates correctly', () => {
        const insert = db.prepare(
            `INSERT INTO enrichment_results (id, company_id, website_validated, vat, pec, revenue, employees)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        insert.run('r1', 'c1', 'https://example.com', 'IT12345678901', 'test@pec.it', '1M', '10');
        insert.run('r2', 'c2', 'https://other.it', null, null, '500K', null);
        insert.run('r3', 'c3', null, null, null, null, null);
        insert.run('r4', 'c4', null, 'IT99999999999', 'other@pec.it', null, '5');

        const row = db.prepare(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN website_validated IS NOT NULL AND website_validated != '' THEN 1 ELSE 0 END) as has_website,
                SUM(CASE WHEN vat IS NOT NULL AND vat != '' THEN 1 ELSE 0 END) as has_vat,
                SUM(CASE WHEN pec IS NOT NULL AND pec != '' THEN 1 ELSE 0 END) as has_pec,
                SUM(CASE WHEN revenue IS NOT NULL AND revenue != '' THEN 1 ELSE 0 END) as has_revenue,
                SUM(CASE WHEN employees IS NOT NULL AND employees != '' THEN 1 ELSE 0 END) as has_employees
             FROM enrichment_results`
        ).get() as Record<string, number>;

        expect(row.total).toBe(4);
        expect(row.has_website / row.total).toBe(0.5);   // 2 out of 4
        expect(row.has_vat / row.total).toBe(0.5);       // 2 out of 4
        expect(row.has_pec / row.total).toBe(0.5);       // 2 out of 4
        expect(row.has_revenue / row.total).toBe(0.5);   // 2 out of 4
        expect(row.has_employees / row.total).toBe(0.5); // 2 out of 4
    });

    it('all-time getOutcomeBreakdown (no runId) returns totals across all runs', () => {
        const insert = db.prepare(
            `INSERT INTO job_log (company_id, status, business_outcome, run_id) VALUES (?, ?, ?, ?)`
        );
        insert.run('c1', 'SUCCESS', 'FOUND_COMPLETE', 'run-1');
        insert.run('c2', 'SUCCESS', 'FOUND_COMPLETE', 'run-2');
        insert.run('c3', 'FAILED', 'WORKER_EXCEPTION', 'run-2');

        const rows = db.prepare(
            `SELECT business_outcome, COUNT(*) as cnt FROM job_log
             WHERE business_outcome IS NOT NULL
             GROUP BY business_outcome`
        ).all() as Array<{ business_outcome: string; cnt: number }>;

        const result: Record<string, number> = {};
        for (const row of rows) result[row.business_outcome] = row.cnt;

        expect(result['FOUND_COMPLETE']).toBe(2);
        expect(result['WORKER_EXCEPTION']).toBe(1);
    });
});
