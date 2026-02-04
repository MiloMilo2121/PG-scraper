/**
 * PHASE 1: Website Discovery
 * 
 * Processes ALL companies to find their websites with high concurrency.
 * Input: Raw PG batch CSV
 * Output: phase1_websites.csv (with website column populated)
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { SearchService } from './src/core/discovery';
import { BrowserFactory } from './src/core/browser/factory_v2'; // DEBUG IMPORT
import { Logger } from './src/utils/logger';
import { PipelineConfig } from './src/config/pipeline_config';
import { recordCost } from './src/utils/cost_tracker';

const logger = new Logger('phase1_runner.log');

dotenv.config();

// Maximize Server Usage (32GB RAM) - Safe/Fast Balance
const CONCURRENCY = 20; // Safe for RAM, careful with IP rate limits
const INPUT_FILE = process.argv[2];
const OUTPUT_DIR = PipelineConfig.OUTPUT_DIR;
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
    [key: string]: any;
}

async function main() {
    if (!INPUT_FILE) {
        console.error('Usage: npx tsx run_phase1_websites.ts <input.csv>');
        process.exit(1);
    }

    logger.info(`\n🌐 PHASE 1: WEBSITE DISCOVERY`);
    logger.info(`📂 Input: ${INPUT_FILE}`);
    logger.info(`⚡ Concurrency: ${CONCURRENCY}`);
    logger.info(`⚡ Concurrency: ${CONCURRENCY}`);
    logger.info(`-----------------------------------\n`);

    // DEBUG: Print actual factory path
    const factory = BrowserFactory.getSingleton();
    console.log(`DEBUG: Factory Path: ${(factory as any).userDataDir}`);

    // Setup output immediately for Resume Logic
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(OUTPUT_DIR, `phase1_websites_${timestamp}.csv`);

    // 1. Resume Logic: Load processed companies
    const processedMap = new Set<string>();
    if (fs.existsSync(outputPath)) {
        logger.info(`   🔄 Detected existing output file. Loading for resume...`);
        await new Promise<void>((resolve) => {
            fs.createReadStream(outputPath)
                .pipe(parse({ headers: true }))
                .on('data', (row: any) => {
                    if (row.company_name) processedMap.add(row.company_name.trim().toLowerCase());
                })
                .on('end', () => resolve())
                .on('error', () => resolve()); // Ignore error if empty
        });
        logger.info(`   ✅ Resuming: Found ${processedMap.size} already processed companies.`);
    }

    // Load companies with Streaming Filter (Memory Fix)
    const companies: RawCompany[] = []; // Stores ONLY to-process
    let totalRows = 0;
    let alreadyHaveWebsite = 0;

    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(parse({ headers: true }))
            .on('data', (row: any) => {
                totalRows++;

                // Normalize headers
                const normalized: any = {};
                for (const [key, value] of Object.entries(row)) {
                    const cleanKey = key.trim().toLowerCase().replace(/ /g, '_');
                    // Robustness #2: Strict Input Sanitization
                    let val = value;
                    if (typeof val === 'string') {
                        val = val.trim().replace(/\s+/g, ' '); // remove double spaces
                    }
                    normalized[cleanKey] = val;
                    normalized[key] = val; // Keep original
                }

                // Fix 9: Add Lineage
                if (!normalized.original_file) {
                    normalized.original_file = path.basename(INPUT_FILE);
                }

                // Filter Logic Check (Immediate)
                const website = normalized.website || '';
                const BLOCKLIST = ['paginegialle.it', 'facebook.com', 'instagram.com', 'linkedin.com'];

                const hasValidWebsite = website && website.trim() !== '' && !BLOCKLIST.some(b => website.includes(b));

                if (hasValidWebsite) {
                    alreadyHaveWebsite++;
                    // We don't store it if we don't need to process it (Memory Optimization)
                    // BUT for the output CSV, do we need to preserve rows we didn't touch?
                    // Typically yes, to keep the file complete.
                    // If so, we MUST store them or stream read/write 2 files.
                    // The current pipeline expects to output a NEW file with enrichment.
                    // If we drop rows, we lose data.
                    // COMPROMISE: We store all, but maybe we can optimize later.
                    // For now, let's store all but at least we have the lineage fix.
                    companies.push(normalized as RawCompany);
                } else {
                    companies.push(normalized as RawCompany);
                }
            })
            .on('end', () => resolve())
            .on('error', (err) => reject(err));
    });

    console.log(`📊 Total Rows: ${totalRows}`);

    // Recalculate toProcess from the full list (since we decided to keep all for data integrity)
    // If memory is truly critical, we would need a stream-to-stream pipeline (read input -> process -> write output).
    // Given the time, clearing the array is hard if we want to write at the end.
    // However, the `companies` array contains EVERYTHING.
    // The `toProcess` array below is just a filter.


    // Filter: Only process companies WITHOUT a valid website
    const BLOCKLIST = ['paginegialle.it', 'facebook.com', 'instagram.com', 'linkedin.com'];
    const toProcess = companies.filter(c => {
        // 1. Already have website?
        const website = c.website || '';
        if (website && website.trim() !== '' && !BLOCKLIST.some(b => website.includes(b))) return false;

        // 2. Already processed in this run? (Resume)
        if (processedMap.has(c.company_name.toLowerCase())) return false;

        return true;
    });

    // Recalculate based on filter, ignoring the stream counter for now to be safe
    // const alreadyHaveWebsite = companies.length - toProcess.length; 
    // We update the counter based on filter to be accurate
    const skippedCount = companies.length - toProcess.length;
    console.log(`✅ Already have website: ${skippedCount}`);
    console.log(`🔍 Need website discovery: ${toProcess.length}\n`);

    // Initialize search service
    const apiKey = process.env.OPENAI_API_KEY || '';
    const searchService = new SearchService(apiKey);
    // Use unique profile for Phase 1
    const uniqueProfile = `browser_profile_phase1_${Date.now()}`;
    await searchService.init();

    // Setup output
    // const timestamp = new Date().toISOString().split('T')[0]; // Moved up
    // const outputPath = path.join(OUTPUT_DIR, `phase1_websites_${timestamp}.csv`); // Moved up

    // Create writer with dynamic headers
    const headers = Object.keys(companies[0] || {}).map(id => ({ id, title: id }));
    if (!headers.find(h => h.id === 'website_found')) {
        headers.push({ id: 'website_found', title: 'Website Found' });
    }
    if (!headers.find(h => h.id === 'vat_found')) {
        headers.push({ id: 'vat_found', title: 'VAT Found' });
    }
    // NEW: Validation/Scraping Columns
    headers.push({ id: 'scraped_piva', title: 'scraped_piva' });
    headers.push({ id: 'piva_source', title: 'piva_source' });
    headers.push({ id: 'scraped_phone', title: 'scraped_phone' });
    headers.push({ id: 'confidence', title: 'confidence' });
    headers.push({ id: 'validation_level', title: 'validation_level' });
    headers.push({ id: 'has_pdf', title: 'has_pdf' });
    headers.push({ id: 'has_contact_form', title: 'has_contact_form' });

    const csvWriter = createObjectCsvWriter({
        path: outputPath,
        header: headers,
        append: fs.existsSync(outputPath) // Append if resuming
    });

    // Process with concurrency
    const limit = pLimit(CONCURRENCY);
    let processed = 0;
    let foundWeb = 0;
    let foundVat = 0;
    const results: RawCompany[] = [];

    const tasks = toProcess.map((company) => {
        return limit(async () => {
            processed++;
            console.log(`[${processed}/${toProcess.length}] ${company.company_name}...`);

            try {
                // 1. Try to get VAT from PG profile if available
                if (company.profile_url && company.profile_url.includes('paginegialle.it')) {
                    try {
                        const pgData = await searchService.scrapePagineGialleProfile(company.profile_url);
                        if (pgData.vat) {
                            company.vat_found = pgData.vat;
                            foundVat++;
                            console.log(`   📋 VAT Found: ${pgData.vat}`);
                        }
                        if (FEATURES.ENABLE_COST_TRACKING) recordCost('google_search', 1, 'PagineGialle Scrape');
                    } catch (e) { }
                }

                // 2. Discover Website
                const searchResult = await searchService.findWebsite({
                    company_name: company.company_name,
                    city: company.city || '',
                    website: '',
                    phone: company.phone || '',
                    province: company.province || 'LO',
                    original_file: INPUT_FILE
                });

                if (FEATURES.ENABLE_COST_TRACKING) recordCost('google_search', 1);

                const website = searchResult.url;
                const verification = searchResult.verification;

                if (website) {
                    foundWeb++;
                    console.log(`   ✅ Website: ${website}`);
                    company.website = website;
                    company.website_found = 'Yes';

                    // Store verification metadata
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
                    company.website_found = 'No';
                }
            } catch (e) {
                console.error(`   ❌ Error:`, e);
                company.website_found = 'Error';
            }

            results.push(company);

            // Progressive save every 50 companies
            if (processed % 5 === 0) {
                const toSave = results.splice(0, results.length);
                await csvWriter.writeRecords(toSave);
                console.log(`   💾 Saved checkpoint (${processed} processed)`);
            }
        });
    });

    await Promise.all(tasks);

    // Add companies that already had websites and weren't in toProcess
    const skipped = companies.filter(c => !toProcess.some(tp => tp.company_name === c.company_name));
    for (const c of skipped) {
        c.website_found = 'Existing';
        results.push(c);
    }

    // Final save
    if (results.length > 0) {
        await csvWriter.writeRecords(results);
    }
    await searchService.close();

    logger.info(`\n-----------------------------------`);
    logger.info(`✅ PHASE 1 COMPLETE`);
    logger.info(`📊 Total Input: ${companies.length}`);
    logger.info(`🔍 Processed: ${processed}`);
    logger.info(`⏭️  Skipped (Done/Found/Filtered): ${skippedCount + processedMap.size}`);
    logger.info(`📁 Output: ${outputPath}`);
}

main().catch(console.error);
