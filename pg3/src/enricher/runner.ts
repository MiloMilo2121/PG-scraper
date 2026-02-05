
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { UnifiedDiscoveryService, DiscoveryMode, DiscoveryResult } from './core/discovery/unified_discovery_service';
import { BrowserFactory } from './core/browser/factory_v2';
import { Logger } from './utils/logger';
import { CompanyInput } from './types';
import { AntigravityClient } from './observability/antigravity_client';
import { EnvValidator } from './utils/env_validator';
import { LeadScorer } from './utils/lead_scorer';

const INPUT_FILE = process.argv[2] || 'input_phase1_cleaned.csv';
const OUTPUT_DIR = './output/bulletproof';
const SERVICE = new UnifiedDiscoveryService();

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function main() {
    Logger.info('🚀 STARTING BULLETPROOF DISCOVERY PIPELINE');
    EnvValidator.validate();

    // 1. RUN 1: FAST (Process Everything)
    const allInput = await loadCompanies(INPUT_FILE); // From raw input

    // 🦘 USER OVERRIDE: SKIPPING RUN 1 (FAST)
    Logger.info('🦘 SKIPPING RUN 1 (FAST) -> JUMPING DIRECTLY TO RUN 2 (DEEP)');
    // await executeRun(1, DiscoveryMode.FAST_RUN1, allInput);

    // 2. RUN 2: DEEP (Process EVERYTHING using Deep Mode)
    // We feed the full 'allInput' list directly into Run 2
    await executeRun(2, DiscoveryMode.DEEP_RUN2, allInput);

    // 3. RUN 3: AGGRESSIVE (Process remaining issues from Run 2)
    const run3Input = [
        ...await loadCompanies(path.join(OUTPUT_DIR, 'run2_found_invalid.csv')),
        ...await loadCompanies(path.join(OUTPUT_DIR, 'run2_not_found.csv'))
    ];
    await executeRun(3, DiscoveryMode.AGGRESSIVE_RUN3, run3Input);

    // ☢️ RUN 4: NUCLEAR (Process stubborn cases with 20+ methods)
    // ENABLED: High precision shelling initiated.
    const run4Input = [
        ...await loadCompanies(path.join(OUTPUT_DIR, 'run3_found_invalid.csv')),
        ...await loadCompanies(path.join(OUTPUT_DIR, 'run3_not_found.csv'))
    ];
    await executeRun(4, DiscoveryMode.NUCLEAR_RUN4, run4Input);

    // 4. FINAL MERGE
    await mergeResults();

    // Close resources gracefully
    Logger.info('🏁 PIPELINE COMPLETE. Closing browser...');
    await BrowserFactory.getInstance().close();
    Logger.info('✅ All resources released.');
}



