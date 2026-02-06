/**
 * 📥 SCHEDULER - Job Producer
 * Task 4: Loads companies from CSV and adds to BullMQ queue
 * 
 * Usage: npx ts-node src/enricher/scheduler.ts [input.csv]
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { parse } from 'fast-csv';
import { Logger } from './utils/logger';
import { config } from './config';
import {
    enrichmentQueue,
    addJobsBatch,
    EnrichmentJobData,
    createQueueEvents,
    QUEUE_NAMES,
} from './queue';

const INPUT_FILE = process.argv[2] || 'output/campaigns/BOARD_FINAL_SANITISED.csv';

async function main() {
    Logger.info('📥 SCHEDULER: Starting job injection');

    // Subscribe to queue events for monitoring
    const events = createQueueEvents(QUEUE_NAMES.ENRICHMENT);

    // Load companies from CSV
    const companies = await loadCompaniesFromCSV(INPUT_FILE);
    Logger.info(`📊 Loaded ${companies.length} companies from ${INPUT_FILE}`);

    if (companies.length === 0) {
        Logger.warn('⚠️ No companies to process. Exiting.');
        process.exit(0);
    }

    // Check existing queue state to avoid duplicates
    const existingJobs = await enrichmentQueue.getJobCounts();
    Logger.info(`📋 Queue state: ${existingJobs.waiting} waiting, ${existingJobs.active} active, ${existingJobs.completed} completed`);

    // Convert to job data format with DETERMINISTIC IDs (idempotent)
    const jobs: EnrichmentJobData[] = companies.map((c, idx) => {
        // T03: Deterministic ID = MD5(name + city) for idempotency
        const deterministicId = c.company_id || crypto
            .createHash('md5')
            .update(`${c.company_name}${c.city || ''}`)
            .digest('hex');

        return {
            company_id: deterministicId,
            company_name: c.company_name,
            city: c.city,
            province: c.province,
            address: c.address,
            phone: c.phone,
            website: c.website,
            category: c.category,
        };
    });

    // Add jobs to queue in batches
    await addJobsBatch(enrichmentQueue, jobs);

    Logger.info(`✅ SCHEDULER: Injected ${jobs.length} jobs to queue`);
    Logger.info('👷 Start workers with: npx ts-node src/enricher/worker.ts');

    // Keep alive briefly to log initial events, then exit
    setTimeout(() => {
        Logger.info('📥 SCHEDULER: Job injection complete. Exiting.');
        process.exit(0);
    }, 3000);
}

interface CSVCompany {
    company_id?: string;
    company_name: string;
    city?: string;
    province?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
}

async function loadCompaniesFromCSV(filePath: string): Promise<CSVCompany[]> {
    if (!fs.existsSync(filePath)) {
        Logger.error(`❌ Input file not found: ${filePath}`);
        return [];
    }

    return new Promise((resolve) => {
        const rows: CSVCompany[] = [];
        fs.createReadStream(filePath)
            .pipe(parse({ headers: true, ignoreEmpty: true }))
            .on('data', (row: CSVCompany) => {
                if (row.company_name?.trim()) {
                    rows.push({
                        ...row,
                        company_name: row.company_name.trim(),
                    });
                }
            })
            .on('end', () => resolve(rows))
            .on('error', (err) => {
                Logger.error('CSV parsing error', { error: err });
                resolve([]);
            });
    });
}

// Export for programmatic use
export async function runScheduler(csvPath?: string) {
    const inputFile = csvPath || INPUT_FILE;
    Logger.info('📥 SCHEDULER: Starting job injection');

    const events = createQueueEvents(QUEUE_NAMES.ENRICHMENT);
    const companies = await loadCompaniesFromCSV(inputFile);
    Logger.info(`📊 Loaded ${companies.length} companies from ${inputFile}`);

    if (companies.length === 0) {
        Logger.warn('⚠️ No companies to process.');
        return;
    }

    const existingJobs = await enrichmentQueue.getJobCounts();
    Logger.info(`📋 Queue state: ${existingJobs.waiting} waiting, ${existingJobs.active} active, ${existingJobs.completed} completed`);

    const jobs: EnrichmentJobData[] = companies.map((c) => {
        const deterministicId = c.company_id || crypto
            .createHash('md5')
            .update(`${c.company_name}${c.city || ''}`)
            .digest('hex');

        return {
            company_id: deterministicId,
            company_name: c.company_name,
            city: c.city,
            province: c.province,
            address: c.address,
            phone: c.phone,
            website: c.website,
            category: c.category,
        };
    });

    await addJobsBatch(enrichmentQueue, jobs);
    Logger.info(`✅ SCHEDULER: Injected ${jobs.length} jobs to queue`);
}

// Auto-run if executed directly
if (require.main === module) {
    main().catch((err) => {
        Logger.fatal('Scheduler crashed', { error: err });
        process.exit(1);
    });
}
