
import * as fs from 'fs';
import * as path from 'path';
import * as fastcsv from 'fast-csv';
import { program } from 'commander';

// Define the input columns expected by the Pipeline
const INPUT_COLUMNS = [
    'company_name',
    'phone',
    'email',
    'initial_website',
    'address',
    'city',
    'province',
    'postal_code',
    'industry'
];

interface CrawlerResult {
    score: string;
    [key: string]: string;
}

async function main() {
    program
        .option('-i, --input <path>', 'Input CSV file path', 'final_results_LO.csv')
        .option('-k, --output-ok <path>', 'Output path for successful results', 'final_results_high_confidence.csv')
        .option('-r, --output-retry <path>', 'Output path for retry queue', 'retry_queue.csv')
        .option('-t, --threshold <number>', 'Score threshold to consider successful', '99');

    program.parse(process.argv);
    const options = program.opts();

    const inputPath = path.resolve(process.cwd(), options.input);
    const okPath = path.resolve(process.cwd(), options.outputOk);
    const retryPath = path.resolve(process.cwd(), options.outputRetry);
    const threshold = parseInt(options.threshold, 10);

    console.log(`Analyzing: ${inputPath}`);
    console.log(`  > Success Threshold: Score > ${threshold}`);
    console.log(`  > Output OK: ${okPath}`);
    console.log(`  > Output Retry: ${retryPath}`);

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const rows: CrawlerResult[] = [];

    fs.createReadStream(inputPath)
        .pipe(fastcsv.parse({ headers: true }))
        .on('error', (error) => console.error(error))
        .on('data', (row) => rows.push(row))
        .on('end', async (rowCount: number) => {
            console.log(`Parsed ${rowCount} rows.`);

            const okRows: any[] = [];
            const retryRows: any[] = [];

            rows.forEach(row => {
                const score = parseFloat(row.score) || 0;

                // Logic: Keep if Score > Threshold (e.g., 100)
                // User said "score > 99", so 100 is kept. 99 is retried? 
                // "maggiore di 99" -> > 99. So 100.
                if (score > threshold) {
                    okRows.push(row);
                } else {
                    // For retry, we want to CLEAN the row to look like original input
                    // We only keep relevant input columns
                    const cleanRow: any = {};
                    INPUT_COLUMNS.forEach(col => {
                        cleanRow[col] = row[col] || '';
                    });
                    retryRows.push(cleanRow);
                }
            });

            console.log(`\nResults Analysis:`);
            console.log(`✅ High Confidence (Score > ${threshold}): ${okRows.length}`);
            console.log(`🔄 To Retry (Score <= ${threshold}):      ${retryRows.length}`);

            // Write Successful Results (keep all columns as it is the final result)
            if (okRows.length > 0) {
                const wsOk = fs.createWriteStream(okPath);
                fastcsv.write(okRows, { headers: true }).pipe(wsOk);
                await new Promise(resolve => wsOk.on('finish', resolve));
            }

            // Write Retry Queue (clean input format)
            if (retryRows.length > 0) {
                const wsRetry = fs.createWriteStream(retryPath);
                fastcsv.write(retryRows, { headers: true }).pipe(wsRetry);
                await new Promise(resolve => wsRetry.on('finish', resolve));
            }

            console.log(`\nFiles generated successfully.`);
            console.log(`Run the crawler on the retry queue with:`);
            console.log(`npx ts-node src/cli.ts resolve -i ${path.basename(retryPath)} -o final_results_retry_optimized.csv`);
        });
}

main().catch(console.error);
