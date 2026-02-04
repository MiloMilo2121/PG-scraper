
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './src/core/browser/factory_v2';
import { Page } from 'puppeteer'; // Verify if puppeteer is installed directly or use 'puppeteer-core' if needed

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- CONFIGURATION ---
const MAX_PAGES_PG = 5; // How many pages of PG to scrape per keyword
const RETRY_ATTEMPTS = 3;
const OUTPUT_DIR = 'output/campaigns';

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// "GLI ALTRI MODI PER DIRLO" - Expanded Synonym List
const TERMS = {
    MECCATRONICA: ["meccatronica", "automazione industriale", "robotica", "costruzioni meccaniche", "ingegneria meccanica", "banchi di collaudo", "presse elettriche"],
    IMPIANTISTICA: ["impiantistica industriale", "manutenzione macchine automatiche", "installazione impianti", "quadri elettrici industriali", "revamping macchinari"],
    MANGIFICI: ["mangifici", "nutrizione animale", "produzione mangimi", "impianti zootecnici", "alimenti zootecnici"],
    ELETTRICO: ["materiale elettrico", "elettrotecnica", "cablaggio quadri", "automazione quadri", "elettronica industriale"],
    INFORMATICO: ["software house", "sviluppo software gestionale", "consulenza informatica", "sistemi integrati", "fabbrica 4.0", "iot industriale"]
};

// Flatten to simple list for iterating
const KEYWORDS = Object.values(TERMS).flat();

const CITIES = [
    "Verona",
    "Padova",
    "Brescia",
    "Mantova",
    "Vicenza"
];

// --- HELPERS ---
async function retry<T>(fn: () => Promise<T>, retries = RETRY_ATTEMPTS): Promise<T | null> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) {
                console.error(`   ❌ Failed after ${retries} attempts: ${(e as Error).message}`);
                return null;
            }
            await delay(2000 * (i + 1));
        }
    }
    return null;
}

