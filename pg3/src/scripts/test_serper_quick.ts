
import { SerperSearchProvider } from '../enricher/core/discovery/search_provider';
import { Logger } from '../enricher/utils/logger';

async function test() {
    console.log("🚀 Testing Serper.dev connectivity...");

    // Configura key manuale se non in .env
    process.env.SERPER_API_KEY = process.env.SERPER_API_KEY || 'e0feae3b0d8ba0ebcdc8a70874543e15bd6bf01a';

    const provider = new SerperSearchProvider();
    const query = "site:it Trattoria da Mario Roma p.iva";

    try {
        console.log(`📡 Searching for: "${query}"...`);
        const results = await provider.search(query);

        console.log("---------------------------------------------------");
        console.log(`✅ Results found: ${results.length}`);

        if (results.length > 0) {
            console.log("🔍 Top Result:", results[0]);
            console.log("🎉 TEST PASSED: Serper.dev is working!");
        } else {
            console.warn("⚠️ TEST WARNING: No results found (but no error).");
        }

    } catch (error) {
        console.error("❌ TEST FAILED with Error:", error);
        process.exit(1);
    }
}

test();
