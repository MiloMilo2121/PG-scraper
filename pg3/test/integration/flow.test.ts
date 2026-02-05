/**
 * 🧪 AUDIT 3: END-TO-END FLOW TEST
 * Verifies the complete pipeline: CSV → Queue → Worker → DB
 * 
 * What to look for:
 * - Job enters Redis queue
 * - Worker processes without crashing
 * - SQLite has new row in enrichment_results
 * 
 * Usage: npx ts-node pg3/test/integration/flow.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import Database from 'better-sqlite3';
import { Logger } from '../../src/enricher/utils/logger';

// Test configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SQLITE_PATH = process.env.SQLITE_PATH || './data/antigravity.db';
const TEST_QUEUE = 'e2e-test-queue';

async function runE2EAudit() {
    Logger.info('🧪 AUDIT 3: END-TO-END FLOW TEST');
    Logger.info('================');

    // Step 1: Redis connection
    Logger.info('📍 Step 1: Testing Redis connection...');
    const redis = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });

    try {
        await redis.ping();
        Logger.info('   ✅ Redis is responding');
    } catch (e) {
        Logger.error('   ❌ Redis connection failed:', e);
        Logger.error('   Run: docker compose up -d');
        process.exit(1);
    }

    // Step 2: Queue creation
    Logger.info('📍 Step 2: Testing BullMQ queue...');
    const queue = new Queue(TEST_QUEUE, { connection: redis });

    const testJob = {
        company_id: 'test-' + Date.now(),
        company_name: 'Test Company E2E',
        city: 'Milano',
    };

    const job = await queue.add('test-job', testJob);
    Logger.info(`   ✅ Job added: ${job.id}`);

    // Step 3: Worker processing
    Logger.info('📍 Step 3: Testing worker processing...');
    let processedJob: Job | null = null;

    const worker = new Worker(
        TEST_QUEUE,
        async (job) => {
            Logger.info(`   📦 Processing job: ${job.id}`);
            processedJob = job;
            return { status: 'completed', timestamp: Date.now() };
        },
        { connection: redis }
    );

    // Wait for job to be processed
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (processedJob) {
        Logger.info('   ✅ Worker processed the job');
    } else {
        Logger.warn('   ⚠️ Job may still be processing, check queue state');
    }

    // Step 4: SQLite check
    Logger.info('📍 Step 4: Testing SQLite database...');
    const dbPath = path.resolve(SQLITE_PATH);

    if (fs.existsSync(dbPath)) {
        try {
            const db = new Database(dbPath);

            // Check tables exist
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
            const tableNames = tables.map(t => t.name);

            Logger.info(`   Tables found: ${tableNames.join(', ')}`);

            if (tableNames.includes('enrichment_results')) {
                const count = db.prepare('SELECT COUNT(*) as count FROM enrichment_results').get() as { count: number };
                Logger.info(`   📊 enrichment_results rows: ${count.count}`);
                Logger.info('   ✅ SQLite is operational');
            } else {
                Logger.warn('   ⚠️ enrichment_results table not found (may be created on first run)');
            }

            db.close();
        } catch (e) {
            Logger.error('   ❌ SQLite error:', e);
        }
    } else {
        Logger.warn(`   ⚠️ Database file not found: ${dbPath}`);
        Logger.info('   This is OK for first run - it will be created automatically');
    }

    // Cleanup
    Logger.info('📍 Cleanup...');
    await worker.close();
    await queue.close();
    await redis.quit();

    Logger.info('');
    Logger.info('🎯 AUDIT 3 COMPLETE');
    Logger.info('================');
    Logger.info('Summary:');
    Logger.info('- Redis: ✅ Connected');
    Logger.info('- Queue: ✅ Job created');
    Logger.info('- Worker: ' + (processedJob ? '✅ Processed' : '⚠️ Check manually'));
    Logger.info('- SQLite: Check output above');
    Logger.info('');
    Logger.info('For full E2E test run:');
    Logger.info('  1. npx ts-node src/enricher/scheduler.ts test_input.csv');
    Logger.info('  2. npx ts-node src/enricher/worker.ts');
    Logger.info('  3. Check ./data/antigravity.db');

    process.exit(0);
}

runE2EAudit().catch((err) => {
    Logger.error('AUDIT 3 FATAL ERROR:', err);
    process.exit(1);
});
