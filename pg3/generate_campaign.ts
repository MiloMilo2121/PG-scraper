
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
        if (!page) throw new Error('Failed to create page');

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'media'].includes(req.resourceType())) {
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

                // Anti-rate-limit: Wait 2s between keyword searches (Local is safer)
                await delay(2000);


                // --- SIMPLIFIED: Just search the main city (cluster logic removed for now) ---
                let targetLocations = [city];



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
                                console.log(`      🔗 PG URL: ${pgUrl}`);
                                await page!.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                            });

                            const hasItems = await page!.$('.search-itm');
                            if (!hasItems) {
                                break;
                            }

                            const pgResults = await page!.evaluate((cityName, keyW) => {
                                const clean = (s: string | null | undefined) => {
                                    if (!s) return '';
                                    return s.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                                };

                                return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                                    const name = clean(item.querySelector('.search-itm__rag')?.textContent);
                                    const address = clean(item.querySelector('.search-itm__adr')?.textContent);
                                    const phone = clean(item.querySelector('.search-itm__phone')?.textContent);

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

                            if (pgResults && pgResults.length > 0) {
                                console.log(`      📄 PG Page ${pageNum}: found ${pgResults.length}`);
                                for (const c of pgResults) {
                                    if (c) {
                                        const existing = deduplicator.checkDuplicate(c as any);
                                        if (!existing) {
                                            deduplicator.add(c as any);
                                            cityCompanies.push(c as any);
                                            totalFound++;
                                        }
                                    }
                                }
                            }

                            const nextExists = await page!.$('.search-pagi__next');
                            if (nextExists) {
                                pageNum++;
                                await delay(1500);
                            } else {
                                hasNext = false;
                            }
                        }
                    } catch (e) {
                        console.log(`   ⚠️ PG Error in ${location}: ${(e as Error).message}`);
                        logError(`PG Scraping - ${location}`, (e as Error).message);
                    }

                    // --- SOURCE 2: GOOGLE MAPS (US Bypass Mode) ---
                    try {
                        const mapsUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword + ' ' + location)}&tbm=lcl&hl=en&gl=us`;

                        await retry(async () => {
                            await page!.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await smashCookies(page!);
                        });

                        const items = await page!.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd, .C8TUKc');

                        if (items.length > 0) {
                            console.log(`      📍 Maps found ${items.length} candidates for ${location}. Scanning...`);

                            for (const item of items) {
                                try {
                                    const basicName = await item.evaluate(el => el.textContent?.split('\n')[0].trim() || 'Unknown');
                                    await item.click();
                                    await delay(1000);

                                    const details = await page!.evaluate(() => {
                                        const side = document.querySelector('div[role="complementary"]');
                                        if (!side) return null;
                                        const title = side.querySelector('h2')?.textContent?.trim() || '';
                                        const webBtn = Array.from(side.querySelectorAll('a')).find(a =>
                                            a.textContent?.toLowerCase().includes('website') || a.getAttribute('aria-label')?.toLowerCase().includes('website')
                                        );
                                        let website = webBtn?.getAttribute('href') || '';
                                        const phoneBtn = side.querySelector('button[data-item-id="phone"]');
                                        const phone = phoneBtn?.getAttribute('aria-label')?.replace('Call ', '') || '';
                                        const addrBtn = side.querySelector('button[data-item-id="address"]');
                                        const address = addrBtn?.textContent?.trim() || '';
                                        return { company_name: title, website, phone, address };
                                    });

                                    if (details && details.company_name) {
                                        const existing = deduplicator.checkDuplicate(details as any);
                                        if (existing) {
                                            if (details.website && !existing.website) existing.website = details.website;
                                            if (details.phone && !existing.phone) existing.phone = details.phone;
                                            existing.source = 'Hybrid (PG+Maps)';
                                        } else {
                                            const comp = {
                                                ...details,
                                                city: city,
                                                query_location: location,
                                                category: keyword,
                                                source: 'Maps_Only'
                                            };
                                            deduplicator.add(comp as any);
                                            cityCompanies.push(comp as any);
                                            totalFound++;
                                        }
                                    }
                                } catch (e) { }
                            }
                        }
                    } catch (e) {
                        console.log(`   ⚠️ Google Error in ${location}: ${(e as Error).message}`);
                    }


                    // Slow down slightly between locations
                    await delay(1000);


                } // End Location Loop
            } // End Keyword Loop


            // --- BATCH WRITE AT END OF CITY ---
            if (cityCompanies.length > 0) {
                // console.log(`\n☢️  STARTING NUCLEAR ENRICHMENT for ${cityCompanies.length} companies...`);

                // Nuclear Enrichment Loop (Bypassed for meeting speed)
                /*
                for (const comp of cityCompanies) {
                    await enrichCompany(comp, page!);
                }
                */



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
