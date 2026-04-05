/**
 * 📬 BULLMQ QUEUE INFRASTRUCTURE
 * Task 2: Robust Job Queue with Automatic Retry
 * 
 * Architecture:
 * - Scheduler: Loads companies from CSV/DB and adds to queue
 * - Worker: Processes jobs from queue with retry logic
 * - Dead Letter: Failed jobs go to DLQ for manual review
 */

import { Queue, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { Logger } from '../utils/logger';
import { config } from '../config';

const REDIS_URL = config.redis.url;
const RETRY_ATTEMPTS = config.queue.retryAttempts;
const RETRY_DELAY_MS = config.queue.retryDelayMs;
const QUEUE_BATCH_SIZE = config.queue.batchSize;
const REDIS_CONNECT_TIMEOUT_MS = config.queue.redisConnectTimeoutMs;
const REDIS_CONNECT_RETRIES = config.queue.redisConnectRetries;
const QUEUE_PREFIX = config.queue.prefix;

// 🔌 Redis Connection (Singleton)
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: (times) => {
        if (times > REDIS_CONNECT_RETRIES) {
            return null;
        }
        return Math.min(times * 200, 2000);
    },
});

redisConnection.on('error', (err) => {
    Logger.error('Redis connection error', { error: err });
});

redisConnection.on('connect', () => {
    Logger.info('✅ Connected to Redis');
});

// 📋 Queue Definitions
export const QUEUE_NAMES = {
    ENRICHMENT: 'enrichment',
    DEAD_LETTER: 'dead-letter',
    FINANCIAL: 'financial',
    DISCOVERY: 'discovery',
} as const;

// 📦 Job Data Types
export interface EnrichmentJobData {
    company_id: string;
    company_name: string;
    city?: string;
    province?: string;
    zip_code?: string;
    region?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
    source?: string;
    vat_code?: string;
    pg_url?: string;
    email?: string;
    attempt?: number;
    run_id?: string;
    correlation_id?: string;
}

export interface JobResult {
    success: boolean;
    company_id: string;
    business_status?: 'FOUND_COMPLETE' | 'ENRICHMENT_ONLY_NO_WEBSITE' | 'NOT_FOUND';
    vat?: string;
    revenue?: string;
    employees?: string;
    website_found?: string;
    website_url?: string;
    error?: string;
    error_category?: string;
    reason_code?: string;
    discovery_method?: string;
    discovery_confidence?: number;
}

/**
 * 🏭 Queue Factory - Creates configured queues
 */
export function createQueue(name: string): Queue<EnrichmentJobData, JobResult> {
    return new Queue(name, {
        connection: redisConnection,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
            attempts: RETRY_ATTEMPTS,
            backoff: {
                type: 'exponential',
                delay: RETRY_DELAY_MS,
            },
            removeOnComplete: {
                age: 3600, // Keep completed jobs for 1 hour
                count: 1000,
            },
            removeOnFail: false, // Keep failed jobs for review
        },
    });
}

/**
 * 🔧 Create the main enrichment queue
 */
export const enrichmentQueue = createQueue(QUEUE_NAMES.ENRICHMENT);
export const deadLetterQueue = createQueue(QUEUE_NAMES.DEAD_LETTER);

/**
 * 📊 Queue Events Listener (for monitoring)
 */
export function createQueueEvents(name: string): QueueEvents {
    const events = new QueueEvents(name, {
        connection: redisConnection,
        prefix: QUEUE_PREFIX,
    });

    events.on('completed', ({ jobId, returnvalue }) => {
        Logger.info(`✅ Job ${jobId} completed`, { result: returnvalue });
    });

    events.on('failed', ({ jobId, failedReason }) => {
        Logger.error(`❌ Job ${jobId} failed`, { reason: failedReason });
    });

    events.on('stalled', ({ jobId }) => {
        Logger.warn(`⚠️ Job ${jobId} stalled - will be retried`);
    });

    return events;
}

/**
 * 📥 Add jobs to queue in batches
 */
export async function addJobsBatch(
    queue: Queue<EnrichmentJobData, JobResult>,
    companies: EnrichmentJobData[]
): Promise<number> {
    const batchSize = QUEUE_BATCH_SIZE;
    let enqueued = 0;

    for (let i = 0; i < companies.length; i += batchSize) {
        const batch = companies.slice(i, i + batchSize);
        const jobs = batch.map(company => ({
            name: 'enrich',
            data: company,
            opts: {
                jobId: `enrich-${company.company_id}`,
            },
        }));

        const added = await queue.addBulk(jobs);
        enqueued += added.length;
        Logger.info(`📥 Added batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(companies.length / batchSize)} to queue`);
    }

    return enqueued;
}

/**
 * 🚮 Move failed job to Dead Letter Queue
 */
export async function moveToDeadLetter(job: Job<EnrichmentJobData>): Promise<void> {
    await deadLetterQueue.add('failed-enrichment', {
        ...job.data,
        attempt: job.attemptsMade,
    }, {
        jobId: `dlq-${job.id}`,
    });
    Logger.warn(`💀 Job ${job.id} moved to Dead Letter Queue after ${job.attemptsMade} attempts`);
}

/**
 * 🏥 Health check for queue system
 */
export async function getQueueHealth(): Promise<{
    redis: boolean;
    enrichmentQueue: { waiting: number; active: number; failed: number; completed: number };
    prefix: string;
    error?: string;
}> {
    try {
        await redisConnection.ping();
        const counts = await enrichmentQueue.getJobCounts();
        return {
            redis: true,
            prefix: QUEUE_PREFIX,
            enrichmentQueue: {
                waiting: counts.waiting,
                active: counts.active,
                failed: counts.failed,
                completed: counts.completed,
            },
        };
    } catch (error) {
        const err = error as Error;
        Logger.warn('Queue health check failed', { error: err });
        return {
            redis: false,
            prefix: QUEUE_PREFIX,
            enrichmentQueue: { waiting: 0, active: 0, failed: 0, completed: 0 },
            error: err.message,
        };
    }
}

export async function closeQueueResources(): Promise<void> {
    const closers: Array<Promise<unknown>> = [];

    closers.push(enrichmentQueue.close());
    closers.push(deadLetterQueue.close());
    closers.push(redisConnection.quit());

    await Promise.allSettled(closers);
}
