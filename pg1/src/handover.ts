/**
 * 🔗 HANDOVER PROTOCOL
 * Bridge between PG1 (Shadow Hunter) and PG3 (Golden Refinery)
 * 
 * Workflow:
 * 1. PG1 finishes scraping a city → raw_targets.csv
 * 2. This script moves the CSV to PG3/input/
 * 3. Triggers BullMQ job to start enrichment
 * 
 * Usage:
 * npx ts-node handover.ts --source /path/to/raw_targets.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Configuration
const PG3_INPUT_DIR = process.env.PG3_INPUT_DIR || '../pg3/input';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'enrichment';

// Redis connection
const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

// Enrichment queue
const enrichmentQueue = new Queue(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        }
    }
});

export interface HandoverConfig {
    sourcePath: string;
    cityName: string;
    priority?: number;
}

/**
 * Execute handover from PG1 to PG3
 */
export async function executeHandover(config: HandoverConfig): Promise<void> {
    const { sourcePath, cityName, priority = 1 } = config;

    console.log(`🔗 Handover Protocol: Starting transfer for ${cityName}`);

    // Validate source file exists
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
    }

    // Ensure PG3 input directory exists
    if (!fs.existsSync(PG3_INPUT_DIR)) {
        fs.mkdirSync(PG3_INPUT_DIR, { recursive: true });
    }

    // Generate timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destFilename = `${cityName}_${timestamp}.csv`;
    const destPath = path.join(PG3_INPUT_DIR, destFilename);

    // Copy file to PG3 input
    fs.copyFileSync(sourcePath, destPath);
    console.log(`📁 Copied: ${sourcePath} → ${destPath}`);

    // Read and parse CSV to get company count
    const csvContent = fs.readFileSync(destPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    const companyCount = Math.max(0, lines.length - 1); // Exclude header

    console.log(`📊 Found ${companyCount} companies to enrich`);

    // Trigger BullMQ job
    const job = await enrichmentQueue.add('handover-enrichment', {
        csvPath: destPath,
        cityName,
        companyCount,
        priority,
        timestamp: Date.now(),
    }, {
        priority,
        jobId: `handover-${cityName}-${timestamp}`,
    });

    console.log(`🚀 BullMQ Job created: ${job.id}`);
    console.log(`🔗 Handover complete! PG3 will process ${companyCount} companies.`);

    // Optional: Archive source file
    const archiveDir = path.join(path.dirname(sourcePath), 'archive');
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }
    const archivePath = path.join(archiveDir, path.basename(sourcePath));
    fs.renameSync(sourcePath, archivePath);
    console.log(`📦 Archived source: ${archivePath}`);
}

/**
 * Watch for new files in PG1 output directory
 */
export async function watchAndHandover(watchDir: string): Promise<void> {
    console.log(`👁️ Watching for new CSV files in: ${watchDir}`);

    const processed = new Set<string>();

    const checkForNewFiles = async () => {
        const files = fs.readdirSync(watchDir);

        for (const file of files) {
            if (!file.endsWith('.csv') || processed.has(file)) continue;

            const filePath = path.join(watchDir, file);
            const cityMatch = file.match(/^(.+?)_/);
            const cityName = cityMatch ? cityMatch[1] : 'unknown';

            try {
                await executeHandover({
                    sourcePath: filePath,
                    cityName,
                });
                processed.add(file);
            } catch (error) {
                console.error(`❌ Handover failed for ${file}:`, error);
            }
        }
    };

    // Initial check
    await checkForNewFiles();

    // Watch for changes
    fs.watch(watchDir, async (eventType, filename) => {
        if (eventType === 'rename' && filename?.endsWith('.csv')) {
            await checkForNewFiles();
        }
    });
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const sourceIndex = args.indexOf('--source');
    const watchIndex = args.indexOf('--watch');

    if (sourceIndex !== -1 && args[sourceIndex + 1]) {
        const sourcePath = args[sourceIndex + 1];
        const cityName = path.basename(sourcePath, '.csv');

        executeHandover({ sourcePath, cityName })
            .then(() => process.exit(0))
            .catch((error) => {
                console.error(error);
                process.exit(1);
            });
    } else if (watchIndex !== -1 && args[watchIndex + 1]) {
        watchAndHandover(args[watchIndex + 1]);
    } else {
        console.log(`
🔗 HANDOVER PROTOCOL

Usage:
  npx ts-node handover.ts --source /path/to/raw_targets.csv
  npx ts-node handover.ts --watch /path/to/pg1/output/

Options:
  --source <path>   Process a single CSV file
  --watch <dir>     Watch directory for new CSV files
        `);
    }
}
