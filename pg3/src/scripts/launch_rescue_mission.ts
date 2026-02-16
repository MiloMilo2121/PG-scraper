
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
// Custom import for direct Nuclear access
import { NuclearStrategy } from '../enricher/core/discovery/nuclear_strategy';
import { Logger } from '../scraper/utils/logger';
import { CompanyInput } from '../scraper/types';

dotenv.config();

const INPUT_FILE = path.join(process.cwd(), 'output_server/campaigns/FINAL_HETZNER_MERGED.csv');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_FILE = path.join(process.cwd(), 'output_server/campaigns', `RESCUE_SESSION_${TIMESTAMP}.csv`);

// Max concurrent valid checks
const CONCURRENCY = 4; // Increased slightly as Nuclear handles its own rate limits

// Simple CSV Escaper
function toCsvLine(obj: any): string {
    const values = [
        obj.company_name,
        obj.city,
        obj.address,
        obj.phone,
        obj.website,
        obj.confidence,
        obj.source
    ].map(v => {
        if (v === undefined || v === null) return '';
        const s = String(v);
        if (s.includes('"') || s.includes(',') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    });
    return values.join(',') + '\n';
}

async function main() {
    Logger.info(`🚀 Starting RESCUE MISSION (Nuclear Direct Mode)...`);
    Logger.info(`📂 Input: ${INPUT_FILE}`);

    if (!fs.existsSync(INPUT_FILE)) {
        Logger.error(`❌ Input file not found!`);
        process.exit(1);
    }

    const fileContent = fs.readFileSync(INPUT_FILE, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    }) as any[];

    // Filter missing websites
    const missing = records.filter(r =>
        r.company_name &&
        r.company_name.trim().length > 0 &&
        (!r.website || r.website.trim().length === 0)
    );

    Logger.info(`📊 Total Records: ${records.length}`);
    Logger.info(`🎯 Missing Websites (Targets): ${missing.length}`);

    if (missing.length === 0) {
        Logger.info(`✅ No missing websites found! Exiting.`);
        return;
    }

    // Init Output File with Headers
    const headers = 'company_name,city,address,phone,website,confidence,source\n';
    fs.writeFileSync(OUTPUT_FILE, headers);
    Logger.info(`💾 Output will be saved to: ${OUTPUT_FILE}`);

    // Init Strategy directly
    const nuclear = new NuclearStrategy();

    let processed = 0;
    let found = 0;

    // Process in batches
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const batch = missing.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (record) => {
            const company: CompanyInput = {
                company_name: record.company_name,
                city: record.city,
                address: record.address,
                phone: record.phone,
                category: record.category,
                province: record.province,
                region: record.region,
                piva: record.vat_code || record.piva || record.vat // Pass VAT if available for better scoring
            };

            try {
                Logger.info(`🔍 [Rescue] Searching: [${company.company_name}] (${company.city})...`);

                // DIRECT NUCLEAR STRATEGY (Bypassing strict Service verification)
                // This trusts the heuristics (URL text match) more than the content fetch (which is failing)
                const result = await nuclear.execute(company);

                if (result.url) {
                    found++;
                    Logger.info(`✅ [Rescue] FOUND: ${company.company_name} -> ${result.url} (Conf: ${result.confidence.toFixed(2)})`);

                    // Save result immediately
                    const outRow = {
                        ...record,
                        website: result.url,
                        confidence: result.confidence.toFixed(2),
                        source: `Rescue:${result.method}`
                    };
                    fs.appendFileSync(OUTPUT_FILE, toCsvLine(outRow));

                } else {
                    Logger.info(`❌ [Rescue] NOT FOUND: ${company.company_name}`);
                }
            } catch (e) {
                Logger.error(`⚠️ [Rescue] Error processing ${company.company_name}: ${(e as Error).message}`);
            } finally {
                processed++;
            }
        });

        await Promise.all(promises);

        // Anti-blocking pause between batches
        Logger.info(`⏸️ Batch complete. Processed ${processed}/${missing.length}. Found: ${found}. Pausing...`);
        await new Promise(r => setTimeout(r, 1500));
    }

    Logger.info(`\n🏁 RESCUE MISSION COMPLETE`);
    Logger.info(`📊 Recovered: ${found} websites`);
}

main().catch(console.error);
