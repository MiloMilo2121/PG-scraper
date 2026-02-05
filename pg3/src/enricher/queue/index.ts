/**
 * 📬 BULLMQ QUEUE INFRASTRUCTURE
 * Task 2: Robust Job Queue with Automatic Retry
 * 
 * Architecture:
 * - Scheduler: Loads companies from CSV/DB and adds to queue
 * - Worker: Processes jobs from queue with retry logic
 * - Dead Letter: Failed jobs go to DLQ for manual review
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import { Logger } from '../utils/logger';

// Environment config with defaults
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || '3');
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000');
const QUEUE_BATCH_SIZE = parseInt(process.env.QUEUE_BATCH_SIZE || '100');

// 🔌 Redis Connection (Singleton)
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
    attempt?: number;
}

export interface JobResult {
    success: boolean;
    company_id: string;
    vat?: string;
    revenue?: string;
    employees?: string;
    website_found?: string;
    error?: string;
    error_category?: string;
}

/**
 * 🏭 Queue Factory - Creates configured queues
 */
export function createQueue(name: string): Queue<EnrichmentJobData, JobResult> {
    return new Queue(name, {
        connection: redisConnection,
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
    const events = new QueueEvents(name, { connection: redisConnection });

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
): Promise<void> {
    const batchSize = QUEUE_BATCH_SIZE;

    for (let i = 0; i < companies.length; i += batchSize) {
        const batch = companies.slice(i, i + batchSize);
        const jobs = batch.map(company => ({
            name: 'enrich',
            data: company,
            opts: {
                jobId: `enrich-${company.company_id}`,
            },
        }));

        await queue.addBulk(jobs);
        Logger.info(`📥 Added batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(companies.length / batchSize)} to queue`);
    }
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
}> {
    try {
        await redisConnection.ping();
        const counts = await enrichmentQueue.getJobCounts();
        return {
            redis: true,
            enrichmentQueue: {
                waiting: counts.waiting,
                active: counts.active,
                failed: counts.failed,
                completed: counts.completed,
            },
        };
    } catch (error) {
        return {
            redis: false,
            enrichmentQueue: { waiting: 0, active: 0, failed: 0, completed: 0 },
        };
    }
}
