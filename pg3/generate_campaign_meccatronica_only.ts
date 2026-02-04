import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './src/core/browser/factory_v2';
import { Page } from 'puppeteer';

// --- CONFIGURATION ---
const OUTPUT_DIR = 'output/campaigns';
const MAX_PAGES_PG = 5; // Scrape up to 5 pages of PG per keyword/city
// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 1. SINONIMI (Copertura Semantica Completa)
const TERMS = {
    MECCATRONICA: [
        "meccatronica",
        "automazione industriale",
        "robotica",
        "costruzioni meccaniche",
        "ingegneria meccanica",
        "banchi di collaudo",
        "presse elettriche",
        "fabbrica 4.0"
    ],
    IMPIANTISTICA: [
        "impiantistica industriale",
        "manutenzione macchine automatiche",
        "installazione impianti",
        "quadri elettrici industriali",
        "revamping macchinari",
        "impiantistica macchine automatiche"
    ],
    MANGIFICI: [
        "mangifici",
        "nutrizione animale",
        "produzione mangimi",
        "impianti zootecnici",
        "alimenti zootecnici"
    ],
    ELETTRICO: [
        "materiale elettrico",
        "cablaggio quadri",
        "automazione quadri",
        "elettronica industriale",
        "aziende settore elettrico",
        "elettrotecnica"
    ],
    INFORMATICO: [
        "software house",
        "sviluppo software gestionale",
        "consulenza informatica",
        "sistemi integrati",
        "iot industriale",
        "aziende settore informatico"
    ]
};
const KEYWORDS = Object.values(TERMS).flat();

// 2. CLUSTER STRATEGY (Copertura Geografica "Super Complete")
const TARGET_CLUSTERS = {
    VERONA_HUB: ["Verona", "Villafranca di Verona", "San Giovanni Lupatoto", "Bussolengo", "San Bonifacio", "Legnago", "Peschiera del Garda"],
    BRESCIA_HUB: ["Brescia", "Desenzano del Garda", "Montichiari", "Lumezzane", "Palazzolo sull'Oglio", "Rovato", "Ghedi"],
    VICENZA_HUB: ["Vicenza", "Bassano del Grappa", "Schio", "Thiene", "Arzignano", "Montecchio Maggiore"],
    PADOVA_HUB: ["Padova", "Albignasego", "Selvazzano Dentro", "Vigonza", "Cittadella", "Abano Terme"],
    MANTOVA_HUB: ["Mantova", "Castiglione delle Stiviere", "Suzzara", "Viadana"]
};
const CITIES = Object.values(TARGET_CLUSTERS).flat();

// --- HELPERS ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retry<T>(fn: () => Promise<T>, retries = 3): Promise<T | null> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) return null;
            await delay(2000 * (i + 1));
        }
    }
    return null;
}

// Robust Cookie Smasher
async function smashCookies(page: Page) {
    try {
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            // Cerca match testuali in varie lingue
            const accept = buttons.find(b =>
                /accetta tutto|accetta|accept all|agree|acconsento|consent/i.test((b as HTMLElement).innerText || '')
            );
            if (accept) {
                (accept as HTMLElement).click();
                return true;
            }
            // Fallback
            const formBtns = document.querySelectorAll('form button');
            if (formBtns.length > 0) {
                (formBtns[formBtns.length - 1] as HTMLElement).click();
                return true;
            }
            return false;
        });
        if (clicked) await new Promise(r => setTimeout(r, 1500));
    } catch (e) { }
}