async function executeRun(runId: number, mode: DiscoveryMode, companies: CompanyInput[]) {
    const validPath = path.join(OUTPUT_DIR, `run${runId}_found_valid.csv`);
    const invalidPath = path.join(OUTPUT_DIR, `run${runId}_found_invalid.csv`);
    const notFoundPath = path.join(OUTPUT_DIR, `run${runId}_not_found.csv`);

    // 1. Calculate Already Processed
    const processedMap = new Set<string>();
    [validPath, invalidPath, notFoundPath].forEach(p => {
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf-8');
            // Simple parsing to get company names (assuming unique)
            // Or better, just count how many lines? No, we need to know WHICH ones.
            // Let's assume input order is constant or matching name.
            // Fast approach: regex match all company names?
            // Better: parse fully using fast-csv is safest but slower startup.
            // Let's just use a simple regex for the first column if headers match.
        }
    });

    // Actually, simpler approach for loop: 
    // We can just Read all output files into memory first (it's small, 1342 rows max).
    const alreadyDone = [
        ...await loadCompanies(validPath),
        ...await loadCompanies(invalidPath),
        ...await loadCompanies(notFoundPath)
    ];
    alreadyDone.forEach(c => processedMap.add(c.company_name));

    // Filter pending
    const pending = companies.filter(c => !processedMap.has(c.company_name));

    if (pending.length === 0) {
        Logger.info(`⚠️ RUN ${runId}: All ${companies.length} companies already processed. Skipping.`);
        return;
    }

    Logger.info(`\n=============================================`);
    Logger.info(`🏁 RUN ${runId}: ${mode} - Resuming: ${pending.length} pending (Total: ${companies.length})`);
    Logger.info(`=============================================\n`);

    // Initialize Writers in APPEND mode
    // Note: if file doesn't exist, append: true still works but we need headers.
    // csv-writer handles this usually, but let's check existence to decide if we write headers.
    const getWriter = (p: string) => createObjectCsvWriter({
        path: p,
        header: getHeaders(),
        append: fs.existsSync(p)
    });

    const validWriter = getWriter(validPath);
    const invalidWriter = getWriter(invalidPath);
    const notFoundWriter = getWriter(notFoundPath);

    const limit = pLimit(25); // 🚀 OVERDRIVE: Optimized for 32GB RAM (Increased from 12)
    let processedCount = companies.length - pending.length;

    // Memory Watchdog Interval (LOG ONLY - NO EXIT)
    const memoryWatchdog = setInterval(() => {
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        if (used > 20000) { // 20GB warning threshold
            Logger.warn(`🚨 MEMORY HIGH (${Math.round(used)}MB). Consider reducing concurrency.`);
        }
    }, 10000);


    const tasks = pending.map(company => limit(async () => {
        try {
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING');
            const res = await SERVICE.discover(company, mode);
            let enriched = { ...company, ...enrichCompanyWithResult(company, res) };

            // 🏆 SCORING
            const score = LeadScorer.score(enriched);
            enriched = { ...enriched, lead_score: score };

            // LOG EVERYTHING so we see why it fails
            console.log(`[${mode}] ${company.company_name}: ${res.status} (${res.method}) [${res.confidence}] -> ${res.url || 'NULL'}`);

            if (res.status === 'FOUND_VALID') {
                console.log(`✅ [${mode}] FOUND: ${company.company_name} -> ${res.url}`);
                await validWriter.writeRecords([enriched]);
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'ENRICHED', {
                    final_url: res.url,
                    piva: res.details?.scraped_piva
                });
            } else if (res.status === 'FOUND_INVALID') {
                console.log(`⚠️ [${mode}] INVALID: ${company.company_name} -> ${res.url} (${res.details.reason})`);
                await invalidWriter.writeRecords([enriched]);
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'FAILED', { reason: 'Invalid Content' });
            } else {
                await notFoundWriter.writeRecords([enriched]);
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'FAILED', { reason: 'Not Found' });
            }
        } catch (error) {
            console.error(`Error processing ${company.company_name}:`, error);
        } finally {
            processedCount++;
            // Memory cleanup: Close idle browser contexts periodically
            if (processedCount % 50 === 0) {
                Logger.info(`🔄 [${processedCount}/${companies.length}] Periodic cleanup...`);
                // BrowserFactory will handle context cleanup internally
            }
            if (processedCount % 20 === 0) console.log(`[Run ${runId}] ${processedCount}/${companies.length}`);
        }
    }));

    await Promise.all(tasks);
    Logger.info(`🏁 RUN ${runId} COMPLETED`);
}

