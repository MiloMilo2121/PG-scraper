
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { SearchService } from './src/core/discovery/search_service';
import { BrowserFactory } from './src/core/browser/factory_v2';
import { Logger } from './src/utils/logger';
import { PipelineConfig } from './src/config/pipeline_config';
import { recordCost } from './src/utils/cost_tracker';

dotenv.config();

// Maximize Server Usage (32GB RAM) - Stabilized at 10 to avoid TargetClosedError
const CONCURRENCY = 10;
const INPUT_FILE = process.argv[2];
const OUTPUT_DIR = PipelineConfig.OUTPUT_DIR || './output';
const { FEATURES } = PipelineConfig;

interface RawCompany {
    company_name: string;
    phone?: string;
    website?: string;
    address?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    category?: string;
    profile_url?: string;
    vat_code?: string; // Support for input_phase1_cleaned.csv field
    [key: string]: any;
}

async function main() {
    if (!INPUT_FILE) {
        console.error('Usage: npx tsx run_phase1_websites.ts <input.csv>');
        process.exit(1);
    }

    Logger.info(`\n🌐 PHASE 1: WEBSITE DISCOVERY`);
    Logger.info(`📂 Input: ${INPUT_FILE}`);
    Logger.info(`⚡ Concurrency: ${CONCURRENCY}`);
    Logger.info(`-----------------------------------\n`);

    const factory = BrowserFactory.getInstance();

    // Setup output
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(OUTPUT_DIR, `phase1_websites_${timestamp}.csv`);

    const companies: RawCompany[] = [];
    const processedMap = new Set<string>();

    // Load existing results to support resume
    if (fs.existsSync(outputPath)) {
        await new Promise<void>((resolve) => {
            fs.createReadStream(outputPath)
                .pipe(parse({ headers: true, strictColumnHandling: false }))
                .on('data', (row) => {
                    if (row.company_name) processedMap.add(row.company_name.toLowerCase());
                })
                .on('end', () => resolve());
        });
        Logger.info(`⏯️  Resuming: ${processedMap.size} companies already processed.`);
    }

    // Load input
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(parse({ headers: true, ignoreEmpty: true, discardUnmappedColumns: true }))
            .on('data', (row) => {
                if (row.company_name) companies.push(row as RawCompany);
            })
            .on('end', () => resolve())
            .on('error', (err) => reject(err));
    });

    const toProcess = companies.filter(c => {
        const website = c.website || '';
        const BLOCKLIST = ['paginegialle.it', 'facebook.com', 'instagram.com', 'linkedin.com'];
        if (website && website.trim() !== '' && !BLOCKLIST.some(b => website.includes(b))) return false;
        if (processedMap.has(c.company_name.toLowerCase())) return false;
        return true;
    });

    Logger.info(`📊 Total Rows: ${companies.length}`);
    Logger.info(`✅ Already have website or processed: ${companies.length - toProcess.length}`);
    Logger.info(`🔍 Need website discovery: ${toProcess.length}\n`);

    const searchService = new SearchService();
    // No init() call needed for new SearchService

    const headers = Object.keys(companies[0] || {}).map(id => ({ id, title: id }));
    const extraHeaders = ['website_found', 'vat_found', 'scraped_piva', 'piva_source', 'scraped_phone', 'confidence', 'validation_level', 'has_pdf', 'has_contact_form'];
    extraHeaders.forEach(h => {
        if (!headers.find(existing => existing.id === h)) {
            headers.push({ id: h, title: h });
        }
    });

    const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: headers,
        append: fs.existsSync(outputPath)
    });

    const limit = pLimit(CONCURRENCY);
    let processed = 0;
    let foundWeb = 0;
    const results: RawCompany[] = [];

    const tasks = toProcess.map((company) => {
        return limit(async () => {
            processed++;
            if (processed % 10 === 0) console.log(`[${processed}/${toProcess.length}] Processing... (Found: ${foundWeb})`);

            try {
                const searchResult = await searchService.findWebsite({
                    company_name: company.company_name,
                    city: company.city || '',
                    website: '',
                    phone: company.phone || '',
                    province: company.province || 'LO',
                    piva: company.piva || company.vat || company.vat_code || '',
                    original_file: INPUT_FILE
                });

                if (FEATURES?.ENABLE_COST_TRACKING) recordCost('google_search', 1);

                const website = searchResult.url;
                const verification = searchResult.verification;

                if (website) {
                    foundWeb++;
                    console.log(`[${processed}] ✅ ${company.company_name} -> ${website}`);
                    company.website = website;
                    company.website_found = 'Yes';

                    if (verification) {
                        company.scraped_piva = verification.scraped_piva || '';
                        company.piva_source = verification.piva_source || '';
                        company.scraped_phone = verification.scraped_phone || '';
                        company.confidence = verification.confidence || 0;
                        company.validation_level = verification.level || '';
                        company.has_pdf = verification.has_pdf ? 'Yes' : 'No';
                        company.has_contact_form = verification.has_contact_form ? 'Yes' : 'No';
                    }
                } else {
                    console.log(`[${processed}] ❌ ${company.company_name} -> Not Found`);
                    company.website_found = 'No';
                }
            } catch (e) {
                console.error(`   ❌ Error for ${company.company_name}:`, e);
                company.website_found = 'Error';
            }

            results.push(company);

            if (results.length >= 5) {
                const toSave = results.splice(0, results.length);
                await csvWriter.writeRecords(toSave);
            }
        });
    });

    await Promise.all(tasks);

    if (results.length > 0) {
        await csvWriter.writeRecords(results);
    }

    await searchService.close();

    Logger.info(`\n-----------------------------------`);
    Logger.info(`✅ PHASE 1 COMPLETE`);
    Logger.info(`📊 Total Input: ${companies.length}`);
    Logger.info(`🔍 Processed: ${processed}`);
    Logger.info(`📁 Output: ${outputPath}`);
}

main().catch(console.error);
