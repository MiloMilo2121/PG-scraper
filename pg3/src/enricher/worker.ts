import { Worker, Job } from 'bullmq';
import { config } from './config';
import {
    EnrichmentJobData,
    JobResult,
    QUEUE_NAMES,
    redisConnection,
    moveToDeadLetter,
    closeQueueResources,
} from './queue';
import { initializeDatabase, insertEnrichmentResult, logJobResult } from './db';
import { createOmegaRuntime, OmegaRuntime } from './runtime/runtime_factory';
import { LeadScorer } from './utils/lead_scorer';
import { Logger } from './utils/logger';
import { MetricsServer } from './observability/metrics_server';
import { startHealthServer } from './health';
import { withRuntimeTraceContext } from '../shared-runtime/observability/run_context';

function deterministicResultId(companyId: string): string {
    return `enrichment:${companyId}`;
}

function jobToPipelineInput(job: EnrichmentJobData): Record<string, string> {
    const input: Record<string, string> = {
        company_name: job.company_name,
    };

    const optionalFields: Array<keyof EnrichmentJobData> = [
        'city',
        'province',
        'zip_code',
        'region',
        'address',
        'phone',
        'website',
        'category',
        'source',
        'vat_code',
        'pg_url',
        'email',
    ];

    for (const field of optionalFields) {
        const value = job[field];
        if (typeof value === 'string' && value.trim() !== '') {
            input[field] = value;
        }
    }

    return input;
}

function mapJobResult(job: EnrichmentJobData, pipelineResult: any): JobResult {
    const websiteUrl = pipelineResult.website?.url;
    const vat = pipelineResult.vat || job.vat_code;
    const revenue = pipelineResult.financial?.fatturato_current || pipelineResult.financial?.revenue;
    const employees = pipelineResult.employees || pipelineResult.financial?.employees;
    const hasFinancialSignal = Boolean(
        pipelineResult.financial?.fatturato_current
        || pipelineResult.financial?.fatturato_previous
        || pipelineResult.financial?.utile_netto
        || pipelineResult.financial?.revenue
    );
    const hasAnySignal = Boolean(
        websiteUrl
        || vat
        || hasFinancialSignal
        || employees
        || pipelineResult.pec
        || pipelineResult.email
        || pipelineResult.decision_maker?.name
    );
    const reasonCode = !websiteUrl && hasAnySignal
        ? 'ENRICHMENT_ONLY_NO_WEBSITE'
        : (pipelineResult.reason_code || pipelineResult.status);
    const businessStatus = websiteUrl
        ? 'FOUND_COMPLETE'
        : hasAnySignal
            ? 'ENRICHMENT_ONLY_NO_WEBSITE'
            : 'NOT_FOUND';

    return {
        success: hasAnySignal,
        company_id: job.company_id,
        business_status: businessStatus,
        vat,
        revenue,
        employees: employees ? String(employees) : undefined,
        website_found: websiteUrl ? 'true' : 'false',
        website_url: websiteUrl,
        error: hasAnySignal ? undefined : reasonCode,
        error_category: hasAnySignal ? undefined : 'NOT_FOUND',
        reason_code: reasonCode,
        discovery_method: pipelineResult.website?.discovery_layer,
        discovery_confidence: pipelineResult.website?.confidence,
    };
}

function persistSuccess(job: EnrichmentJobData, pipelineResult: any, durationMs: number, attempt: number): JobResult {
    const result = mapJobResult(job, pipelineResult);
    const stageOutcomes = pipelineResult.meta?.stage_outcomes;
    const persistedReasonCode = result.reason_code || pipelineResult.reason_code || pipelineResult.status;

    if (result.success) {
        const leadScore = LeadScorer.score({
            company_name: job.company_name,
            phone: job.phone,
            address: job.address,
            website: pipelineResult.website?.url,
            email: pipelineResult.email,
            pec: pipelineResult.pec,
            discovery_confidence: pipelineResult.website?.confidence,
        } as any);

        insertEnrichmentResult({
            id: deterministicResultId(job.company_id),
            company_id: job.company_id,
            vat: result.vat,
            revenue: result.revenue,
            revenue_year: pipelineResult.financial?.year || undefined,
            employees: result.employees,
            is_estimated_employees: Boolean(pipelineResult.is_estimated_employees),
            pec: pipelineResult.pec,
            email: pipelineResult.email,
            website_validated: pipelineResult.website?.url,
            decision_maker_name: pipelineResult.decision_maker?.name,
            decision_maker_role: pipelineResult.decision_maker?.role,
            decision_maker_linkedin_url: pipelineResult.decision_maker?.linkedin_url,
            decision_maker_confidence: pipelineResult.decision_maker?.confidence,
            lead_score: leadScore,
            data_source: 'omega_worker',
            discovery_method: pipelineResult.website?.discovery_layer,
            discovery_confidence: pipelineResult.website?.confidence,
            reason_code: persistedReasonCode,
            stage_outcomes: stageOutcomes,
        });
    }

    logJobResult(
        job.company_id,
        'SUCCESS',
        durationMs,
        attempt,
        undefined,
        undefined,
        persistedReasonCode,
        stageOutcomes,
        job.run_id,
        result.business_status
    );

    if (result.business_status) {
        MetricsServer.recordBusinessOutcome(result.business_status);
    }

    return result;
}

