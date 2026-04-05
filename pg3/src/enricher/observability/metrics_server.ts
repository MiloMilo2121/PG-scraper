
import express from 'express';
import { register, Counter, Gauge, Histogram } from 'prom-client';
import { Logger } from '../utils/logger';

/**
 * 📊 METRICS SERVER 📊
 * Tasks 31, 32, 33: Prometheus Endpoint & Core Metrics
 */
export class MetricsServer {
    private app = express();
    private port: number;
    private static processedCount = 0;
    private static usefulOutcomeCount = 0;
    private static consecutiveFailureCount = 0;

    // Task 32: Success Rate
    static validationYield = new Gauge({
        name: 'pulse_validation_yield_percent',
        help: 'Current percentage of successful validations'
    });

    static companiesProcessed = new Counter({
        name: 'pulse_companies_processed_total',
        help: 'Total number of companies processed'
    });

    static successfulFinds = new Counter({
        name: 'pulse_successful_finds_total',
        help: 'Total number of websites successfully found'
    });

    static enrichmentOnlyFinds = new Counter({
        name: 'pulse_enrichment_only_total',
        help: 'Total number of successful enrichment-only outcomes without validated website'
    });

    static notFoundOutcomes = new Counter({
        name: 'pulse_not_found_total',
        help: 'Total number of processed companies with no useful enrichment outcome'
    });

    static technicalFailures = new Counter({
        name: 'pulse_worker_failures_total',
        help: 'Total number of terminal worker failures'
    });

    static businessOutcomes = new Counter({
        name: 'pulse_business_outcomes_total',
        help: 'Terminal business outcomes observed by the worker',
        labelNames: ['outcome'] as const,
    });

    // Task 33: Event Loop Lag
    static eventLoopLag = new Gauge({
        name: 'pulse_event_loop_lag_seconds',
        help: 'Node.js Event Loop Lag in seconds'
    });

    // Task 34: Death Spiral (Consecutive Failures)
    static consecutiveFailures = new Gauge({
        name: 'pulse_consecutive_failures',
        help: 'Current count of consecutive failures'
    });

    // Task 35: Memory Usage
    static heapUsed = new Gauge({
        name: 'pulse_heap_used_bytes',
        help: 'Heap memory used in bytes'
    });

    constructor(port: number = 9091) {
        this.port = port;
        this.setupRoutes();
        this.startMonitoring();
    }

    private setupRoutes() {
        this.app.get('/metrics', async (req, res) => {
            try {
                res.set('Content-Type', register.contentType);
                res.end(await register.metrics());
            } catch (ex) {
                res.status(500).end(ex);
            }
        });
    }

    public start() {
        this.app.listen(this.port, () => {
            Logger.info(`[Metrics] Server listening on :${this.port}/metrics`);
        });
    }

    private startMonitoring() {
        // Monitor Event Loop & Memory every 5s
        setInterval(() => {
            const start = Date.now();
            setImmediate(() => {
                const lag = (Date.now() - start) / 1000;
                MetricsServer.eventLoopLag.set(lag);
            });

            const mem = process.memoryUsage();
            MetricsServer.heapUsed.set(mem.heapUsed);
        }, 5000);
    }

    /**
     * Updates the yield gauge based on counters
     */
    static updateYield() {
        const yieldPercent = MetricsServer.processedCount === 0
            ? 0
            : (MetricsServer.usefulOutcomeCount / MetricsServer.processedCount) * 100;
        MetricsServer.validationYield.set(yieldPercent);
    }

    static recordBusinessOutcome(outcome: 'FOUND_COMPLETE' | 'ENRICHMENT_ONLY_NO_WEBSITE' | 'NOT_FOUND'): void {
        MetricsServer.companiesProcessed.inc();
        MetricsServer.processedCount += 1;
        MetricsServer.businessOutcomes.inc({ outcome });

        if (outcome === 'FOUND_COMPLETE') {
            MetricsServer.successfulFinds.inc();
            MetricsServer.usefulOutcomeCount += 1;
            MetricsServer.consecutiveFailureCount = 0;
        } else if (outcome === 'ENRICHMENT_ONLY_NO_WEBSITE') {
            MetricsServer.enrichmentOnlyFinds.inc();
            MetricsServer.usefulOutcomeCount += 1;
            MetricsServer.consecutiveFailureCount = 0;
        } else {
            MetricsServer.notFoundOutcomes.inc();
            MetricsServer.consecutiveFailureCount += 1;
        }

        MetricsServer.consecutiveFailures.set(MetricsServer.consecutiveFailureCount);
        MetricsServer.updateYield();
    }

    static recordTechnicalFailure(): void {
        MetricsServer.technicalFailures.inc();
        MetricsServer.consecutiveFailureCount += 1;
        MetricsServer.consecutiveFailures.set(MetricsServer.consecutiveFailureCount);
    }
}
