
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

const INPUT_FILE = 'output/campaigns/RESCUE_BOARD_MASTER.csv';
const OUTPUT_FILE = 'output/campaigns/BOARD_FINAL_SANITISED.csv';

async function sanitize() {
    console.log("🧹 STARTING SANITIZATION...");

    const content = fs.readFileSync(INPUT_FILE, 'utf-8');
    const lines = content.split('\n');
    const cleanedRecords: any[] = [];

    let currentRecord: any = null;
    let inAddress = false;

    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Pattern Check: Does it start with a new record? (Company name usually doesn't have a leading quote unless it's a Maps shallow result)
        // PagineGialle results: name,city,"address
        const pgMatch = line.match(/^([^,]+),([^,]+),"(.*)$/);
        const shallowMatch = line.match(/^"(.*)"/);

        if (pgMatch) {
            // New PG Record
            currentRecord = {
                company_name: pgMatch[1].replace(/["']/g, '').trim(),
                city: pgMatch[2].replace(/["']/g, '').trim(),
                address: pgMatch[3].replace(/["']/g, '').trim(),
                phone: '',
                website: '',
                category: ''
            };
            inAddress = true;
            continue;
        }

        if (shallowMatch && !inAddress) {
            // Shallow Maps Record
            const text = shallowMatch[1];
            const phoneMatch = text.match(/\+39\s?[\d\s-]{8,20}/);
            const name = text.split(/\d\.\d/)[0].split(/·|·/)[0].trim().replace(/^Sponsored/, '');

            cleanedRecords.push({
                company_name: name || "Unknown",
                city: "Local Area",
                address: text.split('·').slice(1, 3).join(' ').trim() || text.substring(0, 50),
                phone: phoneMatch ? phoneMatch[0].trim() : "",
                website: text.toLowerCase().includes("website") ? "Yes" : "",
                category: "Industry"
            });
            continue;
        }

        if (inAddress) {
            // We are inside a multiline address
            if (line.includes('",')) {
                // End of address
                const [addrPart, rest] = line.split('",');
                currentRecord.address += " " + addrPart.replace(/["']/g, '').trim();

                const parts = rest.split(',');
                currentRecord.phone = parts[0].replace(/["']/g, '').replace(/[\n\r]/g, ' ').trim();
                currentRecord.website = parts[1]?.replace(/["']/g, '').trim() || '';
                currentRecord.category = parts[2]?.replace(/["']/g, '').trim() || '';


                // Cleanup address
                currentRecord.address = currentRecord.address.replace(/\s+/g, ' ').trim();

                cleanedRecords.push({ ...currentRecord });
                inAddress = false;
            } else {

                currentRecord.address += " " + line.replace(/["']/g, '').trim();
            }
        }
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

    // Final Touch: Extract Province and Sector
    const finalRecords = cleanedRecords.map(r => {
        const provMatch = r.address.match(/\(([A-Z]{2})\)/);
        r.province = provMatch ? provMatch[1] : '';
        if (!r.category || r.category === 'Industry') r.category = 'Meccanica/Automazione';
        return r;
    });

    await csvWriter.writeRecords(finalRecords);

    console.log(`✨ SANITIZATION COMPLETE! Saved ${cleanedRecords.length} clean records to ${OUTPUT_FILE}`);
}

sanitize();
