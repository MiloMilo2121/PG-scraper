import { OpportunisticExtractor } from './src/foundation/OpportunisticExtractor';
import { ScraperClient } from './src/enricher/utils/scraper_client';
import { initializeRuntimeEnvironment } from './src/shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from './src/shared-runtime/config/runtime_config';

async function test() {
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const url = "https://www.registroaziende.it/azienda/caldiero-case-snc-di-corsi-eros-e-maistri-luigi-caldiero";
    console.log(`🚀 Testing OpportunisticExtractor on: ${url}`);
    
    // Simulate what checkUrl does when falling back to BrightData
    console.log(`🛡️ Fetching HTML via BrightData...`);
    const bdResponse = await ScraperClient.fetchHtml(url, { mode: 'brightdata', timeoutMs: 30000 });
    
    if (bdResponse.status === 200 && bdResponse.data) {
        console.log(`✅ HTML Fetched (${bdResponse.data.length} bytes). Extracting...`);
        const extracted = OpportunisticExtractor.extract(bdResponse.data, url);
        console.log(`\n📊 RESULTS:`);
        console.log(JSON.stringify(extracted, null, 2));
    } else {
        console.log(`❌ Failed to fetch: HTTP ${bdResponse.status}`);
    }
}

test().catch(console.error);
