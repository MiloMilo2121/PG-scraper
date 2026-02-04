
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './src/core/browser/factory_v2';
import { Page } from 'puppeteer';
import { SmartDeduplicator } from './src/core/discovery/smart_deduplicator';
import { CompanyInput } from './src/core/company_types';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- CONFIGURATION ---
const MAX_PAGES_PG = 5; // How many pages of PG to scrape per keyword
const RETRY_ATTEMPTS = 3;
const OUTPUT_DIR = 'output/campaigns';
const LOG_DIR = 'logs'; // Task 14
const RESULTS_LIMIT_TRIGGER = 180; // Trigger cluster search if results > this

// Ensure output and log dirs exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// "GLI ALTRI MODI PER DIRLO" - Focused Keyword Set
const TERMS = {
    MECCATRONICA: ["meccatronica", "automazione industriale", "robotica", "costruzioni meccaniche"],
    MECCANICA: ["officina meccanica", "torneria", "fresatura", "lavorazioni meccaniche di precisione", "carpenteria metallica"],
    ELETTRONICA: ["elettronica industriale", "componenti elettronici", "schede elettroniche", "progettazione elettronica"],
    IMPIANTI: ["impianti", "impiantistica industriale", "impianti macchine automatiche", "mangimifici", "impianti zootecnici", "linee di produzione automatizzate", "manutenzione macchine automatiche"],
    ELETTRICO: ["materiale elettrico", "quadri elettrici industriali", "cablaggio quadri", "impianti elettrici industriali"],
    INFORMATICO: ["software house", "sviluppo software gestionale", "consulenza informatica", "sistemi integrati", "iot industriale"]
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

// Cluster Expansion Strategy (Provincial Big Hitters)
const TARGET_CLUSTERS: Record<string, string[]> = {
    "Verona": ["Villafranca di Verona", "Legnago", "San Giovanni Lupatoto", "San Bonifacio", "Bussolengo", "Sona", "Pescantina", "Negrar", "Cerea", "Bovolone"],
    "Padova": ["Albignasego", "Selvazzano Dentro", "Vigonza", "Cittadella", "Abano Terme", "Piove di Sacco", "Monselice", "Este", "Cadoneghe", "Rubano"],
    "Brescia": ["Desenzano del Garda", "Montichiari", "Lumezzane", "Palazzolo sull'Oglio", "Rovato", "Ghedi", "Chiari", "Gussago", "Lonato del Garda", "Darfo Boario Terme"],
    "Mantova": ["Castiglione delle Stiviere", "Suzzara", "Viadana", "Porto Mantovano", "Curtatone", "Borgo Virgilio", "Castel Goffredo", "Goito", "Asola", "Gonzaga"],
    "Vicenza": ["Bassano del Grappa", "Schio", "Valdagno", "Arzignano", "Thiene", "Montecchio Maggiore", "Lonigo", "Malo", "Cassola", "Rosà"]
};

// --- LOGGING HELPERS (Task 14) ---
function logError(context: string, error: string) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${context}] ERROR: ${error}\n`;
    fs.appendFileSync(path.join(LOG_DIR, 'scraping_errors.log'), logLine);
}

function logSuccess(company: CompanyInput) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [SUCCESS] Found: ${company.company_name} | City: ${company.city} | Source: ${company.source} | Rev: ${company.revenue || 'N/A'}\n`;
    fs.appendFileSync(path.join(LOG_DIR, 'leads_found.log'), logLine);
}

// --- HELPERS ---
async function smashCookies(page: Page) {
    try {
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const accept = btns.find(b =>
                b.textContent?.toLowerCase().includes('accetta') ||
                b.textContent?.toLowerCase().includes('accept') ||
                b.textContent?.toLowerCase().includes('acconsento') ||
                b.textContent?.toLowerCase().includes('agree')
            );
            if (accept) {
                // console.log('   🍪 Smashing Cookies...');
                (accept as HTMLElement).click();
            }
        });
        await delay(500);
    } catch { }
}