async function main() {
    console.log(`🚀 ULTIMATE GOD MODE SCRAPER ACTIVATED`);
    console.log(`🎯 Keywords: ${KEYWORDS.length}`);
    console.log(`📍 Clusters: ${CITIES.length} cities`);

    const browserFactory = BrowserFactory.getInstance();
    const seen = new Set<string>();
    let totalFound = 0;
    let page: Page | undefined;

    try {
        page = await browserFactory.newPage();

        await page!.setRequestInterception(true);
        page!.on('request', (req) => {
            if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        for (const city of CITIES) {
            console.log(`\n🏙️  ANALYZING CLUSTER: ${city.toUpperCase()}`);

            const timestamp = new Date().toISOString().split('T')[0];
            const cityFile = path.join(OUTPUT_DIR, `campaign_${city.replace(/ /g, '_').toLowerCase()}_${timestamp}.csv`);
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
                    { id: 'google_url', title: 'google_url' },
                    { id: 'description', title: 'description' }
                ],
                append: fs.existsSync(cityFile)
            });

            for (const keyword of KEYWORDS) {
                console.log(`   🔎 Searching: "${keyword}"...`);

                // --- SOURCE 1: PAGINE GIALLE ---
                try {
                    let pageNum = 1;
                    let hasNext = true;

                    while (hasNext && pageNum <= MAX_PAGES_PG) {
                        const qKey = keyword.replace(/ /g, '%20');
                        const qCity = city.replace(/ /g, '%20');
                        const pgUrl = `https://www.paginegialle.it/ricerca/${qKey}/${qCity}/p-${pageNum}`;

                        await retry(async () => {
                            await page!.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                        });

                        const hasItems = await page!.$('.search-itm');
                        if (!hasItems) {
                            if (pageNum === 1) console.log(`      ⚠️ No PG results`);
                            break;
                        }

                        const pgResults = await page!.evaluate((cityName, keyW) => {
                            // Helper for string cleaning
                            const clean = (s: string | null | undefined) => {
                                if (!s) return '';
                                return s.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                            };

                            return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                                const name = clean(item.querySelector('.search-itm__rag')?.textContent);
                                const address = clean(item.querySelector('.search-itm__adr')?.textContent);
                                const phone = clean(item.querySelector('.search-itm__phone')?.textContent);
                                const desc = clean(item.querySelector('.search-itm__text')?.textContent || item.querySelector('.search-itm__slogan')?.textContent);

                                const webElem = item.querySelector('.search-itm__url') || item.querySelector('a[href^="http"]:not([href*="paginegialle.it"])');
                                const website = webElem ? webElem.getAttribute('href') : '';

                                return name ? {
                                    company_name: name,
                                    city: cityName,
                                    province: '', // Not always available easily
                                    address: address,
                                    phone: phone,
                                    website: website,
                                    category: keyW,
                                    source: 'PG',
                                    description: desc
                                } : null;
                            }).filter(x => x);
                        }, city, keyword);

                        if (pgResults.length > 0) {
                            console.log(`      📄 PG Page ${pageNum}: found ${pgResults.length}`);
                            const toSave = [];
                            for (const c of pgResults) {
                                if (c) {
                                    const uniqueKey = `${c.company_name}_${city}`.toLowerCase();
                                    if (!seen.has(uniqueKey)) {
                                        seen.add(uniqueKey);
                                        toSave.push(c);
                                        totalFound++;
                                    }
                                }
                            }
                            if (toSave.length > 0) await csvWriter.writeRecords(toSave);
                        } else {
                            hasNext = false;
                        }

                        pageNum++;
                        await delay(1000);
                    }
                } catch (e) { }


                // --- SOURCE 2: GOOGLE MAPS (US Mode) ---
                try {
                    // Use US Google to bypass Italian cookie wall
                    const gUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword + ' ' + city)}&tbm=lcl&hl=en&gl=us`;

                    await page!.goto(gUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await smashCookies(page!);

                    const containerSelectors = ['.VkpGBb', 'div[jscontroller="AtSb"]', '.dbg0pd', '.C8TUKc'];
                    let foundContainer = false;
                    for (const sel of containerSelectors) {
                        if (await page!.$(sel)) { foundContainer = true; break; }
                    }

                    if (!foundContainer) {
                        const bodyText = await page!.evaluate(() => document.body.innerText);
                        if (!bodyText.includes("did not match any documents")) {
                            // Maybe blocked or just empty
                        }
                    } else {
                        // Deep Scan
                        const items = await page!.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd, div.C8TUKc');
                        console.log(`      📍 Maps found ${items.length} candidates. Scanning...`);

                        const gResults: any[] = [];
                        for (const item of items) {
                            try {
                                await item.click();
                                try {
                                    await page!.waitForFunction(
                                        () => document.querySelector('div[role="complementary"]') || document.querySelector('.xpdopen'),
                                        { timeout: 2000 }
                                    );
                                } catch { }

                                const details = await page!.evaluate(() => {
                                    const side = document.querySelector('div[role="complementary"]') || document.querySelector('.xpdopen') || document.body;
                                    const title = (side.querySelector('h2') as HTMLElement)?.innerText || '';

                                    const webLink = Array.from(side.querySelectorAll('a[href^="http"]')).find(a =>
                                        !(a as HTMLAnchorElement).href.includes('google') &&
                                        ((a as HTMLElement).innerText.toLowerCase().includes('sito') || (a as HTMLElement).innerText.toLowerCase().includes('web'))
                                    );

                                    const phoneDiv = Array.from(side.querySelectorAll('button, div, a')).find(el => {
                                        const txt = el.getAttribute('aria-label') || (el as HTMLElement).innerText || '';
                                        return txt.match(/(\+\d{2})?\s?\d{2,4}\s\d{4,}/);
                                    });
                                    const phone = phoneDiv ? (phoneDiv.getAttribute('aria-label') || (phoneDiv as HTMLElement).innerText).replace(/[^\d+]/g, '') : '';

                                    // capture address from side panel if possible
                                    const addrDiv = Array.from(side.querySelectorAll('button, div, span')).find(el => {
                                        const t = (el as HTMLElement).innerText || '';
                                        return t.includes(',') && /\d{5}/.test(t); // simplistic zip check
                                    });
                                    const address = addrDiv ? (addrDiv as HTMLElement).innerText : '';

                                    return {
                                        title,
                                        website: webLink ? webLink.getAttribute('href') : '',
                                        phone,
                                        address
                                    };
                                });

                                if (details.title) {
                                    const clean = (s: string) => s.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                                    const cleanName = clean(details.title);
                                    const uniqueKey = `${cleanName}_${city}`.toLowerCase();

                                    if (!seen.has(uniqueKey) && cleanName.length > 2) {
                                        seen.add(uniqueKey);
                                        gResults.push({
                                            company_name: cleanName,
                                            city: city,
                                            province: '',
                                            address: details.address ? clean(details.address) : `${city}, Italy`,
                                            phone: clean(details.phone),
                                            website: details.website,
                                            category: keyword,
                                            source: 'GoogleMaps_Deep',
                                            google_url: page!.url(),
                                            description: ''
                                        });
                                    }
                                }
                                await delay(200 + Math.random() * 600);
                            } catch (e) { }
                        }

                        if (gResults.length > 0) {
                            await csvWriter.writeRecords(gResults);
                            totalFound += gResults.length;
                            console.log(`      ✅ Saved ${gResults.length} Maps leads.`);
                        }
                    }

                } catch (e) {
                    console.log(`   ⚠️ Google Error: ${(e as Error).message}`);
                }

                await delay(1000);
            }
        }

    } catch (e) {
        console.error("🔥 FATAL ERROR:", e);
    } finally {
        if (page) await page.close();
        await browserFactory.close();
        console.log(`\n✨ CAMPAIGN FINISHED. Total Unique Leads: ${totalFound}`);
    }
}

main();
