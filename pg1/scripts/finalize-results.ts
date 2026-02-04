import * as fs from 'fs';
import * as path from 'path';
import * as fastcsv from 'fast-csv';

const file1 = path.resolve(__dirname, '../final_results_LO.csv');
const file2 = path.resolve(__dirname, '../final_results_retry.csv');
const outputFile = path.resolve(__dirname, '../final_delivered_results.csv');

interface Row {
    [key: string]: string;
}

const map = new Map<string, Row>();

function getKey(row: Row): string {
    // Unique key to match rows. Assuming Company Name + City is reasonably unique for this dataset.
    // Clean them slightly to ensure matches.
    const name = (row['company_name'] || '').trim().toLowerCase();
    const city = (row['city'] || '').trim().toLowerCase();
    const addr = (row['address'] || '').trim().toLowerCase();
    return `${name}|${city}|${addr}`;
}

async function readCsv(filePath: string) {
    if (!fs.existsSync(filePath)) return;

    return new Promise<void>((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(fastcsv.parse({ headers: true }))
            .on('error', reject)
            .on('data', (row: Row) => {
                const key = getKey(row);
                // We overwrite existing entries. 
                // Strategy: if file2 (retry) has the row, it's the latest version.
                // But we must be careful: file2 only has the *failed* rows.
                // So if we load file1 first, then file2, file2 should overwrite file1's failed entry with the (hopefully) successful one.
                map.set(key, row);
            })
            .on('end', () => resolve());
    });
}

function processAndWrite() {
    const outputStream = fs.createWriteStream(outputFile);
    const csvStream = fastcsv.format({ headers: true });
    csvStream.pipe(outputStream);

    for (const row of map.values()) {
        // Parse candidates
        let candidates: any[] = [];
        try {
            if (row.candidates_json) {
                candidates = JSON.parse(row.candidates_json);
            }
        } catch (e) { }

        // Sort by score descending
        candidates.sort((a, b) => (b.score || 0) - (a.score || 0));

        // Get top 2
        const top1 = candidates[0];
        const top2 = candidates[1];

        // Prepare new columns
        const newRow: any = { ...row };

        // Remove technical JSON columns if desired, or keep them? 
        // User said "TUTTE LE COLONNE" (all columns), so I'll keep them.
        // But maybe I should make the "2 websites" prominent.

        newRow['best_match_1_url'] = top1 ? top1.url : '';
        newRow['best_match_1_score'] = top1 ? top1.score : '';
        newRow['best_match_2_url'] = top2 ? top2.url : '';
        newRow['best_match_2_score'] = top2 ? top2.score : '';

        csvStream.write(newRow);
    }

    csvStream.end();
    console.log(`Final merged file written to ${outputFile} with ${map.size} rows.`);
}

async function main() {
    console.log('Reading first run...');
    await readCsv(file1);

    console.log('Reading retry run...');
    await readCsv(file2);

    console.log('Processing and writing final output...');
    processAndWrite();
}

main();
