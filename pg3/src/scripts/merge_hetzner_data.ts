
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import * as fs from 'fs';
import * as path from 'path';

// Define paths
// Adjusting to run from project root or src/scripts
const INPUT_DIR = path.resolve(process.cwd(), 'output_server/campaigns');
const FILE_MAIN = path.join(INPUT_DIR, 'MASTER_HETZNER_FEB13.csv');
const FILE_RESCUE = path.join(INPUT_DIR, 'MASTER_HETZNER_MISSING_ONLY.csv');
const OUTPUT_FILE = path.join(INPUT_DIR, 'FINAL_HETZNER_MERGED.csv');

interface Company {
    [key: string]: string;
}

function normalizeKey(str: string): string {
    return str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

async function mergeData() {
    console.log(`Reading files from ${INPUT_DIR}...`);

    if (!fs.existsSync(FILE_MAIN)) {
        console.error(`ERROR: Main file not found at ${FILE_MAIN}`);
        process.exit(1);
    }
    if (!fs.existsSync(FILE_RESCUE)) {
        console.error(`ERROR: Rescue file not found at ${FILE_RESCUE}`);
        process.exit(1);
    }

    const mainContent = fs.readFileSync(FILE_MAIN, 'utf-8');
    const rescueContent = fs.readFileSync(FILE_RESCUE, 'utf-8');

    const parseOpts = {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
    };

    const mainData = parse(mainContent, parseOpts) as unknown as Company[];
    const rescueData = parse(rescueContent, parseOpts) as unknown as Company[];

    console.log(`Loaded ${mainData.length} rows from MAIN file.`);
    console.log(`Loaded ${rescueData.length} rows from RESCUE file.`);

    const mergedMap = new Map<string, Company>();

    const getCompanyKey = (c: Company) => {
        // Primary key: Phone
        if (c.phone && c.phone.trim().length > 5) {
            return 'PHONE:' + normalizeKey(c.phone);
        }
        // Fallback: Name + City (normalized)
        return 'NAME:' + normalizeKey(c.company_name) + '_' + normalizeKey(c.city);
    };

    const processCompany = (company: Company) => {
        const key = getCompanyKey(company);
        if (!key || key.length < 5) return; // Skip invalid rows

        const existing = mergedMap.get(key);

        if (!existing) {
            mergedMap.set(key, company);
        } else {
            // MERGE LOGIC:
            // We want to keep the version that has a WEBSITE.
            // If both have website, we keep the one with more fields filled.

            const existingHasWeb = existing.website && existing.website.includes('.');
            const newHasWeb = company.website && company.website.includes('.');

            if (!existingHasWeb && newHasWeb) {
                // New one has website, existing doesn't. REPLACE.
                mergedMap.set(key, company);
            } else if (existingHasWeb && !newHasWeb) {
                // Existing has website, new doesn't. KEEP EXISTING.
                // (Maybe update empty fields? For simplicity, we stick to existing)
            } else {
                // Both have website or neither.
                // Check which has more data points.
                const countFields = (c: Company) => Object.values(c).filter(v => v && v.trim().length > 0).length;

                if (countFields(company) > countFields(existing)) {
                    mergedMap.set(key, company);
                }
            }
        }
    };

    // Process MAIN first
    mainData.forEach(c => processCompany(c));
    // Process RESCUE second
    rescueData.forEach(c => processCompany(c));

    const finalData = Array.from(mergedMap.values());

    // Count stats
    const total = finalData.length;
    let withWeb = 0;

    finalData.forEach(c => {
        if (c.website && c.website.includes('.')) withWeb++;
    });

    console.log(`\n--- MERGE COMPLETE ---`);
    console.log(`Total Unique Companies: ${total}`);
    console.log(`With Website: ${withWeb}`);

    // Write output
    // Cast to any to bypass specific csv-stringify typing issues if needed, or ensure the data shape is correct.
    const csvOutput = stringify(finalData as any[], { header: true });
    fs.writeFileSync(OUTPUT_FILE, csvOutput);
    console.log(`\nSaved merged file to: ${OUTPUT_FILE}`);
}

mergeData().catch(console.error);
