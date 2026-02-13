
import { ScraperClient } from '../enricher/utils/scraper_client';
import { Logger } from '../enricher/utils/logger';

async function test() {
    console.log("🚀 Testing Scrape.do connectivity...");

    const targetUrl = "https://www.google.com/search?q=test+connectivity+check";

    try {
        console.log(`📡 Fetching ${targetUrl} via Scrape.do...`);
        const response = await ScraperClient.fetchHtml(targetUrl, {
            mode: 'scrape_do',
            render: true, // Test render mode too as it's often used
            timeoutMs: 30000
        });

        console.log("---------------------------------------------------");
        console.log(`✅ Status: ${response.status}`);
        console.log(`✅ Via: ${response.via}`);
        console.log(`✅ Data Length: ${response.data.length} chars`);
        console.log(`✅ Sample Data: ${response.data.slice(0, 100)}...`);

        if (response.status === 200 && response.data.length > 500) {
            console.log("🎉 TEST PASSED: Scrape.do is working!");
        } else {
            console.error("❌ TEST FAILED: Invalid status or data length.");
            process.exit(1);
        }

    } catch (error) {
        console.error("❌ TEST FAILED with Error:", error);
        process.exit(1);
    }
}

test();
