/**
 * OBSERVABILITY HTTP SERVER
 *
 * Exposes three endpoints:
 *
 *   GET /metrics      – Prometheus text format (scrape target for Prometheus/Grafana)
 *   GET /stats        – Rich JSON snapshot: DB outcomes, queue health, runtime state
 *   GET /run-summary  – Last run-level JSON summary (or 204 if no run active)
 *
 * All metrics come from the dedicated `metricsRegistry` in telemetry.ts.
 * The legacy `pulse_*` stubs that were never incremented have been removed.
 *
 * Port: 9091 (default) or set via METRICS_PORT environment variable.
 */

import express, { Request, Response } from 'express';
import { metricsRegistry, queueJobs, startRuntimeMonitoring } from './telemetry';
import { getActiveRunSummary } from './run_summary';
import { getStats, getOutcomeBreakdown, getTopReasonCodes, getEnrichedFieldCoverage } from '../db';
import { getQueueHealth } from '../queue';
import { Logger } from '../utils/logger';

const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? '9091', 10);

// How often to refresh queue depth gauges (ms)
const QUEUE_POLL_INTERVAL_MS = 15_000;

export class MetricsServer {
    private readonly app: express.Application;
    private readonly port: number;
    private queuePollTimer: ReturnType<typeof setInterval> | null = null;

    constructor(port: number = METRICS_PORT) {
        this.port = port;
        this.app = express();
        this.setupRoutes();

        // Start runtime sampling (event loop, memory) – idempotent
        startRuntimeMonitoring();

        // Start queue gauge polling
        this.startQueuePolling();
    }

    // ── Route setup ────────────────────────────────────────────────────────────

    private setupRoutes(): void {
        /**
         * GET /metrics
         * Prometheus scrape endpoint.
         * Contains ALL pg_* metrics plus pg_node_* default Node.js metrics.
         */
        this.app.get('/metrics', async (_req: Request, res: Response) => {
            try {
                res.set('Content-Type', metricsRegistry.contentType);
                res.end(await metricsRegistry.metrics());
            } catch (err) {
                Logger.error('[MetricsServer] /metrics error', { error: err as Error });
                res.status(500).end('Internal Server Error');
            }
        });

        /**
         * GET /stats
         * Rich JSON snapshot useful for dashboards, alerting, and ad-hoc debugging.
         *
         * Returns:
         *   database  – counts + outcome breakdown + field coverage + top reason codes
         *   queue     – BullMQ job counts per state
         *   runtime   – uptime, heap, rss
         *   timestamp – ISO8601
         */
        this.app.get('/stats', async (_req: Request, res: Response) => {
            try {
                const [dbStats, queueHealth] = await Promise.all([
                    Promise.resolve(buildDbStats()),
                    getQueueHealth(),
                ]);

                const mem = process.memoryUsage();

                res.status(200).json({
                    database: dbStats,
                    queue: {
                        ...queueHealth.enrichmentQueue,
                        redis_connected: queueHealth.redis,
                        error: queueHealth.error ?? null,
                    },
                    runtime: {
                        uptime_s: Math.round(process.uptime()),
                        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
                        rss_mb: Math.round(mem.rss / 1024 / 1024),
                    },
                    timestamp: new Date().toISOString(),
                });
            } catch (err) {
                Logger.error('[MetricsServer] /stats error', { error: err as Error });
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        /**
         * GET /run-summary
         * Returns the in-memory run summary for the currently active run (if any).
         * Returns 204 No Content if no run has been initialised in this process.
         *
         * Use this for live run inspection or post-run artifact retrieval.
         */
        this.app.get('/run-summary', (_req: Request, res: Response) => {
            const collector = getActiveRunSummary();
            if (!collector) {
                res.status(204).end();
                return;
            }
            res.status(200).json(collector.build());
        });

        // Default 404
        this.app.use((_req: Request, res: Response) => {
            res.status(404).json({
                error: 'Not Found',
                available_endpoints: ['/metrics', '/stats', '/run-summary'],
            });
        });
    }

    // ── Queue gauge polling ────────────────────────────────────────────────────

    /**
     * Poll BullMQ queue depths every QUEUE_POLL_INTERVAL_MS and update Prometheus gauges.
     * Uses setInterval(...).unref() so it doesn't block graceful shutdown.
     */
    private startQueuePolling(): void {
        const poll = async (): Promise<void> => {
            try {
                const health = await getQueueHealth();
                const counts = health.enrichmentQueue;
                queueJobs.set({ queue: 'enrichment', state: 'waiting' }, counts.waiting);
                queueJobs.set({ queue: 'enrichment', state: 'active' }, counts.active);
                queueJobs.set({ queue: 'enrichment', state: 'failed' }, counts.failed);
                queueJobs.set({ queue: 'enrichment', state: 'completed' }, counts.completed);
            } catch {
                // Non-fatal: Redis may be temporarily unavailable
            }
        };

        // Run once immediately, then on interval
        void poll();
        this.queuePollTimer = setInterval(poll, QUEUE_POLL_INTERVAL_MS);
        this.queuePollTimer.unref();
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    public start(): void {
        this.app.listen(this.port, () => {
            Logger.info(`[MetricsServer] Listening on :${this.port} (/metrics | /stats | /run-summary)`);
        });
    }

    public stop(): void {
        if (this.queuePollTimer) {
            clearInterval(this.queuePollTimer);
            this.queuePollTimer = null;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the `database` section of /stats.
 * Catches errors from each sub-query independently so a failing analytics
 * query doesn't break the whole /stats response.
 */
function buildDbStats(): Record<string, unknown> {
    let rawStats: { total: number; enriched: number; pending: number; failed: number } = {
        total: 0, enriched: 0, pending: 0, failed: 0,
    };
    let outcomeBreakdown: Record<string, number> = {};
    let topReasonCodes: Array<{ reason_code: string; count: number }> = [];
    let fieldCoverage: ReturnType<typeof getEnrichedFieldCoverage> | null = null;

    try { rawStats = getStats(); } catch { /* db not initialised */ }
    try { outcomeBreakdown = getOutcomeBreakdown(); } catch { /* ok */ }
    try { topReasonCodes = getTopReasonCodes(undefined, 10); } catch { /* ok */ }
    try { fieldCoverage = getEnrichedFieldCoverage(); } catch { /* ok */ }

    return {
        ...rawStats,
        outcome_breakdown: outcomeBreakdown,
        top_reason_codes: topReasonCodes,
        field_coverage: fieldCoverage ?? null,
    };
}
