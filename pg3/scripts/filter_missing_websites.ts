
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT_FILE = process.argv[2] || 'output_server/campaigns/MASTER_HETZNER_FEB13.csv';
const OUTPUT_FILE = process.argv[3] || 'output_server/campaigns/MASTER_HETZNER_MISSING_ONLY.csv';

// Based on campaign_COMBINED structure:
// company_name,city_clean,province,zip_code,region,address_clean,phone,website,category,source,manual_check,link
interface Company {
    company_name: string;
    city_clean?: string;
    province?: string; // Sometimes distinct
    zip_code?: string;
    region?: string;
    address_clean?: string;
    phone?: string;
    website?: string;
    category?: string;
    source?: string;
    manual_check?: string;
    link?: string;
    // Fallback for different schemas
    city?: string;
    address?: string;
}

async function filter() {
    console.log(`🧹 Filtering ${INPUT_FILE}...`);
    const rows: Company[] = [];
    let kept = 0;
    let skipped = 0;
    let processed = 0;

    const stream = fs.createReadStream(INPUT_FILE)
        .pipe(parse({
            headers: true,
            ignoreEmpty: true,
            discardUnmappedColumns: false, // Keep all columns to be safe
            strictColumnHandling: false,
            quote: '"',
            escape: '"'
        }));

    for await (const row of stream) {
        processed++;
        const r = row as any;

        // Normalize fields
        const company_name = r.company_name || r.name;
        // Website can be in 'website' or 'link' or other cols
        let website = r.website || r.url || r.link || '';

        if (!company_name) {
            // console.warn(`⚠️ Row ${processed} missing company_name:`, JSON.stringify(r));
            continue;
        }

        // CRITERIA: Keep if website is empty OR does not look like a URL
        const hasWebsite = website && website.toLowerCase().includes('http');

        if (!hasWebsite) {
            rows.push(r);
            kept++;
        } else {
            skipped++;
        }
    }

    console.log(`📊 Stats: Processed ${processed}, Kept ${kept} (Missing Website), Skipped ${skipped} (Already Found)`);

    if (rows.length > 0) {
        // Determine headers dynamically from first row to preserve structure
        const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));

        const csvWriter = createObjectCsvWriter({
            path: OUTPUT_FILE,
            header: headers
        });

        await csvWriter.writeRecords(rows);
        console.log(`✅ Written to ${OUTPUT_FILE}`);
    } else {
        console.log('⚠️ No rows to write!');
    }
}

filter().catch(console.error);
