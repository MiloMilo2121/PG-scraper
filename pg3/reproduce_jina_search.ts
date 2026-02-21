
import * as dotenv from 'dotenv';
import { ScraperClient } from './src/enricher/utils/scraper_client';

dotenv.config();

async function testJina(query: string) {
    console.log(`\n🧪 Testing Jina Query: ${query}`);

    try {
        const response = await ScraperClient.fetchJinaSearch(query);
        console.log(`   Status: ${response.status}`);
        console.log(`   Data Length: ${response.data.length}`);

        const results = ScraperClient.parseJinaSearchResults(response.data);
        console.log(`   Parsed Results: ${results.length}`);

        results.slice(0, 5).forEach(r => {
            console.log(`   - [${r.title}] ${r.url}`);
        });

        const fatturato = results.find(r => r.url.includes('fatturatoitalia.it'));
        if (fatturato) {
            console.log(`\n✅ FOUND TARGET: ${fatturato.url}`);
        } else {
            console.log(`\n❌ TARGET NOT FOUND (fatturatoitalia.it)`);
        }

    } catch (e: any) {
        console.error(`❌ EXCEPTION: ${e.message}`);
        if (e.response) {
            console.error(`   Response: ${e.response.data}`);
        }
    }
}

async function run() {
    await testJina('site:fatturatoitalia.it "Logicmec Srl" "Brescia"');
}

run();
