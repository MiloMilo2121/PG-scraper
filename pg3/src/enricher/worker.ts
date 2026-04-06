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
import { UnifiedDiscoveryService, DiscoveryMode } from './core/discovery/unified_discovery_service';
import { BrowserFactory } from './core/browser/factory_v2';
import {
    getEnrichmentResult,
    initializeDatabase,
    insertEnrichmentResult,
    logJobResult,
} from './db';
import {
    companiesProcessed,
    discoveryLaneTotal,
    enrichmentFieldFound,
    stageDuration,
    stageOutcome,
    companyProcessingDuration,
    normalizeDiscoveryLane,
    determineBusinessOutcome,
    startRuntimeMonitoring,
} from './observability/telemetry';
import { getActiveRunSummary } from './observability/run_summary';

// 🔧 Initialize Services
const financialService = new FinancialService();
const discoveryService = new UnifiedDiscoveryService();
let isShuttingDown = false;
let processHandlersRegistered = false;

function mapErrorToReasonCode(error: Error): string {
    const category = Logger.categorizeError(error);
    switch (category) {
        case 'NETWORK':
            return 'ERROR_TIMEOUT_FETCH';
        case 'AUTH':
            return 'ERROR_PROVIDER_RATE_LIMIT';
        case 'BROWSER':
            return 'ERROR_BROWSER_FAILURE';
        case 'PARSING':
            return 'ERROR_PARSING';
        case 'VALIDATION':
            return 'ERROR_VALIDATION';
        default:
            return 'ERROR_INTERNAL';
    }
}

/**
 * 🏭 Process a single enrichment job
 */
