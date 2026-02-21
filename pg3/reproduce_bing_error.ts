
import * as dotenv from 'dotenv';
import { ScraperClient } from './src/enricher/utils/scraper_client';
import * as cheerio from 'cheerio';

dotenv.config();

async function testBing(query: string, render: boolean) {
    console.log(`\n🧪 Testing Bing Query: ${query} (Render: ${render})`);
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

    try {
        console.log(`   Fetching: ${bingUrl}`);
        // Use Scrape.do as in IdentityResolver
        const html = await ScraperClient.fetchText(bingUrl, { mode: 'scrape_do', render: render });

        console.log(`   Fetched: ${html.length} chars`);
        if (html.length < 1000) {
            console.log(`   RAW BODY: ${html}`);
        } else {
            console.log(`   RAW BODY (First 500): ${html.substring(0, 500)}`);
        }

        const $ = cheerio.load(html);

        // Check for results
        const results: string[] = [];
        $('li.b_algo h2 a').each((i, el) => {
            const href = $(el).attr('href');
            if (href) results.push(href);
        });

        console.log(`   Found ${results.length} results:`);
        results.slice(0, 5).forEach(r => console.log(`   - ${r}`));

        // Check for specific FatturatoItalia result
        const fatturato = results.find(r => r.includes('fatturatoitalia.it'));
        if (fatturato) {
            console.log(`\n✅ FOUND TARGET: ${fatturato}`);
        } else {
            console.log(`\n❌ TARGET NOT FOUND (fatturatoitalia.it)`);
            // Check for potential blocks/captchas text
            const bodyText = $('body').text().toLowerCase();
            if (bodyText.includes('robot') || bodyText.includes('captcha') || bodyText.includes('unusual traffic') || bodyText.includes('challenge')) {
                console.log('   ⚠️  CAPTCHA/BLOCK DETECTED');
            }
        }

    } catch (e: any) {
        console.error(`❌ EXCEPTION: ${e.message}`);
    }
}

async function run() {
    // Test case 1: Render=True (Current Logic)
    console.log("--- TEST 1: Render=True ---");
    await testBing('site:fatturatoitalia.it "Logicmec Srl" "Brescia"', true);

    // Test case 2: Render=False (Potential Fix)
    console.log("\n--- TEST 2: Render=False ---");
    await testBing('site:fatturatoitalia.it "Logicmec Srl" "Brescia"', false);
}

run();
