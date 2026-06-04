import 'dotenv/config';
import { initializeRuntimeConfig } from './src/shared-runtime/config/runtime_config';
initializeRuntimeConfig();
import { ScraperClient } from './src/enricher/utils/scraper_client';

async function test() {
    console.log('🚀 Starting Isolated Bright Data Web Unlocker Test');
    try {
        console.log('BRIGHT DATA ENABLED?', ScraperClient.isBrightDataEnabled());
        
        const res = await ScraperClient.fetchHtml('https://visura.pro', { mode: 'brightdata', timeoutMs: 30000 });
        console.log(`✅ Result HTTP Status: ${res.status}`);
        console.log(`✅ Result Via: ${res.via}`);
        console.log(`✅ Result Content Length: ${res.data.length} bytes`);
        console.log(`✅ HTML Snippet:`, res.data.substring(0, 150));
    } catch (err: any) {
        console.error('❌ Error:', err.message);
    }
}
test().catch(console.error);
