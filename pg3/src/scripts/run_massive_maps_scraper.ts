
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';

puppeteer.use(StealthPlugin());

// CONFIGURATION
const KEYWORDS = [
    "meccatronica",
    "automazione industriale",
    "robotica",
    "costruzioni meccaniche",
    "ingegneria meccanica",
    "officina meccanica di precisione",
    "lavorazioni meccaniche",
    "carpenteria metallica",
    "torneria metalli",
    "fresatura metalli"
];

// PROVINCES OF INTEREST (Lombardia + Veneto)
// We will expand this to full 8000 list later, starting with key industrial hubs
const TARGET_CITIES = [
    // Lombardia
    "Brescia", "Bergamo", "Milano", "Monza", "Lodi", "Cremona", "Mantova",
    "Montichiari", "Lumezzane", "Ghedi", "Palazzolo sull'Oglio", "Rovato", // BS Industrial
    "Dalmine", "Treviglio", "Seriate", // BG Industrial
    "Sesto San Giovanni", "Cinisello Balsamo", // MI Industrial
    // Veneto
    "Verona", "Vicenza", "Padova", "Treviso",
    "Villafranca di Verona", "San Giovanni Lupatoto", // VR Industrial
    "Schio", "Bassano del Grappa", "Thiene", // VI Industrial
    "Cittadella", "Vigonza" // PD Industrial
];

const OUTPUT_DIR = 'output/massive_maps';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function getSandboxArgs(): string[] {
    const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
    return inDocker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page: any) {
    await page.evaluate(async () => {
        const wrapper = document.querySelector('div[role="feed"]');
        if (!wrapper) return;

        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            let distance = 1000;
            let timer = setInterval(() => {
                const scrollHeight = wrapper.scrollHeight;
                wrapper.scrollBy(0, distance);
                totalHeight += distance;

                // Stop if we reached bottom or scrolled too much (safety)
                if (totalHeight >= scrollHeight || totalHeight > 20000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 500);
        });
    });
}

async function main() {
    console.log(`🚀 STARTING MASSIVE MAPS SCRAPER (Legacy Protocol Restored)`);
    console.log(`🎯 Keywords: ${KEYWORDS.length}`);
    console.log(`🌍 Municipalities: ${TARGET_CITIES.length}`);

    const browser = await puppeteer.launch({
        headless: false, // User wants to see the "Bomba" in action usually, or set true for server
        args: [...getSandboxArgs(), '--window-size=1920,1080'],
        defaultViewport: null
    });

    try {
        const timestamp = new Date().toISOString().split('T')[0];
        const outputFile = path.join(OUTPUT_DIR, `massive_maps_results_${timestamp}.csv`);

        const csvWriter = createObjectCsvWriter({
            path: outputFile,
            header: [
                { id: 'keyword', title: 'Keyword' },
                { id: 'municipality', title: 'Municipality' },
                { id: 'company_name', title: 'Company Name' },
                { id: 'address', title: 'Address' },
                { id: 'website', title: 'Website' },
                { id: 'phone', title: 'Phone' },
                { id: 'plus_code', title: 'Plus Code' },
                { id: 'maps_url', title: 'Maps URL' }
            ],
            append: fs.existsSync(outputFile)
        });

        const page = await browser.newPage();
        const seen = new Set<string>();

        for (const city of TARGET_CITIES) {
            for (const keyword of KEYWORDS) {
            try {
                const query = `${keyword} ${city}`;
                console.log(`\n🔎 Processing: "${query}"`);

                await page.goto(`https://www.google.it/maps/search/${encodeURIComponent(query)}`, {
                    waitUntil: 'networkidle2',
                    timeout: 60000
                });

                // Cookie consent (Brute Force)
                try {
                    const buttons = await page.$$('button');
                    for (const b of buttons) {
                        const txt = await (await b.getProperty('innerText')).jsonValue();
                        if (typeof txt === 'string' && (txt.includes('Accetta tutto') || txt.includes('Accept all'))) {
                            await b.click();
                            await delay(1000);
                            break;
                        }
                    }
                } catch (e) { }

                // Scroll to load all pins
                await autoScroll(page);
                await delay(2000);

                // Find all result links (The "Pins" in the feed)
                // .hfpxzc is the class for the invisible link covering the result card
                const pins = await page.$$('.hfpxzc');
                console.log(`   📍 Found ${pins.length} pins. Clicking them one by one...`);

                for (const pin of pins) {
                    try {
                        // Click the pin to open side panel
                        await pin.click();
                        await delay(1500); // Wait for side panel animation

                        // Extract data from Side Panel
                        const data = await page.evaluate(() => {
                            const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() || '';
                            const getHref = (sel: string) => document.querySelector(sel)?.getAttribute('href') || '';

                            // Role heading for name
                            const name = document.querySelector('h1')?.textContent?.trim() || '';

                            // Specific standard icons/selectors for maps (these change often, utilizing stable aria-labels or known structures)
                            // Address usually has data-item-id="address" or similar, but generic approach:
                            // We look for buttons with specific properties or generic text scanning

                            // Website: often a link with "Sito web" or "Website" text or icon
                            const webLink = document.querySelector('a[data-item-id="authority"]')?.getAttribute('href') || '';

                            // Phone: button with data-item-id starts with "phone:"
                            const phone = document.querySelector('button[data-item-id^="phone:"]')?.getAttribute('data-item-id')?.replace('phone:', '') || '';

                            // Address: button with data-item-id="address"
                            const address = document.querySelector('button[data-item-id="address"]')?.getAttribute('aria-label')?.replace('Indirizzo: ', '') || '';

                            // Plus Code
                            const plusCode = document.querySelector('button[data-item-id="oloc"]')?.getAttribute('aria-label')?.replace('Plus Code: ', '') || '';

                            return {
                                company_name: name,
                                website: webLink,
                                phone: phone,
                                address: address,
                                plus_code: plusCode,
                                maps_url: window.location.href
                            };
                        });

                        if (data.company_name && !seen.has(data.company_name)) {
                            seen.add(data.company_name);
                            console.log(`      ✅ ${data.company_name} | 🌐 ${data.website || 'No Site'} | 📞 ${data.phone}`);

                            await csvWriter.writeRecords([{
                                keyword: keyword,
                                municipality: city,
                                ...data
                            }]);
                        }

                    } catch (e) {
                        // Ignore individual pin fail
                    }
                }

            } catch (e) {
                console.error(`   ❌ Failed query "${keyword} ${city}":`, e);
            }
            }
        }

        console.log(`\n✨ DONE! Output saved to: ${outputFile}`);
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error('Fatal error in massive maps scraper:', error);
    process.exit(1);
});