// --- MAIN ---
async function main() {
    console.log(`🚀 LA BOMBA v3 (Robust & Segmented)...`);
    console.log(`🎯 Keywords: ${KEYWORDS.length} variations`);
    console.log(`📍 Cities: ${CITIES.join(', ')}`);

    // Launch Browser Factory (for Genetic Fingerprinting & Stealth)
    const browserFactory = BrowserFactory.getInstance();

    // We don't launch explicitly, newPage() handles it.
    console.log(`🚀 Using BrowserFactory for Genetic Stealth capabilities...`);

    const seen = new Set<string>();
    let totalFound = 0;
    let page: Page | undefined;

    try {
        page = await browserFactory.newPage();
        if (!page) throw new Error('Failed to create page from BrowserFactory');
        // Viewport is set by GeneticFingerprinter inside newPage, but ensuring size doesn't hurt.
        // await page.setViewport({ width: 1920, height: 1080 }); // Let Gene decide

        // BLOCK RESOURCE HEAVY REQUESTS (Optimization)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        for (const city of CITIES) {
            console.log(`\n🏙️  PROCESSING CITY: ${city}`);

            // Output Separation: File per city
            const timestamp = new Date().toISOString().split('T')[0];
            const cityFile = path.join(OUTPUT_DIR, `campaign_${city.toLowerCase()}_${timestamp}.csv`);
            const csvWriter = createObjectCsvWriter({
                path: cityFile,
                header: [
                    { id: 'company_name', title: 'company_name' },
                    { id: 'city', title: 'city' },
                    { id: 'province', title: 'province' },
                    { id: 'address', title: 'address' },
                    { id: 'phone', title: 'phone' },
                    { id: 'website', title: 'website' },
                    { id: 'category', title: 'category' },
                    { id: 'source', title: 'source' },
                    { id: 'google_cid', title: 'google_cid' },
                    { id: 'google_url', title: 'google_url' }
                ],
                append: fs.existsSync(cityFile)
            });

            for (const keyword of KEYWORDS) {
                console.log(`   🔎 Searching: "${keyword}"...`);

                // --- SOURCE 1: PAGINE GIALLE (With Pagination) ---
                try {
                    let pageNum = 1;
                    let hasNext = true;

                    while (hasNext && pageNum <= MAX_PAGES_PG) {
                        const qKey = keyword.replace(/ /g, '%20');
                        const qCity = city.replace(/ /g, '%20');
                        // Pagination URL pattern usually /p-2 etc, but let's try standard navigation first
                        const pgUrl = `https://www.paginegialle.it/ricerca/${qKey}/${qCity}/p-${pageNum}`;

                        await retry(async () => {
                            await page!.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                        });

                        // Selector check
                        const hasItems = await page!.$('.search-itm');
                        if (!hasItems) {
                            if (pageNum === 1) console.log(`      ⚠️ No PG results for "${keyword}"`);
                            break; // excessive pagination or empty
                        }

                        const pgResults = await page!.evaluate((cityName, keyW) => {
                            return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                                const name = item.querySelector('.search-itm__rag')?.textContent?.trim() || '';
                                const address = item.querySelector('.search-itm__adr')?.textContent?.trim() || '';
                                const phone = item.querySelector('.search-itm__phone')?.textContent?.trim() || '';

                                // Website Extraction
                                const webElem = item.querySelector('.search-itm__url') || item.querySelector('a[href^="http"]:not([href*="paginegialle.it"])');
                                const website = webElem ? webElem.getAttribute('href') : '';

                                return name ? {
                                    company_name: name,
                                    city: cityName,
                                    address: address,
                                    phone: phone,
                                    website: website,
                                    category: keyW,
                                    source: 'PG'
                                } : null;
                            }).filter(x => x);
                        }, city, keyword);

                        if (pgResults.length > 0) {
                            console.log(`      📄 PG Page ${pageNum}: found ${pgResults.length}`);

                            const toSave = [];
                            for (const c of pgResults) {
                                if (c && !seen.has(c.company_name + c.city)) { // De-dupe per name+city
                                    seen.add(c.company_name + c.city);
                                    toSave.push(c);
                                    totalFound++;
                                }
                            }
                            if (toSave.length > 0) await csvWriter.writeRecords(toSave);
                        } else {
                            hasNext = false;
                        }

                        pageNum++;
                        await delay(1000);
                    }
                } catch (e) { console.log(`   ⚠️ PG Error: ${(e as Error).message}`); }

                // --- SOURCE 2: GOOGLE MAPS (Local Pack / SERP) ---
                // Keeping simple single-page for Google to avoid bans
                try {
                    const gUrl = `https://www.google.it/search?q=${encodeURIComponent(keyword + ' ' + city)}&gl=it&hl=it`;
                    await retry(async () => {
                        await page!.goto(gUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    });

                    // Simple Consent
                    try {
                        await page!.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button'));
                            const accept = btns.find(b => b.textContent?.toLowerCase().includes('accetta') || b.textContent?.toLowerCase().includes('accept'));
                            if (accept) accept.click();
                        });
                        await delay(500);
                    } catch { }

                    // --- DEEP SCRAPING (Click & Extract) ---
                    const items = await page!.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd');
                    const gResults: any[] = [];

                    console.log(`      📍 Found ${items.length} candidates. Starting deep scan...`);

                    for (const item of items) {
                        try {
                            // 1. Get Basic Name first (for logging)
                            const basicName = await item.evaluate(el => el.textContent?.split('\n')[0].trim() || 'Unknown');

                            // 2. Click to open side panel
                            await item.click();
                            try {
                                await page!.waitForSelector('div[role="complementary"]', { timeout: 3000 });
                            } catch (e) {
                                // Sometimes it expands inline or opens elsewhere.
                            }

                            // 3. Extract from Side Panel (The "Golden Record")
                            const details = await page!.evaluate(() => {
                                const side = document.querySelector('div[role="complementary"]');
                                if (!side) return null;

                                const title = side.querySelector('h2')?.textContent?.trim() || '';

                                // Website Button: usually has "Sito web" or "Website" text or icon
                                // Google often puts website in 'a' with specific data-item-id="authority" or similar
                                const webBtn = Array.from(side.querySelectorAll('a')).find(a =>
                                    a.textContent?.toLowerCase().includes('sito') ||
                                    a.textContent?.toLowerCase().includes('website') ||
                                    a.getAttribute('aria-label')?.toLowerCase().includes('sito')
                                );
                                let website = webBtn?.getAttribute('href') || '';
                                if (website.includes('/url?q=')) website = website.split('/url?q=')[1].split('&')[0];
                                website = decodeURIComponent(website);

                                // Phone: Look for aria-label "Call" or pattern matching
                                const phoneBtn = Array.from(side.querySelectorAll('button[data-tooltip*="Chiama"], button[aria-label*="Call"]')).find(x => x);
                                const phone = phoneBtn?.getAttribute('aria-label')?.replace(/[^0-9+ ]/g, '').trim() || '';

                                // Address
                                const addrBtn = Array.from(side.querySelectorAll('button[data-item-id="address"]')).find(x => x);
                                const address = addrBtn?.textContent?.trim() || '';

                                return { company_name: title, website, phone, address };
                            });

                            if (details && details.company_name) {
                                console.log(`         ✅ Deep Matched: ${details.company_name} -> ${details.website || 'No Web'} | ${details.phone || 'No Phone'}`);
                                gResults.push({
                                    company_name: details.company_name,
                                    city: city, // Inherited from loop
                                    address: details.address,
                                    phone: details.phone,
                                    website: details.website,
                                    category: keyword,
                                    source: 'GoogleMaps_Deep'
                                });
                            } else {
                                // Fallback to basic info if side panel failed
                                gResults.push({
                                    company_name: basicName,
                                    city: city,
                                    category: keyword,
                                    source: 'Google_Shallow',
                                    website: ''
                                });
                            }

                            // Small delay to be human
                            await delay(300 + Math.random() * 500);

                        } catch (e) {
                            // Ignore single item fail
                        }
                    }

                    const cleanGResults = gResults.filter(c => {
                        const n = c.company_name.toLowerCase();
                        return !n.includes('paginegialle') && !n.includes('risultati') && n.length < 60;
                    });

                    if (cleanGResults.length > 0) {
                        console.log(`      🗺️ Google: found ${cleanGResults.length}`);
                        const toSave = [];
                        for (const c of cleanGResults) {
                            if (!seen.has(c.company_name + c.city)) {
                                seen.add(c.company_name + c.city);
                                toSave.push(c);
                                totalFound++;
                            }
                        }
                        if (toSave.length > 0) await csvWriter.writeRecords(toSave);
                    }

                } catch (e) { console.log(`   ⚠️ Google Error: ${(e as Error).message}`); }

                // Slow down slightly to be polite
                await delay(500);
            }
        }

    } catch (e) {
        console.error("Critical Error", e);
    } finally {
        if (page) await browserFactory.closePage(page);
        await browserFactory.close();
    }

    console.log(`\n✨ BOMBA FINISHED! Generated campaigns in ${OUTPUT_DIR}. Total unique: ${totalFound}`);
}

main();
