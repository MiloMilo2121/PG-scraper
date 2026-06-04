import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const WITH_WEBSITE_PATH = path.join(process.cwd(), 'output/campaigns/MASTER_WITH_WEBSITE.csv');
const DISCOVERY_RESULTS_PATH = path.join(process.cwd(), 'output/campaigns/MASTER_NO_WEBSITE_discovery_results.csv');
const OUTPUT_PATH = path.join(process.cwd(), 'output/campaigns/ENRICHMENT_QUEUE.csv');

async function main() {
    const queue: any[] = [];

    // 1. Load MASTER_WITH_WEBSITE
    if (fs.existsSync(WITH_WEBSITE_PATH)) {
        const content = fs.readFileSync(WITH_WEBSITE_PATH, 'utf8');
        const records = parse(content, { columns: true, skip_empty_lines: true });
        console.log(`📂 Loaded ${records.length} from MASTER_WITH_WEBSITE`);
        queue.push(...records);
    }

    // 2. Load newly found from discovery
    if (fs.existsSync(DISCOVERY_RESULTS_PATH)) {
        const content = fs.readFileSync(DISCOVERY_RESULTS_PATH, 'utf8');
        const records = parse(content, { columns: true, skip_empty_lines: true });
        const found = records.filter((r: any) => r.status === 'found' && r.website_url);
        console.log(`📂 Loaded ${found.length} newly found websites from discovery results`);
        
        const mapped = found.map((r: any) => ({
            company_name: r.company_name,
            city: r.city,
            address: r.address,
            website: r.website_url,
            category: r.query_category || 'Agenzie immobiliari',
            source: `V8_Discovery:${r.website_layer}`
        }));
        queue.push(...mapped);
    }

    if (queue.length === 0) {
        console.error('❌ No records found to enrich!');
        return;
    }

    // 3. Deduplicate by website
    const seen = new Set();
    const finalQueue = queue.filter(r => {
        const site = r.website?.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        if (!site || seen.has(site)) return false;
        seen.add(site);
        return true;
    });

    console.log(`✨ Total deduplicated companies in queue: ${finalQueue.length}`);

    fs.writeFileSync(OUTPUT_PATH, stringify(finalQueue, { header: true }));
    console.log(`✅ Enrichment queue saved to: ${OUTPUT_PATH}`);
}

main().catch(console.error);
