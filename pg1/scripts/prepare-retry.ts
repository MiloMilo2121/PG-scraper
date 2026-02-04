import * as fs from 'fs';
import * as path from 'path';
import * as fastcsv from 'fast-csv';

const inputFile = path.resolve(__dirname, '../final_results_LO.csv');
const outputFile = path.resolve(__dirname, '../retry_input.csv');

async function processFile() {
    const rows: any[] = [];

    fs.createReadStream(inputFile)
        .pipe(fastcsv.parse({ headers: true }))
        .on('error', (error) => console.error(error))
        .on('data', (row) => {
            if (row.status !== 'OK' && row.status !== '') {
                // Keep the original columns for retry
                // We can just push the row as is, the pipeline handles extra columns gracefully usually
                // or we strip the output columns?
                // Pipeline expects: company_name, city, etc.
                // It should ignore extra columns like "status" or overwrite them.
                rows.push(row);
            }
        })
        .on('end', async (rowCount: number) => {
            console.log(`Parsed ${rowCount} rows`);
            console.log(`Found ${rows.length} rows to retry`);

            if (rows.length > 0) {
                const writeStream = fs.createWriteStream(outputFile);
                const csvStream = fastcsv.format({ headers: true });
                csvStream.pipe(writeStream);

                rows.forEach(row => csvStream.write(row));
                csvStream.end();

                console.log(`Wrote to ${outputFile}`);
            }
        });
}

processFile();
