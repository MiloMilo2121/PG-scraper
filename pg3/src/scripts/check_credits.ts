
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkCredits() {
    console.log('🔍 Checking API Credits and Usage...\n');

    // 1. Serper.dev
    const serperKey = process.env.SERPER_API_KEY;
    if (serperKey) {
        console.log('--- Serper.dev ---');
        try {
            // Try the account/credits endpoint first (undocumented but common)
            try {
                const account = await axios.get('https://google.serper.dev/credits', {
                    headers: { 'X-API-KEY': serperKey }
                });
                console.log('✅ Credits Endpoint Response:', JSON.stringify(account.data, null, 2));
            } catch (e) {
                console.log('ℹ️ No direct "credits" endpoint found, searching to check headers...');
                // Fallback: Perform a search and check headers
                const response = await axios.post('https://google.serper.dev/search',
                    { q: "test", num: 1 },
                    { headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' } }
                );

                // Inspect headers for credits
                const headers = response.headers;
                const creditHeaders = Object.keys(headers).filter(h => h.toLowerCase().includes('credit') || h.toLowerCase().includes('quota') || h.toLowerCase().includes('limit'));

                if (creditHeaders.length > 0) {
                    console.log('📊 Usage Headers:');
                    creditHeaders.forEach(h => console.log(`   ${h}: ${headers[h]}`));
                } else {
                    console.log('❌ No credit headers found in search response.');
                }
            }
        } catch (error: any) {
            console.error('❌ Serper Check Failed:', error.message);
            if (error.response) {
                console.log('   Status:', error.response.status);
                console.log('   Data:', error.response.data);
            }
        }
    } else {
        console.log('⚠️ SERPER_API_KEY not found in .env');
    }

    console.log('\n--------------------------------\n');

    // 2. Scrape.do
    const scrapeDoToken = process.env.SCRAPE_DO_TOKEN;
    if (scrapeDoToken) {
        console.log('--- Scrape.do ---');
        try {
            // Try to just get usage info from a known endpoint or just check functionality
            const targetUrl = 'http://httpbin.org/json';
            const url = `http://api.scrape.do?token=${scrapeDoToken}&url=${encodeURIComponent(targetUrl)}`;

            const response = await axios.get(url);

            const headers = response.headers;
            const usageHeaders = Object.keys(headers).filter(h => h.toLowerCase().includes('credit') || h.toLowerCase().includes('quota') || h.toLowerCase().includes('request') || h.toLowerCase().includes('concurrent'));

            if (usageHeaders.length > 0) {
                console.log('📊 Usage Headers:');
                usageHeaders.forEach(h => console.log(`   ${h}: ${headers[h]}`));
            } else {
                console.log('ℹ️ No specific usage headers found. Service is active.');
            }

        } catch (error: any) {
            console.error('❌ Scrape.do Check Failed:', error.message);
            if (error.response) {
                console.log('   Status:', error.response.status);
                console.log('   Data:', error.response.data);
            }
        }
    } else {
        console.log('⚠️ SCRAPE_DO_TOKEN not found in .env');
    }
}

checkCredits();
