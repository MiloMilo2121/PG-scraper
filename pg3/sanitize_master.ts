import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT_FILE = 'output/campaigns/RESCUE_BOARD_MASTER.csv';
const OUTPUT_FILE = 'output/campaigns/BOARD_FINAL_SANITISED.csv';

async function sanitize() {
    console.log("🧹 STARTING ROBUST SANITIZATION (FAST-CSV v2)...");

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        process.exit(1);
    }

    const records: any[] = [];
    const seenMap = new Set<string>(); // Deduplication

    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(parse({
                headers: true,
                ignoreEmpty: true,
                discardUnmappedColumns: true,
                strictColumnHandling: false,
                quote: '"',
                escape: '"',
                ltrim: true,
                rtrim: true
            }))
            .on('error', error => {
                console.error("Parsing Error:", error);
                reject(error);
            })
            .on('data', (row) => {
                // 1. Clean up the messy address/phone fields
                let name = row.company_name?.trim() || 'Unknown';
                let city = row.city?.trim() || '';
                // Address often contains newlines and tabs
                let address = row.address?.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || '';
                let phone = row.phone?.replace(/[\r\n\t]+/g, '').trim() || '';
                let website = row.website?.trim() || '';
                let category = row.category?.trim() || '';

                // 2. Extract Province from Address if missing
                let province = row.province || '';
                if (!province) {
                    const provMatch = address.match(/\(([A-Z]{2})\)/);
                    if (provMatch) province = provMatch[1];
                }

                // 3. Default Category
                if (!category || category.toLowerCase() === 'industry') category = 'Meccanica/Automazione';

                // 4. Fallback for weird rows (sometimes city gets stuck in name?)
                // If name is huge and city is empty, split it? 
                // Let's trust fast-csv for now, but ensure we don't have empty critical fields.
                if (name.length > 100 && !city) {
                    // heuristics... skip for now
                }

                // Deduplication Key
                const key = `${name.toLowerCase()}|${city.toLowerCase()}`;

                if (!seenMap.has(key)) {
                    seenMap.add(key);
                    records.push({
                        company_name: name,
                        city: city,
                        province: province,
                        address: address,
                        phone: phone,
                        website: website,
                        category: category
                    });
                }
            })
            .on('end', () => {
                resolve();
            });
    });

    console.log(`✅ Parsed ${records.length} valid unique records.`);

    if (records.length === 0) {
        console.warn("⚠️ No records parsed! Check the input format or headers.");
        return;
    }

    const csvWriter = createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'company_name', title: 'company_name' },
            { id: 'city', title: 'city' },
            { id: 'province', title: 'province' },
            { id: 'address', title: 'address' },
            { id: 'phone', title: 'phone' },
            { id: 'website', title: 'website' },
            { id: 'category', title: 'category' }
        ]
    });

    await csvWriter.writeRecords(records);
    console.log(`✨ SANITIZATION COMPLETE! Saved to ${OUTPUT_FILE}`);
}

sanitize().catch(console.error);