async function processEnrichmentJob(job: Job<EnrichmentJobData>): Promise<JobResult> {
    const { company_name, city, company_id, run_id, correlation_id } = job.data;
    let { website } = job.data;
    const startTime = Date.now();
    const minValidWebsiteConfidence = config.discovery.thresholds.minValid;

    Logger.info(`🔄 Processing: ${company_name}`, {
        company_id,
        company_name,
        run_id,
        correlation_id,
        attempt: job.attemptsMade + 1,
    });

    try {
        const existing = getEnrichmentResult(company_id);
        if (existing) {
            const duration = Date.now() - startTime;
            Logger.info(`[Worker] ⏭️ Skipping already enriched company: ${company_name}`, {
                company_id,
                run_id,
                correlation_id,
                duration_ms: duration,
            });
            // Already enriched – classify outcome from cached result
            const cachedOutcome = determineBusinessOutcome(
                existing.website_validated || undefined,
                !!(existing.vat || existing.pec || existing.revenue || existing.employees),
                false
            );
            logJobResult(
                company_id,
                'SUCCESS',
                duration,
                job.attemptsMade + 1,
                undefined,
                undefined,
                'OK_ALREADY_ENRICHED',
                run_id,
                cachedOutcome
            );
            companiesProcessed.inc({ outcome: cachedOutcome });
            companyProcessingDuration.observe(duration / 1000);
            getActiveRunSummary()?.recordOutcome(cachedOutcome);
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
            zip_code: job.data.zip_code,
            region: job.data.region,
            address: job.data.address,
            phone: job.data.phone,
            category: job.data.category,
            province: job.data.province,
            vat_code: job.data.vat_code,
            pg_url: job.data.pg_url,
            email: job.data.email,
            source: job.data.source,
            website: website || undefined,
        };

        // 1B) If missing (or rejected), launch discovery waves.
        let discoveryMethod: string | undefined;
        let discoveryConfidence: number | undefined;
        let discoveryReasonCode: string | undefined;

        // ── STEP 1: WEBSITE DISCOVERY with stage timing ─────────────────────────
        const discoveryTimer = stageDuration.startTimer({ stage: 'website_discovery' });
        let discoveryStageStatus: 'success' | 'not_found' | 'failed' = 'not_found';

        // 1A) If a website is provided, we still verify it before trusting/storing it.
        if (website && website.trim() !== '' && website !== 'null') {
            Logger.info(`[Worker] 🔎 Pre-validating provided website for "${company_name}": ${website}`);
            const verification = await discoveryService.verifyUrl(website, discoveryInput);
            const confidence = verification?.confidence ?? 0;
            if (confidence >= minValidWebsiteConfidence) {
                // Normalize to the final navigated root (scheme matters for http-only sites).
                website = verification?.final_url || website;
                discoveryMethod = 'pre_validated_input';
                discoveryConfidence = confidence;
                discoveryReasonCode = verification?.reason_code || 'OK_CONFIRMED_INPUT_WEBSITE';
                discoveryStageStatus = 'success';
                Logger.info(`[Worker] ✅ Provided website verified (${confidence.toFixed(2)}): ${company_name} -> ${website}`);
            } else {
                Logger.warn(`[Worker] ⚠️ Provided website rejected (${confidence.toFixed(2)} < ${minValidWebsiteConfidence}): ${company_name} -> ${website}`);
                website = undefined;
            }
        }

        if (!website || website.trim() === '' || website === 'null') {
            Logger.info(`[Worker] 🔍 Website missing for "${company_name}". Launching Discovery Waves...`);
            const configuredMode = config.discovery.defaultMode as DiscoveryMode;
            const discoveryResult = await discoveryService.discover(discoveryInput, configuredMode);

            discoveryMethod = discoveryResult.method;
            discoveryConfidence = discoveryResult.confidence;
            discoveryReasonCode = discoveryResult.reason_code || discoveryReasonCode;

            if (discoveryResult.url && discoveryResult.status === 'FOUND_VALID') {
                website = discoveryResult.url;
                discoveryStageStatus = 'success';
                Logger.info(`[Worker] ✅ Discovery VALID: ${company_name} -> ${website} (${discoveryResult.confidence.toFixed(2)}) [${discoveryResult.reason_code}]`);
            } else if (discoveryResult.url) {
                Logger.warn(
                    `[Worker] ⚠️ Discovery candidate rejected for ${company_name}: ${discoveryResult.url} (Status: ${discoveryResult.status}, Confidence: ${discoveryResult.confidence.toFixed(2)}, Reason: ${discoveryResult.reason_code})`
                );
            } else {
                Logger.warn(`[Worker] ⚠️ Discovery failed for ${company_name} (Status: ${discoveryResult.status}, Reason: ${discoveryResult.reason_code})`);
            }
        }

        discoveryTimer(); // stop the histogram timer
        stageOutcome.inc({ stage: 'website_discovery', status: discoveryStageStatus });

        // Emit discovery lane metric
        const lane = normalizeDiscoveryLane(discoveryMethod);
        discoveryLaneTotal.inc({ lane, status: website ? 'found' : 'not_found' });
        getActiveRunSummary()?.recordDiscoveryLane(lane);

        // ── STEP 2: FINANCIAL ENRICHMENT with stage timing ───────────────────
        const financialTimer = stageDuration.startTimer({ stage: 'financial_enrichment' });
        let financialStageStatus: 'success' | 'not_found' | 'failed' = 'not_found';

        const result = await financialService.enrich(
            {
                company_name,
                city,
                vat_code: job.data.vat_code,
                zip_code: job.data.zip_code,
                region: job.data.region,
                address: job.data.address,
                phone: job.data.phone,
                category: job.data.category,
                email: job.data.email,
            },
            website
        );

        // Stop financial timer and record stage outcome
        const hasFinancialData = !!(result.vat || result.pec || result.revenue || result.employees);
        financialStageStatus = hasFinancialData ? 'success' : 'not_found';
        financialTimer();
        stageOutcome.inc({ stage: 'financial_enrichment', status: financialStageStatus });

        // ── DETERMINE BUSINESS OUTCOME ────────────────────────────────────────
        const businessOutcome = determineBusinessOutcome(website, hasFinancialData, false);

        const duration = Date.now() - startTime;

        Logger.info(`✅ Enriched: ${company_name}`, {
            company_id,
            duration_ms: duration,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            website,
            has_website: !!website,
            business_outcome: businessOutcome,
        });

        // ── EMIT TELEMETRY ─────────────────────────────────────────────────────
        companiesProcessed.inc({ outcome: businessOutcome });
        companyProcessingDuration.observe(duration / 1000);

        // Field coverage counters
        if (website) enrichmentFieldFound.inc({ field: 'website' });
        if (result.vat) enrichmentFieldFound.inc({ field: 'vat' });
        if (result.pec) enrichmentFieldFound.inc({ field: 'pec' });
        if (result.revenue) enrichmentFieldFound.inc({ field: 'revenue' });
        if (result.employees) enrichmentFieldFound.inc({ field: 'employees' });
        // email from input (promoted from PagineGialle)
        if (job.data.email) enrichmentFieldFound.inc({ field: 'email' });

        // Run summary
        const summary = getActiveRunSummary();
        if (summary) {
            summary.recordOutcome(businessOutcome);
            summary.recordDiscoveryLane(lane); // already normalised above
            summary.recordReasonCode(discoveryReasonCode);
            if (website) summary.recordFieldFound('website');
            if (result.vat) summary.recordFieldFound('vat');
            if (result.pec) summary.recordFieldFound('pec');
            if (result.revenue) summary.recordFieldFound('revenue');
            if (result.employees) summary.recordFieldFound('employees');
            if (job.data.email) summary.recordFieldFound('email');
            // Stage durations also captured via RunSummaryCollector (complementary to Prometheus)
        }

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
            discovery_method: discoveryMethod,
            discovery_confidence: discoveryConfidence,
            reason_code: discoveryReasonCode || 'NOT_FOUND_NO_CANDIDATES',
        });
        logJobResult(
            company_id,
            'SUCCESS',
            duration,
            job.attemptsMade + 1,
            undefined,
            undefined,
            discoveryReasonCode || 'OK_ENRICHMENT_COMPLETED',
            run_id,
            businessOutcome
        );

        return {
            success: true,
            company_id,
            vat: result.vat,
            revenue: result.revenue,
            employees: result.employees,
            website_found: website ? 'Yes' : 'No',
            website_url: website || undefined,
            reason_code: discoveryReasonCode,
            discovery_method: discoveryMethod,
            discovery_confidence: discoveryConfidence,
        };

    } catch (error) {
        const err = error as Error;
        const duration = Date.now() - startTime;
        const reasonCode = mapErrorToReasonCode(err);

        Logger.logError(`Failed: ${company_name}`, err, {
            company_id,
            company_name,
            run_id,
            correlation_id,
            duration_ms: duration,
            attempt: job.attemptsMade + 1,
            max_attempts: RETRY_ATTEMPTS,
        });

        // Only count as WORKER_EXCEPTION on final attempt (not retries)
        const isFinalAttempt = job.attemptsMade >= RETRY_ATTEMPTS - 1;
        if (isFinalAttempt) {
            companiesProcessed.inc({ outcome: 'WORKER_EXCEPTION' });
            companyProcessingDuration.observe(duration / 1000);
            getActiveRunSummary()?.recordOutcome('WORKER_EXCEPTION');
            getActiveRunSummary()?.recordReasonCode(reasonCode);
        }

        logJobResult(
            company_id,
            isFinalAttempt ? 'FAILED' : 'RETRYING',
            duration,
            job.attemptsMade + 1,
            err.message,
            Logger.categorizeError(err),
            reasonCode,
            run_id,
            isFinalAttempt ? 'WORKER_EXCEPTION' : undefined
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

    // Start background process metrics sampling (event loop lag, heap, rss)
    startRuntimeMonitoring();

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
