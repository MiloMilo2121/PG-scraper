import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';

const OUTPUT_DIR = path.join(__dirname, '../../output/campaigns');

function main() {
    const files = fs.readdirSync(OUTPUT_DIR);
    
    const withWeb = files.filter(f => f.includes('TIERED_WITH_WEBSITE'));
    const noWeb = files.filter(f => f.includes('TIERED_NO_WEBSITE'));
    
    let withWebData: any[] = [];
    let noWebData: any[] = [];
    
    // Merge WITH
    for(const f of withWeb) {
        const rows = parseCsv(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'), {columns: true, skip_empty_lines: true});
        withWebData.push(...rows);
    }
    
    // Merge NO
    for(const f of noWeb) {
        const rows = parseCsv(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'), {columns: true, skip_empty_lines: true});
        noWebData.push(...rows);
    }

    // Deduplicate logic just in case (by phone or name)
    const dedupWithWeb = Array.from(new Map(withWebData.map(item => [item.company_name, item])).values());
    const dedupNoWeb = Array.from(new Map(noWebData.map(item => [item.company_name, item])).values());

    if(dedupWithWeb.length > 0) {
        const keys = Object.keys(dedupWithWeb[0]).map(id => ({id, title: id}));
        const writerWith = createObjectCsvWriter({ path: path.join(OUTPUT_DIR, 'MASTER_WITH_WEBSITE.csv'), header: keys });
        writerWith.writeRecords(dedupWithWeb).then(() => console.log('✅ MASTER_WITH_WEBSITE creato con', dedupWithWeb.length, 'record.'));
    }
    
    if(dedupNoWeb.length > 0) {
        const keys = Object.keys(dedupNoWeb[0]).map(id => ({id, title: id}));
        const writerNo = createObjectCsvWriter({ path: path.join(OUTPUT_DIR, 'MASTER_NO_WEBSITE.csv'), header: keys });
        writerNo.writeRecords(dedupNoWeb).then(() => console.log('✅ MASTER_NO_WEBSITE creato con', dedupNoWeb.length, 'record.'));
    }
}
main();