function getHeaders() {
    // We need to know headers in advance or derive them. 
    // Let's use a standard list based on CompanyInput + enrichment
    return [
        { id: 'company_name', title: 'company_name' },
        { id: 'address', title: 'address' },
        { id: 'city', title: 'city' },
        { id: 'province', title: 'province' },
        { id: 'zip_code', title: 'zip_code' },
        { id: 'region', title: 'region' },
        { id: 'phone', title: 'phone' },
        { id: 'vat', title: 'vat' }, // Mapping might be loose in input
        { id: 'piva', title: 'piva' },
        { id: 'website', title: 'website' },
        { id: 'website_found', title: 'website_found' },
        { id: 'discovery_method', title: 'discovery_method' },
        { id: 'discovery_confidence', title: 'discovery_confidence' },
        { id: 'scraped_piva', title: 'scraped_piva' },
        { id: 'validation_level', title: 'validation_level' },
        { id: 'validation_reason', title: 'validation_reason' },
        { id: 'lead_score', title: 'lead_score' }, // 🏆 New Score Column
        { id: 'category', title: 'category' } // Preserve category
    ];
}


function enrichCompanyWithResult(company: CompanyInput, res: DiscoveryResult): any {
    return {
        website: res.url || '',
        website_found: res.status === 'FOUND_VALID' ? 'Yes' : (res.status === 'FOUND_INVALID' ? 'Invalid' : 'No'),
        discovery_method: res.method,
        discovery_confidence: res.confidence,
        scraped_piva: res.details?.scraped_piva || '',
        validation_level: res.details?.level || '',
        validation_reason: res.details?.reason || ''
    };
}

async function loadCompanies(filePath: string): Promise<CompanyInput[]> {
    if (!fs.existsSync(filePath)) return [];
    return new Promise((resolve) => {
        const rows: CompanyInput[] = [];
        fs.createReadStream(filePath)
            .pipe(parse({ headers: true, strictColumnHandling: false, discardUnmappedColumns: true, ignoreEmpty: true }))
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows));
    });
}

async function writeCsv(filePath: string, records: any[]) {
    if (records.length === 0) return;
    const bw = createObjectCsvWriter({
        path: filePath,
        header: Object.keys(records[0]).map(k => ({ id: k, title: k }))
    });
    await bw.writeRecords(records);
}

async function mergeResults() {
    Logger.info('\n🔄 Merging Final Results...');
    const valid1 = await loadCompanies(path.join(OUTPUT_DIR, 'run1_found_valid.csv'));
    const valid2 = await loadCompanies(path.join(OUTPUT_DIR, 'run2_found_valid.csv'));
    const valid3 = await loadCompanies(path.join(OUTPUT_DIR, 'run3_found_valid.csv'));

    const allValid = [...valid1, ...valid2, ...valid3];
    // Deduplicate by name just in case
    const unique = new Map();
    allValid.forEach(c => unique.set(c.company_name, c)); // Last write wins (Run 3 overrides Run 1? No, Run 1 is higher quality usually, but we are appending valid ones from later runs)
    // Actually, Run 1 valid are best. Run 2 valid are good. Run 3 valid are okay.
    // They process distinct sets (Run 2 processes only Run 1 failures), so no overlap issues typically.

    // Merge Run 4 if exists
    if (fs.existsSync(path.join(OUTPUT_DIR, 'run4_found_valid.csv'))) {
        const valid4 = await loadCompanies(path.join(OUTPUT_DIR, 'run4_found_valid.csv'));
        valid4.forEach(c => unique.set(c.company_name, c));
    }

    await writeCsv(path.join(OUTPUT_DIR, 'FINAL_VALID_WEBSITES.csv'), Array.from(unique.values()));

    const finalInvalid = await loadCompanies(path.join(OUTPUT_DIR, 'run3_found_invalid.csv'));
    await writeCsv(path.join(OUTPUT_DIR, 'FINAL_INVALID_WEBSITES.csv'), finalInvalid);

    const finalNotFound = await loadCompanies(path.join(OUTPUT_DIR, 'run3_not_found.csv'));
    await writeCsv(path.join(OUTPUT_DIR, 'FINAL_NOT_FOUND.csv'), finalNotFound);

    Logger.info(`✅ PIPELINE COMPLETE. Final Valid Yield: ${unique.size}`);
}

main().catch(console.error);
