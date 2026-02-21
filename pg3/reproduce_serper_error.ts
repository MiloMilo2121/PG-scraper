
import * as dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.SERPER_API_KEY;

if (!API_KEY) {
    console.error("❌ SERPER_API_KEY is missing in .env");
    process.exit(1);
}

const EXCLUSION_SITES = [
    'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'youtube.com', 'tiktok.com',
    'paginegialle.it', 'paginebianche.it', 'virgilio.it', 'yelp.it', 'yelp.com', 'tripadvisor.it',
    'kompass.com', 'europages.com', 'prontopro.it', 'misterimprese.it', 'registroimprese.it',
    'reteimprese.it', 'informazione-aziende.it', 'guidatitolari.it', 'infojobs.it', 'indeed.com',
    'subito.it', 'glassdoor.it', 'amazon.it', 'ebay.it', 'groupon.it', 'wikipedia.org',
    'trustpilot.com'
];

async function testQuery(name: string, query: string) {
    console.log(`\n🧪 Testing Query: ${name}`);
    console.log(`   Length: ${query.length}`);
    console.log(`   Query: ${query.substring(0, 100)}...`);

    try {
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: query,
                gl: 'it',
                hl: 'it'
            })
        });

        if (!response.ok) {
            console.error(`❌ FAILED: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(`   Response: ${text}`);
        } else {
            console.log(`✅ SUCCESS: ${response.status} OK`);
            const data = await response.json();
            console.log(`   Results: ${data.organic?.length || 0}`);
        }
    } catch (e: any) {
        console.error(`❌ EXCEPTION: ${e.message}`);
    }
}

async function run() {
    // 1. Massive Exclusion Query (From QueryBuilder.buildGoldenQueries)
    const exclusions = EXCLUSION_SITES.map(s => `-site:${s}`).join(' ');
    const massiveQuery = `"Logicmec Srl" "Local Area" ${exclusions}`;
    await testQuery("Massive Exclusion", massiveQuery);

    // 2. Messy Scraped Query (seen in logs)
    // Note: The log showed: ""Automation company7+ years in business Brescia, Province of Brescia, ItalyOpen" "Local Area" "Logicmec Srl""
    const messyQuery = `"Automation company7+ years in business Brescia, Province of Brescia, ItalyOpen" "Local Area" "Logicmec Srl"`;
    await testQuery("Messy Scraped String", messyQuery);

    // 3. Control Query
    await testQuery("Simple Control", "Logicmec Srl Brescia");
}

run();
