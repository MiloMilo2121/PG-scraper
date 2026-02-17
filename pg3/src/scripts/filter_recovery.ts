
import * as fs from 'fs';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT_FILE = './output_server/campaigns/FINAL_HETZNER_MERGED.csv';
const OUTPUT_FILE = './output/campaigns/RECOVERY_FINAL_TARGETS.csv';

async function main() {
    console.log(`Filtering ${INPUT_FILE}...`);

    // 1. Read Valid Headers from Input
    const rows: any[] = [];
    let headers: string[] = [];

    await new Promise((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(parse({ headers: true, strictColumnHandling: false, ignoreEmpty: true }))
            .on('headers', (h) => headers = h)
            .on('data', (row) => {
                // Check if website is exactly empty string or missing
                const website = row['website'];
                if (!website || website.trim() === '') {
                    rows.push(row);
                }
            })
            .on('end', () => resolve(rows))
            .on('error', reject);
    });

    console.log(`Found ${rows.length} rows with missing websites.`);

    if (rows.length > 0) {
        // 2. Write to Output
        const csvWriter = createObjectCsvWriter({
            path: OUTPUT_FILE,
            header: headers.map(h => ({ id: h, title: h }))
        });
        await csvWriter.writeRecords(rows);
        console.log(`wrote to ${OUTPUT_FILE}`);
    }
}

main().catch(console.error);
