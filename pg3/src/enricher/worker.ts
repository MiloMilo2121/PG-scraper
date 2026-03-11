import * as crypto from 'crypto';
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
import { createOmegaRuntime, OmegaRuntime } from '../foundation/runtime_factory';
import { LeadScorer } from './utils/lead_scorer';
import { Logger } from './utils/logger';
import { MetricsServer } from './observability/metrics_server';
import { startHealthServer } from './health';

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
    const revenue = pipelineResult.financial?.fatturato_current || pipelineResult.financial?.revenue;
    const revenueYear = pipelineResult.financial?.year;
    const employees = pipelineResult.employees || pipelineResult.financial?.employees;

    return {
        success: pipelineResult.status === 'FOUND_COMPLETE',
        company_id: job.company_id,
        vat: job.vat_code,
        revenue,
        employees: employees ? String(employees) : undefined,
        website_found: websiteUrl ? 'true' : 'false',
        website_url: websiteUrl,
        error: pipelineResult.status === 'FOUND_COMPLETE' ? undefined : pipelineResult.status,
        error_category: pipelineResult.status === 'FOUND_COMPLETE' ? undefined : 'NOT_FOUND',
        reason_code: pipelineResult.status,
        discovery_method: pipelineResult.website?.discovery_layer,
        discovery_confidence: pipelineResult.website?.confidence,
    };
}

function persistSuccess(job: EnrichmentJobData, pipelineResult: any, durationMs: number, attempt: number): JobResult {
    const result = mapJobResult(job, pipelineResult);

    if (pipelineResult.status === 'FOUND_COMPLETE' && pipelineResult.website?.url) {
        const leadScore = LeadScorer.score({
            company_name: job.company_name,
            phone: job.phone,
            address: job.address,
            website: pipelineResult.website.url,
            discovery_confidence: pipelineResult.website.confidence,
        } as any);

        insertEnrichmentResult({
            id: crypto.randomUUID(),
            company_id: job.company_id,
            vat: job.vat_code,
            revenue: result.revenue,
            revenue_year: pipelineResult.financial?.year || undefined,
            employees: result.employees,
            is_estimated_employees: false,
            pec: pipelineResult.pec,
            website_validated: pipelineResult.website.url,
            lead_score: leadScore,
            data_source: 'omega_worker',
            discovery_method: pipelineResult.website.discovery_layer,
            discovery_confidence: pipelineResult.website.confidence,
            reason_code: pipelineResult.status,
        });
    }

    logJobResult(
        job.company_id,
        'SUCCESS',
        durationMs,
        attempt,
        undefined,
        undefined,
        pipelineResult.status,
        job.run_id
    );

    return result;
}

async function processJob(job: Job<EnrichmentJobData>, runtime: OmegaRuntime): Promise<JobResult> {
    const startedAt = Date.now();
    const attempt = job.attemptsMade + 1;

    try {
        const pipelineResult = await runtime.pipeline.processCompany(jobToPipelineInput(job.data), 0);
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
            job.data.run_id
        );

        throw err;
    }
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
        }
    );

    worker.on('ready', () => {
        Logger.info('🏭 Worker ready', {
            queue: QUEUE_NAMES.ENRICHMENT,
            concurrency: config.queue.concurrencyLimit,
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

    const shutdown = async (signal: string) => {
        Logger.warn(`Worker shutting down on ${signal}`);
        await worker.close();
        if (metricsServer) {
            // No close hook is exposed; dropping the reference is enough for process shutdown.
            metricsServer = null;
        }
        await runtime.cleanup();
        await closeQueueResources();
    };

    process.on('SIGINT', () => {
        shutdown('SIGINT').finally(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
        shutdown('SIGTERM').finally(() => process.exit(0));
    });

    await worker.waitUntilReady();
}

if (require.main === module) {
    startWorker().catch((error) => {
        Logger.fatal('Worker crashed', { error: error as Error });
        process.exit(1);
    });
}
