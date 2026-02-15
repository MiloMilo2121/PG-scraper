
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { z } from 'zod';
import { UnifiedDiscoveryService, DiscoveryMode, DiscoveryResult } from './core/discovery/unified_discovery_service';
import { BrowserFactory } from './core/browser/factory_v2';
import { Logger } from './utils/logger';
import { CompanyInput } from './types';
import { AntigravityClient } from './observability/antigravity_client';
import { EnvValidator } from './utils/env_validator';
import { LeadScorer } from './utils/lead_scorer';
import { config } from './config';

const INPUT_FILE = process.argv[2] || 'input_phase1_cleaned.csv';
const OUTPUT_DIR = './output/bulletproof';
const SERVICE = new UnifiedDiscoveryService();
const RUNNER_CONCURRENCY_LIMIT = config.runner.concurrencyLimit;
const RUNNER_MEMORY_WARN_MB = config.runner.memoryWarnMb;
const RUNNER_PROGRESS_LOG_EVERY = config.runner.progressLogEvery;

const RunnerCompanySchema = z.object({
    company_name: z.string().trim().min(1),
    city: z.string().optional(),
    province: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    website: z.string().optional(),
    category: z.string().optional(),
    zip_code: z.string().optional(),
    region: z.string().optional(),
    vat: z.string().optional(),
    piva: z.string().optional(),
    website_found: z.string().optional(),
    discovery_method: z.string().optional(),
    discovery_confidence: z.union([z.string(), z.number()]).optional(),
    scraped_piva: z.string().optional(),
    validation_level: z.string().optional(),
    validation_reason: z.string().optional(),
    lead_score: z.union([z.string(), z.number()]).optional(),
}).passthrough();

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

    const processedMap = new Set<string>();
    const alreadyDone = [
        ...await loadCompanies(validPath),
        ...await loadCompanies(invalidPath),
        ...await loadCompanies(notFoundPath)
    ];
    alreadyDone.forEach(c => processedMap.add(buildCompanyKey(c)));

    // Filter pending
    const pending = companies.filter(c => !processedMap.has(buildCompanyKey(c)));

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
    const writeQueue = pLimit(1);

    const limit = pLimit(RUNNER_CONCURRENCY_LIMIT);
    let processedCount = companies.length - pending.length;

    // Memory Watchdog Interval (LOG ONLY - NO EXIT)
    const memoryWatchdog = setInterval(() => {
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        if (used > RUNNER_MEMORY_WARN_MB) {
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

            Logger.info(`[${mode}] ${company.company_name}: ${res.status} (${res.method}) [${res.confidence}] -> ${res.url || 'NULL'}`);

            if (res.status === 'FOUND_VALID') {
                Logger.info(`[${mode}] FOUND: ${company.company_name} -> ${res.url}`);
                await writeQueue(() => validWriter.writeRecords([enriched]));
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'ENRICHED', {
                    final_url: res.url,
                    piva: res.details?.scraped_piva
                });
            } else if (res.status === 'FOUND_INVALID') {
                Logger.warn(`[${mode}] INVALID: ${company.company_name} -> ${res.url} (${res.details.reason})`);
                await writeQueue(() => invalidWriter.writeRecords([enriched]));
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'FAILED', { reason: 'Invalid Content' });
            } else {
                await writeQueue(() => notFoundWriter.writeRecords([enriched]));
                AntigravityClient.getInstance().trackCompanyUpdate(enriched, 'FAILED', { reason: 'Not Found' });
            }
        } catch (error) {
            Logger.error(`Error processing ${company.company_name}`, { error: error as Error });
        } finally {
            processedCount++;
            // Memory cleanup: Close idle browser contexts periodically
            if (processedCount % 50 === 0) {
                Logger.info(`🔄 [${processedCount}/${companies.length}] Periodic cleanup...`);
                // BrowserFactory will handle context cleanup internally
            }
            if (processedCount % RUNNER_PROGRESS_LOG_EVERY === 0) {
                Logger.info(`[Run ${runId}] ${processedCount}/${companies.length}`);
            }
        }
    }));

    try {
        await Promise.all(tasks);
        Logger.info(`🏁 RUN ${runId} COMPLETED`);
    } finally {
        clearInterval(memoryWatchdog);
    }
}


