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
import { Logger, ErrorCategory } from './utils/logger';

// Environment config with defaults
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || '10');
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || '3');

import {
    redisConnection,
    EnrichmentJobData,
    JobResult,
    QUEUE_NAMES,
    moveToDeadLetter,
} from './queue';
import { FinancialService } from './core/financial/service';
import { BrowserFactory } from './core/browser/factory_v2';

// 🔧 Initialize Services
const financialService = new FinancialService();
let isShuttingDown = false;

/**
 * 🏭 Process a single enrichment job
 */
async function processEnrichmentJob(job: Job<EnrichmentJobData>): Promise<JobResult> {
    const { company_name, city, website, company_id } = job.data;
    const startTime = Date.now();

    Logger.info(`🔄 Processing: ${company_name}`, {
        company_id,
        company_name,
        attempt: job.attemptsMade + 1,
    });

    try {
        // Call the financial enrichment service
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
            has_revenue: !!result.revenue,
        });

        return {
            success: true,
            company_id,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            website_found: website ? 'Yes' : 'No',
        };

    } catch (error) {
        const err = error as Error;
        const category = Logger.categorizeError(err);
        const duration = Date.now() - startTime;

        Logger.logError(`Failed: ${company_name}`, err, {
            company_id,
            company_name,
            duration_ms: duration,
            attempt: job.attemptsMade + 1,
            max_attempts: RETRY_ATTEMPTS,
        });

        // If this is the last attempt, move to dead letter queue
        if (job.attemptsMade >= RETRY_ATTEMPTS - 1) {
            await moveToDeadLetter(job);
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
async function gracefulShutdown(worker: Worker, signal: string): Promise<void> {
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
        process.exit(0);
    } catch (error) {
        Logger.error('Error during shutdown', { error: error as Error });
        process.exit(1);
    }
}

// 🚀 Main Entry Point
async function main() {
    Logger.info('🚀 WORKER: Starting enrichment processor');

    const worker = startWorker();

    // Register shutdown handlers (Task 6)
    process.on('SIGTERM', () => gracefulShutdown(worker, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(worker, 'SIGINT'));

    Logger.info('👷 Worker is running. Press Ctrl+C to stop.');
}

main().catch((err) => {
    Logger.fatal('Worker crashed', { error: err });
    process.exit(1);
});
