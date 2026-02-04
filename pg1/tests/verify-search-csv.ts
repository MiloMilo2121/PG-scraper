
import fs from 'fs';
import path from 'path';
import * as csv from 'fast-csv';
import { PuppeteerSearchProvider } from '../src/modules/miner/puppeteer-provider';
import { PuppeteerWrapper } from '../src/modules/browser';
import { logger } from '../src/modules/observability';

interface CsvRow {
    company_name: string;
    city: string;
    province: string;
}

async function runTest() {
    const csvPath = path.resolve(__dirname, '../batch_results_LO_2026-01-15T18-32-27 copia.csv');
    const rows: CsvRow[] = [];

    console.log(`Reading CSV from: ${csvPath}`);

    // Read first 5 rows
    const stream = fs.createReadStream(csvPath)
        .pipe(csv.parse({ headers: true, maxRows: 5 }))
        .on('data', (row) => rows.push(row))
        .on('end', async () => {
            console.log(`Parsed ${rows.length} rows. Starting search test...`);

            const provider = new PuppeteerSearchProvider();

            for (const row of rows) {
                const query = `"${row.company_name}" ${row.city} contacts`;
                console.log(`\n--- Searching for: ${query} ---`);

                try {
                    const results = await provider.search(query, 3);
                    console.log(`Found ${results.length} results:`);
                    results.forEach((res, i) => {
                        console.log(`[${i + 1}] ${res.title}`);
                        console.log(`    URL: ${res.url}`);
                        console.log(`    Snippet: ${res.snippet.substring(0, 100)}...`);
                    });
                } catch (error) {
                    console.error('Search failed:', error);
                }

                // Small delay to be nice
                await new Promise(r => setTimeout(r, 2000));
            }

            console.log('\nTest completed. Closing browser...');
            await PuppeteerWrapper.close();
            process.exit(0);
        });
}

runTest();