async function processJob(job: Job<EnrichmentJobData>, runtime: OmegaRuntime): Promise<JobResult> {
    const startedAt = Date.now();
    const attempt = job.attemptsMade + 1;
    const traceContext = {
        runId: job.data.run_id,
        companyId: job.data.company_id,
        correlationId: job.data.correlation_id,
    };

    return withRuntimeTraceContext(traceContext, async () => {
        try {
            const pipelineResult = await runtime.pipeline.processCompany(
                jobToPipelineInput(job.data),
                0,
                traceContext
            );
            const durationMs = Date.now() - startedAt;
            return persistSuccess(job.data, pipelineResult, durationMs, attempt);
        } catch (error) {
            const err = error as Error;
            const durationMs = Date.now() - startedAt;
            const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : config.queue.retryAttempts;
            const status = attempt >= maxAttempts ? 'FAILED' : 'RETRYING';

            logJobResult(
                job.data.company_id,
                status,
                durationMs,
                attempt,
                err.message,
                Logger.categorizeError(err),
                'WORKER_EXCEPTION',
                undefined,
                job.data.run_id,
                status === 'FAILED' ? 'WORKER_EXCEPTION' : undefined
            );

            if (status === 'FAILED') {
                MetricsServer.recordTechnicalFailure();
            }

            throw err;
        }
    });
}

export async function startWorker(): Promise<void> {
    initializeDatabase();
    const runtime = await createOmegaRuntime();
    let metricsServer: MetricsServer | null = null;

    if (process.env.START_HEALTH_SERVER === 'true') {
        startHealthServer();
    }

    if (process.env.ENABLE_PROMETHEUS_METRICS === 'true') {
        const metricsPort = Number(process.env.METRICS_PORT || 9091);
        metricsServer = new MetricsServer(metricsPort);
        metricsServer.start();
    }

    const worker = new Worker<EnrichmentJobData, JobResult>(
        QUEUE_NAMES.ENRICHMENT,
        async (job) => processJob(job, runtime),
        {
            connection: redisConnection,
            concurrency: config.queue.concurrencyLimit,
            lockDuration: config.queue.lockDurationMs,
            stalledInterval: config.queue.stalledIntervalMs,
            maxStalledCount: config.queue.maxStalledCount,
            prefix: config.queue.prefix,
        }
    );

    worker.on('ready', () => {
        Logger.info('🏭 Worker ready', {
            queue: QUEUE_NAMES.ENRICHMENT,
            concurrency: config.queue.concurrencyLimit,
            lockDurationMs: config.queue.lockDurationMs,
            stalledIntervalMs: config.queue.stalledIntervalMs,
            maxStalledCount: config.queue.maxStalledCount,
            prefix: config.queue.prefix,
        });
    });

    worker.on('completed', (job, result) => {
        Logger.info(`✅ Worker completed job ${job.id}`, {
            company_id: result.company_id,
            success: result.success,
            discovery_method: result.discovery_method,
        });
    });

    worker.on('failed', async (job, error) => {
        Logger.error(`❌ Worker failed job ${job?.id || 'unknown'}`, { error });

        if (!job) {
            return;
        }

        const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : config.queue.retryAttempts;
        if (job.attemptsMade >= maxAttempts) {
            await moveToDeadLetter(job).catch((dlqError: unknown) => {
                Logger.warn('DLQ move failed', { error: dlqError as Error, jobId: job.id });
            });
        }
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        Logger.warn(`Worker shutting down on ${signal}`);
        await worker.close();
        if (metricsServer) {
            // No close hook is exposed; dropping the reference is enough for process shutdown.
            metricsServer = null;
        }
        await runtime.cleanup();
        await closeQueueResources();
        process.exitCode = 0;
    };

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    await worker.waitUntilReady();
}

if (require.main === module) {
    startWorker().catch((error) => {
        Logger.fatal('Worker crashed', { error: error as Error });
        process.exitCode = 1;
    });
}