function getHeaders() {
    return [
        { id: 'company_name', title: 'company_name' },
        { id: 'legal_name', title: 'legal_name' }, // New
        { id: 'address', title: 'address' },
        { id: 'city', title: 'city' },
        { id: 'province', title: 'province' },
        { id: 'zip_code', title: 'zip_code' },
        { id: 'region', title: 'region' },
        { id: 'phone', title: 'phone' },
        { id: 'vat', title: 'vat' },
        { id: 'piva', title: 'piva' },
        { id: 'fiscal_code', title: 'fiscal_code' }, // New
        { id: 'website', title: 'website' },
        { id: 'website_found', title: 'website_found' },
        { id: 'discovery_method', title: 'discovery_method' },
        { id: 'discovery_confidence', title: 'discovery_confidence' },
        { id: 'scraped_piva', title: 'scraped_piva' },
        { id: 'validation_level', title: 'validation_level' },
        { id: 'validation_reason', title: 'validation_reason' },
        { id: 'lead_score', title: 'lead_score' },
        { id: 'category', title: 'category' },
        // Extended Identity Fields
        { id: 'rea', title: 'rea' },
        { id: 'legal_form', title: 'legal_form' },
        { id: 'foundation_year', title: 'foundation_year' },
        { id: 'activity_status', title: 'activity_status' },
        { id: 'activity_code', title: 'activity_code' },
        { id: 'revenue', title: 'revenue' },
        { id: 'employees', title: 'employees' },
        { id: 'profit', title: 'profit' },
        { id: 'personnel_cost', title: 'personnel_cost' }
    ];
}


function enrichCompanyWithResult(company: CompanyInput, res: DiscoveryResult): any {
    const identity = res.details?.identity;

    return {
        website: res.url || '',
        website_found: res.status === 'FOUND_VALID' ? 'Yes' : (res.status === 'FOUND_INVALID' ? 'Invalid' : 'No'),
        discovery_method: res.method,
        discovery_confidence: res.confidence,
        scraped_piva: res.details?.scraped_piva || '',
        validation_level: res.details?.level || '',
        validation_reason: res.details?.reason || '',

        // Identity Mapping
        legal_name: identity?.legal_name || company.company_name, // Use discovered Name if available
        fiscal_code: identity?.fiscal_code || '',
        rea: identity?.rea || '',
        legal_form: identity?.legal_form || '',
        foundation_year: identity?.foundation_year || '',
        activity_status: identity?.activity_status || '',
        activity_code: identity?.activity_code || '',
        revenue: identity?.financials?.revenue || '',
        employees: identity?.financials?.employees || '',
        profit: identity?.financials?.profit || '',
        personnel_cost: identity?.financials?.personnel_cost || '',
        // Geo overrides if Identity is more precise?
        // Let's keep original unless empty, or add separate cols. 
        // For now, identity fields are just added.
        region: identity?.region || company.region || '',
        address: identity?.address || company.address || '',
        city: identity?.city || company.city || '',
        province: identity?.province || company.province || ''
    };
}

function buildCompanyKey(company: CompanyInput): string {
    return [
        company.company_name?.toLowerCase().trim() || '',
        company.city?.toLowerCase().trim() || '',
        company.address?.toLowerCase().trim() || ''
    ].join('|');
}

async function loadCompanies(filePath: string): Promise<CompanyInput[]> {
    if (!fs.existsSync(filePath)) return [];
    return new Promise((resolve) => {
        const rows: CompanyInput[] = [];
        fs.createReadStream(filePath)
            .pipe(parse({ headers: true, strictColumnHandling: false, discardUnmappedColumns: true, ignoreEmpty: true }))
            .on('data', (r) => {
                const parsed = RunnerCompanySchema.safeParse(r);
                if (!parsed.success) {
                    Logger.warn('Skipping invalid runner CSV row', { issues: parsed.error.issues });
                    return;
                }
                rows.push(parsed.data as CompanyInput);
            })
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
    // ASSUMPTION: Run4 invalid results should be merged into final invalid set
    if (fs.existsSync(path.join(OUTPUT_DIR, 'run4_found_invalid.csv'))) {
        const inv4 = await loadCompanies(path.join(OUTPUT_DIR, 'run4_found_invalid.csv'));
        finalInvalid.push(...inv4);
    }
    await writeCsv(path.join(OUTPUT_DIR, 'FINAL_INVALID_WEBSITES.csv'), finalInvalid);

    // ASSUMPTION: Run4 not_found supersedes Run3's — these are the true "unfindable" companies
    let finalNotFound = await loadCompanies(path.join(OUTPUT_DIR, 'run3_not_found.csv'));
    if (fs.existsSync(path.join(OUTPUT_DIR, 'run4_not_found.csv'))) {
        finalNotFound = await loadCompanies(path.join(OUTPUT_DIR, 'run4_not_found.csv'));
    }
    await writeCsv(path.join(OUTPUT_DIR, 'FINAL_NOT_FOUND.csv'), finalNotFound);

    Logger.info(`✅ PIPELINE COMPLETE. Final Valid Yield: ${unique.size}`);
}

if (require.main === module) {
    main().catch((error) => {
        Logger.error('Runner crashed', { error: error as Error });
        process.exit(1);
    });
}