async function enrichCompany(company: CompanyInput, page: Page) {
    console.log(`         ☢️  Enriching: ${company.company_name}...`);

    // 1. Satellite Vision (Instant)
    const qAddr = encodeURIComponent(company.address || company.city || '');
    company.satellite_url = `https://www.google.com/maps/search/?api=1&query=${qAddr}&layers=s`;

    // 2. Social Fallback (If website is missing)
    if (!company.website || company.website.length < 5) {
        try {
            const q = `site:facebook.com OR site:linkedin.com ${company.company_name} ${company.city}`;
            const searchUrl = `https://www.google.it/search?q=${encodeURIComponent(q)}&gl=it&hl=it`;

            await retry(async () => {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
                await smashCookies(page);
            });

            const links = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('div.yuRUbf a, .MjjYud a')).map(a => a.getAttribute('href')).filter(h => h && (h.includes('facebook.com') || h.includes('linkedin.com')));
            });

            if (links.length > 0) {
                const fb = links.find(l => l?.includes('facebook.com'));
                const li = links.find(l => l?.includes('linkedin.com'));
                if (fb) company.social_facebook = fb;
                if (li) company.social_linkedin = li;
                // Heuristic: Set website to social if found
                if (!company.website) company.website = fb || li || undefined;
                console.log(`            Found Social: ${fb || li}`);
            }
        } catch (e) { console.log(`            ⚠️ Social Error: ${(e as Error).message}`); }
    }

    // 3. Financial Enrichment (Revenue & Employees via ReportAziende)
    try {
        const q = `site:reportaziende.it ${company.company_name} ${company.city}`;
        const searchUrl = `https://www.google.it/search?q=${encodeURIComponent(q)}&gl=it&hl=it`;

        await retry(async () => {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            await smashCookies(page);
        });

        const reportLink = await page.evaluate(() => {
            const el = document.querySelector('div.yuRUbf a, .MjjYud a');
            return el ? el.getAttribute('href') : null;
        });

        if (reportLink) {
            await retry(async () => {
                await page.goto(reportLink, { waitUntil: 'domcontentloaded' });
            });

            const financials = await page.evaluate(() => {
                const text = document.body.innerText;
                const revMatch = text.match(/Fatturato\s*([0-9\.]+)\s*€/i) || text.match(/Fatturato\s*20\d\d\s*:\s*([0-9\.]+)\s*€/i);
                const empMatch = text.match(/Dipendenti\s*:\s*(\d+)/i) || text.match(/Dipendenti\s*\(20\d\d\)\s*:\s*(\d+)/i);
                return {
                    revenue: revMatch ? revMatch[1] : undefined,
                    employees: empMatch ? empMatch[1] : undefined
                };
            });

            if (financials.revenue) {
                company.revenue = financials.revenue;
                company.revenue_year = "2023"; // Assumption or extract
                console.log(`            💰 Revenue: €${company.revenue}`);
            }
            if (financials.employees) {
                company.employees = financials.employees;
                console.log(`            👥 Employees: ${company.employees}`);
            }
        }
    } catch (e) { /* console.log(`            ⚠️ Financial Error: ${(e as Error).message}`); */ }

    await delay(1000); // Respect rates
}

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
            console.log(`\n🏙️  PROCESSING MAIN CITY: ${city}`);

            // --- CITY CONTEXT ---
            const cityCompanies: CompanyInput[] = [];
            const deduplicator = new SmartDeduplicator();

            // Output Separation: File per city
            const timestamp = new Date().toISOString().split('T')[0];
            const cityFile = path.join(OUTPUT_DIR, `campaign_${city.toLowerCase()}_${timestamp}.csv`);
            const csvWriter = createObjectCsvWriter({
                path: cityFile,
                header: [
                    { id: 'company_name', title: 'company_name' },
                    { id: 'city', title: 'city' },
                    { id: 'query_location', title: 'query_location' }, // New field to track where we searched
                    { id: 'province', title: 'province' },
                    { id: 'address', title: 'address' },
                    { id: 'phone', title: 'phone' },
                    { id: 'website', title: 'website' },
                    { id: 'category', title: 'category' },
                    { id: 'source', title: 'source' },
                    { id: 'google_cid', title: 'google_cid' },
                    { id: 'google_url', title: 'google_url' },
                    { id: 'revenue', title: 'revenue' },
                    { id: 'employees', title: 'employees' },
                    { id: 'satellite_url', title: 'satellite_url' },
                    { id: 'social_facebook', title: 'social_facebook' },
                    { id: 'social_linkedin', title: 'social_linkedin' }
                ],
                append: false // Batch write at end
            });

            for (const keyword of KEYWORDS) {
                console.log(`   🔎 Searching: "${keyword}"...`);

                // --- CLUSTER LOGIC CHECK ---
                // Default: Just search the main city
                let targetLocations = [city];

                try {
                    // Check Result Count on Main City Page 1
                    const qKey = keyword.replace(/ /g, '%20');
                    const qCity = city.replace(/ /g, '%20');
                    const checkUrl = `https://www.paginegialle.it/ricerca/${qKey}/${qCity}`;

                    await retry(async () => {
                        await page!.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                        await smashCookies(page!);
                    });

                    // Parse "Trovati X risultati" or "Più di 200 risultati"
                    // HTML structure often has a listing-header or similar. 
                    // Let's grab the broad text or specific counting element.
                    const resultCountText = await page!.evaluate(() => {
                        // Try specific selector first
                        const countEl = document.querySelector('.searchListElenco h1') || document.querySelector('.listing-summary');
                        if (countEl) return countEl.textContent?.toLowerCase() || '';
                        return document.body.innerText.split('\n').find(l => l.includes('risultati') || l.includes('aziende'))?.toLowerCase() || '';
                    });

                    let estimatedResults = 0;
                    let isOverflow = false;

                    if (resultCountText.includes('più di') || resultCountText.includes('oltre')) {
                        isOverflow = true;
                        estimatedResults = 999;
                    } else {
                        const match = resultCountText.match(/(\d+)/);
                        if (match) estimatedResults = parseInt(match[1], 10);
                    }

                    console.log(`      📊 PG Count Analysis: "${resultCountText.trim().substring(0, 50)}..." -> ${estimatedResults} results`);

                    if (estimatedResults > RESULTS_LIMIT_TRIGGER || isOverflow) {
                        console.log(`      ⚠️ TRIGGER: Muro dei 200 rilevato! (${estimatedResults} > ${RESULTS_LIMIT_TRIGGER}). expanding to CLUSTERS.`);
                        const clusters = TARGET_CLUSTERS[city] || [];
                        targetLocations = [city, ...clusters]; // Keep main city, add clusters
                        console.log(`      🌍 Target Layout: ${city} + [${clusters.join(', ')}]`);
                    }

                } catch (e) {
                    console.error(`      ⚠️ Error checking count, defaulting to single city: ${(e as Error).message}`);
                    logError(`PG Count Check - ${city}`, (e as Error).message);
                }

                // --- EXECUTE SEARCH ON TARGET LOCATIONS ---
                for (const location of targetLocations) {
                    const isCluster = location !== city;
                    if (isCluster) console.log(`      📍 Clustering: Checking sub-zone "${location}"...`);

                    // --- SOURCE 1: PAGINE GIALLE (With Pagination) ---
                    try {
                        let pageNum = 1;
                        let hasNext = true;

                        while (hasNext && pageNum <= MAX_PAGES_PG) {
                            const qKey = keyword.replace(/ /g, '%20');
                            const qLoc = location.replace(/ /g, '%20');
                            const pgUrl = `https://www.paginegialle.it/ricerca/${qKey}/${qLoc}/p-${pageNum}`;

                            await retry(async () => {
                                await page!.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                                await smashCookies(page!);
                            });

                            // Selector check
                            const hasItems = await page!.$('.search-itm');
                            if (!hasItems) {
                                if (pageNum === 1) {
                                    // inside loop, expected if small town
                                }
                                break;
                            }

                            const pgResults = await page!.evaluate((cityName, keyW, queryLoc) => {
                                return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                                    const name = item.querySelector('.search-itm__rag')?.textContent?.trim() || '';
                                    const address = item.querySelector('.search-itm__adr')?.textContent?.trim() || '';
                                    const phone = item.querySelector('.search-itm__phone')?.textContent?.trim() || '';

                                    // Website Extraction
                                    const webElem = item.querySelector('.search-itm__url') || item.querySelector('a[href^="http"]:not([href*="paginegialle.it"])');
                                    const website = webElem ? webElem.getAttribute('href') : '';

                                    return name ? {
                                        company_name: name,
                                        city: cityName, // Main "Campaign City"
                                        query_location: queryLoc, // Specific search location
                                        address: address,
                                        phone: phone,
                                        website: website || undefined,
                                        category: keyW,
                                        source: 'PG'
                                    } : null;
                                }).filter(x => x);
                            }, city, keyword, location);

                            if (pgResults.length > 0) {
                                console.log(`      📄 ${location} PG Page ${pageNum}: found ${pgResults.length}`);

                                for (const c of pgResults) {
                                    // PG Deduplication: If exists, ignore (PG is usually reliable, duplicates are unlikely to be better)
                                    if (c && !deduplicator.checkDuplicate(c)) {
                                        deduplicator.add(c);
                                        cityCompanies.push(c);
                                        totalFound++;
                                    }
                                }
                                // No immediate write
                            } else {
                                hasNext = false;
                            }

                            pageNum++;
                            await delay(1000);
                        }
                    } catch (e) {
                        console.log(`   ⚠️ PG Error in ${location}: ${(e as Error).message}`);
                        logError(`PG Scraping - ${location}`, (e as Error).message);
                    }

                    // --- SOURCE 2: GOOGLE MAPS (Local Pack / SERP) ---
                    // Executed for EACH location (Main City OR Cluster Municipality)
                    try {
                        // Use 'location' (e.g. "Villafranca di Verona") instead of generic 'city'
                        const gUrl = `https://www.google.it/search?q=${encodeURIComponent(keyword + ' ' + location)}&gl=it&hl=it`;
                        await retry(async () => {
                            await page!.goto(gUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                            await smashCookies(page!);
                        });

                        // --- DEEP SCRAPING (Click & Extract) ---
                        let items = await page!.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd');

                        // TASK 4: DEEP SEARCH RECOVERY
                        if (items.length === 0) {
                            console.log(`      ⚠️ [Maps] Zero results for "${location}". Triggering Provincial Recovery...`);
                            const recoveryUrl = `https://www.google.it/search?q=${encodeURIComponent(keyword + ' Provincia di ' + city)}&gl=it&hl=it`;

                            await retry(async () => {
                                await page!.goto(recoveryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                                await smashCookies(page!);
                            });

                            items = await page!.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd');
                            if (items.length > 0) console.log(`      🔄 Recovery found: ${items.length} items (Regional fallback)`);
                        }

                        const gResults: any[] = [];

                        if (items.length > 0) {
                            console.log(`      📍 [Maps] ${location}: Found ${items.length} candidates. Deep scanning...`);
                        }

                        for (const item of items) {
                            try {
                                // 1. Get Basic Name first
                                const basicName = await item.evaluate(el => el.textContent?.split('\n')[0].trim() || 'Unknown');

                                // 2. Click to open side panel
                                await item.click();
                                try {
                                    await page!.waitForSelector('div[role="complementary"]', { timeout: 3000 });
                                } catch (e) { }

                                // 3. Extract from Side Panel
                                const details = await page!.evaluate(() => {
                                    const side = document.querySelector('div[role="complementary"]');
                                    if (!side) return null;

                                    const title = side.querySelector('h2')?.textContent?.trim() || '';

                                    // Website
                                    const webBtn = Array.from(side.querySelectorAll('a')).find(a =>
                                        a.textContent?.toLowerCase().includes('sito') ||
                                        a.textContent?.toLowerCase().includes('website') ||
                                        a.getAttribute('aria-label')?.toLowerCase().includes('sito')
                                    );
                                    let website = webBtn?.getAttribute('href') || '';
                                    if (website.includes('/url?q=')) website = website.split('/url?q=')[1].split('&')[0];
                                    website = decodeURIComponent(website);

                                    // Phone
                                    let phone = '';
                                    const phoneBtn = Array.from(side.querySelectorAll('button[data-tooltip*="Chiama"], button[aria-label*="Call"], button[data-item-id="phone"]')).find(x => x);
                                    if (phoneBtn) {
                                        phone = phoneBtn.getAttribute('aria-label') || phoneBtn.getAttribute('data-item-id') || '';
                                    }
                                    if (!phone || phone.length < 5) {
                                        const text = (side as HTMLElement).innerText || '';
                                        const match = text.match(/((\+|00)39)?\s?0\d{1,4}[\s-]?\d{4,10}/);
                                        if (match) phone = match[0];
                                    }
                                    phone = phone.replace(/[^0-9+ ]/g, '').trim();

                                    // Address
                                    const addrBtn = Array.from(side.querySelectorAll('button[data-item-id="address"]')).find(x => x);
                                    const address = addrBtn?.textContent?.trim() || '';

                                    return { company_name: title, website, phone, address };
                                });

                                if (details && details.company_name) {
                                    //  console.log(`         ✅ Deep Matched: ${details.company_name}`);
                                    gResults.push({
                                        company_name: details.company_name,
                                        city: city, // Main City Context
                                        query_location: location, // Specific Municipality Scraped
                                        address: details.address,
                                        phone: details.phone,
                                        website: details.website || undefined,
                                        category: keyword,
                                        source: 'GoogleMaps_Deep'
                                    });
                                } else {
                                    gResults.push({
                                        company_name: basicName,
                                        city: city,
                                        query_location: location,
                                        category: keyword,
                                        source: 'Google_Shallow',
                                        website: undefined
                                    });
                                }

                                await delay(300 + Math.random() * 500);

                            } catch (e) { }
                        }

                        // Process Google Results with Highlander Logic

                        // Note: We don't filter simple names here because deduplicator is smart enough?
                        // Actually, we should still filter 'paginegialle' junk.

                        const cleanGResults = gResults.filter(c => {
                            const n = c.company_name.toLowerCase();
                            return !n.includes('paginegialle') && !n.includes('risultati') && n.length < 60;
                        });

                        if (cleanGResults.length > 0) {
                            console.log(`      🗺️  [Maps] ${location}: found ${cleanGResults.length} unique items`);

                            for (const c of cleanGResults) {
                                // --- THE HIGHLANDER MERGE ---
                                const existing = deduplicator.checkDuplicate(c);

                                if (existing) {
                                    console.log(`         🔄 Merging info for: ${existing.company_name}`);
                                    // Highlander Logic: Maps enriches Website & Phone
                                    if (c.website && !existing.website) existing.website = c.website;
                                    if (c.phone && !existing.phone) existing.phone = c.phone;
                                    existing.source = 'Hybrid (PG+Maps)'; // Mark as enriched
                                } else {
                                    // New Company found by Maps
                                    c.source = 'Maps_Only';
                                    deduplicator.add(c);
                                    cityCompanies.push(c);
                                    totalFound++;
                                }
                            }
                        }

                    } catch (e) {
                        console.log(`   ⚠️ Google Error in ${location}: ${(e as Error).message}`);
                        logError(`Maps Scrape - ${location}`, (e as Error).message);
                    }

                    // Slow down slightly between locations
                    await delay(500);

                } // End Location Loop
            } // End Keyword Loop

            // --- BATCH WRITE AT END OF CITY ---
            if (cityCompanies.length > 0) {
                console.log(`\n☢️  STARTING NUCLEAR ENRICHMENT for ${cityCompanies.length} companies...`);

                // Nuclear Enrichment Loop
                for (const comp of cityCompanies) {
                    await enrichCompany(comp, page!);
                }

                console.log(`\n💾 Saving ${cityCompanies.length} unique companies for ${city}...`);
                await csvWriter.writeRecords(cityCompanies);

                // Log Success for each saved company
                cityCompanies.forEach(c => logSuccess(c));

            } else {
                console.log(`\n⚠️ No companies found for ${city}.`);
            }

        } // End City Loop

    } catch (e) {
        console.error("Critical Error", e);
        logError("Main Process", (e as Error).message);
    } finally {
        if (page) await browserFactory.closePage(page);
        await browserFactory.close();
    }

    console.log(`\n✨ BOMBA FINISHED! Generated campaigns in ${OUTPUT_DIR}. Total unique: ${totalFound}`);
}

main();
