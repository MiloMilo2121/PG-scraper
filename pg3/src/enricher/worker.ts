/**
 * 👷 WORKER - Job Consumer
 * Task 4: Processes enrichment jobs from BullMQ queue
 * 
 * Usage: npx ts-node src/enricher/worker.ts
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Error categorization (no silent death)
 * - Dead letter queue for permanent failures
 */

import { Worker, Job } from 'bullmq';
import { Logger } from './utils/logger';
import { config } from './config';

const CONCURRENCY_LIMIT = config.queue.concurrencyLimit;
const RETRY_ATTEMPTS = config.queue.retryAttempts;

import {
    redisConnection,
    EnrichmentJobData,
    JobResult,
    QUEUE_NAMES,
    moveToDeadLetter,
} from './queue';
import { FinancialService } from './core/financial/service';
import { UnifiedDiscoveryService } from './core/discovery/unified_discovery_service';
import { BrowserFactory } from './core/browser/factory_v2';
import {
    getEnrichmentResult,
    initializeDatabase,
    insertEnrichmentResult,
    logJobResult,
} from './db';

// 🔧 Initialize Services
const financialService = new FinancialService();
const discoveryService = new UnifiedDiscoveryService();
let isShuttingDown = false;
let processHandlersRegistered = false;

/**
 * 🏭 Process a single enrichment job
 */
async function processEnrichmentJob(job: Job<EnrichmentJobData>): Promise<JobResult> {
    const { company_name, city, company_id } = job.data;
    let { website } = job.data;
    const startTime = Date.now();
    const minValidWebsiteConfidence = config.discovery.thresholds.minValid;

    Logger.info(`🔄 Processing: ${company_name}`, {
        company_id,
        company_name,
        attempt: job.attemptsMade + 1,
    });

    try {
        const existing = getEnrichmentResult(company_id);
        if (existing) {
            const duration = Date.now() - startTime;
            Logger.info(`[Worker] ⏭️ Skipping already enriched company: ${company_name}`, {
                company_id,
                duration_ms: duration,
            });
            logJobResult(company_id, 'SUCCESS', duration, job.attemptsMade + 1);
            return {
                success: true,
                company_id,
                vat: existing.vat,
                revenue: existing.revenue,
                employees: existing.employees,
                website_found: existing.website_validated ? 'Yes' : 'No',
                website_url: existing.website_validated || undefined,
            };
        }

        // STEP 1: WEBSITE DISCOVERY / VALIDATION
        const discoveryInput = {
            company_name,
            city,
            address: job.data.address,
            phone: job.data.phone,
            category: job.data.category,
            province: job.data.province,
            website: website || undefined,
        };

        // 1A) If a website is provided, we still verify it before trusting/storing it.
        if (website && website.trim() !== '' && website !== 'null') {
            Logger.info(`[Worker] 🔎 Pre-validating provided website for "${company_name}": ${website}`);
            const verification = await discoveryService.verifyUrl(website, discoveryInput);
            const confidence = verification?.confidence ?? 0;
            if (confidence >= minValidWebsiteConfidence) {
                Logger.info(`[Worker] ✅ Provided website verified (${confidence.toFixed(2)}): ${company_name} -> ${website}`);
            } else {
                Logger.warn(`[Worker] ⚠️ Provided website rejected (${confidence.toFixed(2)} < ${minValidWebsiteConfidence}): ${company_name} -> ${website}`);
                website = undefined;
            }
        }

        // 1B) If missing (or rejected), launch discovery waves.
        if (!website || website.trim() === '' || website === 'null') {
            Logger.info(`[Worker] 🔍 Website missing for "${company_name}". Launching Discovery Waves...`);
            const discoveryResult = await discoveryService.discover(discoveryInput);

            if (discoveryResult.url && discoveryResult.status === 'FOUND_VALID') {
                website = discoveryResult.url;
                Logger.info(`[Worker] ✅ Discovery VALID: ${company_name} -> ${website} (${discoveryResult.confidence.toFixed(2)})`);
            } else if (discoveryResult.url) {
                Logger.warn(
                    `[Worker] ⚠️ Discovery candidate rejected for ${company_name}: ${discoveryResult.url} (Status: ${discoveryResult.status}, Confidence: ${discoveryResult.confidence.toFixed(2)})`
                );
            } else {
                Logger.warn(`[Worker] ⚠️ Discovery failed for ${company_name} (Status: ${discoveryResult.status})`);
            }
        }

        // STEP 2: FINANCIAL ENRICHMENT
        const result = await financialService.enrich(
            {
                company_name,
                city,
                address: job.data.address,
                phone: job.data.phone,
                category: job.data.category,
            },
            website
        );

        const duration = Date.now() - startTime;

        Logger.info(`✅ Enriched: ${company_name}`, {
            company_id,
            duration_ms: duration,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            website,
            has_website: !!website
        });

        insertEnrichmentResult({
            id: `er-${company_id}`,
            company_id,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            is_estimated_employees: result.isEstimatedEmployees,
            pec: result.pec,
            website_validated: website || undefined,
            data_source: result.source || undefined,
        });
        logJobResult(company_id, 'SUCCESS', duration, job.attemptsMade + 1);

        return {
            success: true,
            company_id,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            website_found: website ? 'Yes' : 'No',
            website_url: website || undefined
        };

    } catch (error) {
        const err = error as Error;
        const duration = Date.now() - startTime;

        Logger.logError(`Failed: ${company_name}`, err, {
            company_id,
            company_name,
            duration_ms: duration,
            attempt: job.attemptsMade + 1,
            max_attempts: RETRY_ATTEMPTS,
        });
        logJobResult(
            company_id,
            job.attemptsMade >= RETRY_ATTEMPTS - 1 ? 'FAILED' : 'RETRYING',
            duration,
            job.attemptsMade + 1,
            err.message,
            Logger.categorizeError(err)
        );

        // If this is the last attempt, move to dead letter queue
        if (job.attemptsMade >= RETRY_ATTEMPTS - 1) {
            await moveToDeadLetter(job).catch((dlqError: unknown) => {
                Logger.error('Failed to move job to Dead Letter Queue', {
                    company_name,
                    job_id: job.id,
                    error: dlqError as Error,
                });
            });
        }

        // Rethrow to trigger BullMQ retry
        throw error;
    }
}

/**
 * 🚀 Start the worker
 */
function startWorker(): Worker<EnrichmentJobData, JobResult> {
    const worker = new Worker<EnrichmentJobData, JobResult>(
        QUEUE_NAMES.ENRICHMENT,
        processEnrichmentJob,
        {
            connection: redisConnection,
            concurrency: CONCURRENCY_LIMIT,
            limiter: {
                max: CONCURRENCY_LIMIT,
                duration: 1000, // Per second
            },
        }
    );

    worker.on('completed', (job, result) => {
        Logger.info(`✅ Job completed: ${job.id}`, { result });
    });

    worker.on('failed', (job, err) => {
        if (job) {
            Logger.error(`❌ Job failed: ${job.id}`, {
                error: err,
                company_name: job.data.company_name,
                attempt: job.attemptsMade,
            });
        }
    });

    worker.on('error', (err) => {
        Logger.error('Worker error', { error: err });
    });

    Logger.info(`👷 Worker started with concurrency: ${CONCURRENCY_LIMIT}`);
    return worker;
}

/**
 * 🛑 Graceful Shutdown Handler (Task 6)
 */
async function gracefulShutdown(worker: Worker, signal: string, exitCode: number = 0): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.info(`🛑 ${signal} received. Starting graceful shutdown...`);

    try {
        // Stop accepting new jobs
        await worker.close();
        Logger.info('👷 Worker stopped accepting new jobs');

        // Close browser factory
        await BrowserFactory.getInstance().close();
        Logger.info('🌐 Browser closed');

        // Close Redis connection
        await redisConnection.quit();
        Logger.info('🗄️ Redis connection closed');

        Logger.info('✅ Graceful shutdown complete');
        process.exit(exitCode);
    } catch (error) {
        Logger.error('Error during shutdown', { error: error as Error });
        process.exit(1);
    }
}

function registerProcessHandlers(worker: Worker): void {
    if (processHandlersRegistered) {
        return;
    }
    processHandlersRegistered = true;

    process.once('SIGTERM', () => {
        void gracefulShutdown(worker, 'SIGTERM', 0);
    });
    process.once('SIGINT', () => {
        void gracefulShutdown(worker, 'SIGINT', 0);
    });

    process.on('unhandledRejection', (reason: unknown) => {
        Logger.fatal('Unhandled Promise Rejection', {
            reason: reason instanceof Error ? reason : String(reason),
        });
    });

    process.on('uncaughtException', (error: Error) => {
        Logger.fatal('Uncaught Exception', { error });
        void gracefulShutdown(worker, 'UNCAUGHT_EXCEPTION', 1);
    });
}

// 🚀 Main Entry Point
export async function runWorker(): Promise<Worker<EnrichmentJobData, JobResult>> {
    Logger.info('🚀 WORKER: Starting enrichment processor');
    Logger.info(`🤖 LLM model configured: ${config.llm.model}`);
    initializeDatabase();

    const worker = startWorker();

    // Register shutdown and crash handlers
    registerProcessHandlers(worker);

    Logger.info('👷 Worker is running. Press Ctrl+C to stop.');
    return worker;
}

// Export for programmatic use
export { startWorker };

// Auto-run if executed directly
if (require.main === module) {
    runWorker().catch((err) => {
        Logger.fatal('Worker crashed', { error: err });
        process.exit(1);
    });
}
