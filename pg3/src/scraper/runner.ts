
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './core/browser/factory_v2';
import { Page } from 'playwright';
import { Deduplicator } from './utils/deduplicator';
import { CompanyInput } from './types';
import { GoogleMapsProvider } from './providers/maps';
import { Logger } from './utils/logger';
import { CookieConsent } from './core/browser/cookie_consent';
import { EnvValidator } from './utils/env_validator';

// --- CONFIGURATION ---
const MAX_PAGES_PG = 5;
const RETRY_ATTEMPTS = 3;
const OUTPUT_DIR = 'output/campaigns';

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// --- CLUSTERS ---
// Each key is the PG search term (= province capital).
// The array is the satellite municipality list activated when PG returns >200 results.
// Municipalities are ordered roughly by population to maximise early yield.
const TARGET_CLUSTERS: Record<string, string[]> = {

    // ── VENETO ─────────────────────────────────────────────────────────────
    "Verona": [
        "Verona",
        "Villafranca di Verona", "San Giovanni Lupatoto", "Bussolengo",
        "Negrar di Valpolicella", "Pescantina", "Grezzana",
        "San Martino Buon Albergo", "Zevio", "Caldiero",
        "San Bonifacio", "Soave", "Cologna Veneta",
        "Legnago", "Isola della Scala", "Vigasio",
        "Castel d'Azzano", "Peschiera del Garda",
        "Bardolino", "Lazise", "Garda",
        "Valeggio sul Mincio", "Mozzecane"
    ],
    "Venezia": [
        "Venezia",
        "Mestre", "Marghera", "Spinea", "Mirano",
        "Dolo", "Mira", "Noale", "Vigonovo", "Pianiga",
        "Marcon", "Quarto d'Altino",
        "Chioggia", "Cavarzere",
        "San Donà di Piave", "Musile di Piave", "Eraclea",
        "Jesolo", "Caorle",
        "Portogruaro", "San Michele al Tagliamento", "Gruaro"
    ],
    "Padova": [
        "Padova",
        "Albignasego", "Selvazzano Dentro", "Vigonza",
        "Rubano", "Cadoneghe", "Limena", "Saonara",
        "Noventa Padovana", "Ponte San Nicolò",
        "Cittadella", "Camposampiero", "Piazzola sul Brenta",
        "Abano Terme", "Montegrotto Terme",
        "Monselice", "Este", "Conselve", "Montagnana"
    ],
    "Vicenza": [
        "Vicenza",
        "Bassano del Grappa", "Schio", "Thiene",
        "Arzignano", "Montecchio Maggiore", "Valdagno",
        "Lonigo", "Noventa Vicentina",
        "Marostica", "Sandrigo",
        "Brendola", "Montorso Vicentino",
        "Asiago", "Gallio"
    ],
    "Treviso": [
        "Treviso",
        "Villorba", "Silea", "Paese", "Preganziol",
        "Quinto di Treviso", "Ponzano Veneto", "Mogliano Veneto",
        "Roncade", "Carbonera", "Casier",
        "Spresiano", "Arcade", "San Biagio di Callalta",
        "Ponte di Piave", "Oderzo",
        "Conegliano", "Susegana",
        "Pieve di Soligo", "Vittorio Veneto",
        "Nervesa della Battaglia", "Giavera del Montello",
        "Montebelluna", "Asolo", "Crocetta del Montello",
        "Valdobbiadene", "Castelfranco Veneto"
    ],
    "Rovigo": [
        "Rovigo",
        "Adria", "Badia Polesine", "Lendinara",
        "Occhiobello", "Porto Viro", "Villadose",
        "Castelmassa", "Ariano nel Polesine",
        "Ficarolo", "Pontecchio Polesine"
    ],
    "Belluno": [
        "Belluno",
        "Feltre", "Sedico", "Ponte nelle Alpi",
        "Pieve di Cadore", "Agordo", "Mel",
        "Longarone", "Cortina d'Ampezzo"
    ],

    // ── EXTRA (kept for backward-compat) ──────────────────────────────────
    "Brescia": [
        "Brescia", "Desenzano del Garda", "Montichiari",
        "Lumezzane", "Palazzolo sull'Oglio", "Rovato", "Ghedi"
    ],
    "Mantova": ["Mantova", "Castiglione delle Stiviere", "Suzzara", "Viadana"],
};

// --- DEFAULT ARGS ---
const args = process.argv.slice(2);
// --category accepts a single value or comma-separated list: --category="a,b,c"
const categoryArg = args.find(a => a.startsWith('--category='))?.split('=')[1];
const specificCategories = categoryArg
    ? categoryArg.split(',').map(s => s.trim()).filter(Boolean)
    : null;
const specificCity = args.find(a => a.startsWith('--city='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const COMPANY_LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

// Helpers
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retry<T>(fn: () => Promise<T>, retries = RETRY_ATTEMPTS): Promise<T | null> {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) {
            if (i === retries - 1) return null;
            await delay(2000 * (i + 1));
        }
    }
    return null;
}

async function main() {
    Logger.info(`🚀 UNIFIED CAMPAIGN GENERATOR v4.1 (Robust)`);

    // 0. Safety Check
    try { EnvValidator.validate(); }
    catch (e) { Logger.error('Environment Error', (e as Error).message); process.exit(1); }

    // 1. Determine Scope
    const citiesToScan = specificCity ? [specificCity] : Object.keys(TARGET_CLUSTERS);
    const keywords = specificCategories ?? ["centro estetico", "epilazione laser", "beauty center"];

    Logger.info(`🎯 Scope: ${citiesToScan.join(', ')} | Keywords: ${keywords.join(', ')}`);
    if (COMPANY_LIMIT !== Infinity) {
        Logger.info(`🛑 Limit set: Will stop at ${COMPANY_LIMIT} companies`);
    }

    const browserFactory = BrowserFactory.getInstance();
    const page = await browserFactory.newPage();

    let totalGlobalFound = 0;

    try {
        for (const city of citiesToScan) {
            Logger.info(`\n🏙️  PROCESSING HUB: ${city}`);

            const cityCompanies: CompanyInput[] = [];
            const deduplicator = new Deduplicator();

            // Setup CSV
            const timestamp = new Date().toISOString().split('T')[0];
            const categorySlug = keywords.join('-').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const cityFile = path.join(OUTPUT_DIR, `campaign_${city.toLowerCase()}_${categorySlug}_${timestamp}.csv`);
            const csvWriter = createObjectCsvWriter({
                path: cityFile,
                header: [
                    { id: 'company_name', title: 'company_name' },
                    { id: 'city', title: 'city' },
                    { id: 'province', title: 'province' },
                    { id: 'zip_code', title: 'zip_code' },
                    { id: 'region', title: 'region' },
                    { id: 'address', title: 'address' },
                    { id: 'phone', title: 'phone' },
                    { id: 'website', title: 'website' },
                    { id: 'category', title: 'category' },
                    { id: 'source', title: 'source' },
                    { id: 'vat_code', title: 'vat_code' },
                    { id: 'pg_url', title: 'pg_url' }
                ]
            });

            for (const keyword of keywords) {
                Logger.info(`   🔎 Keyword: "${keyword}"`);

                // 2. THE BARRIER CHECK (PagineGialle Total Results)
                let useCluster = false;
                const pgUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(keyword)}/${encodeURIComponent(city)}`;

                await page.goto(pgUrl, { waitUntil: 'domcontentloaded' });
                await CookieConsent.handle(page); // 🍪 Smash cookies

                // Wait for PG to render results — .search-itm is the reliable React-rendered element.
                // Once listings are in the DOM, the count text is also rendered.
                await page.waitForSelector('.search-itm', { timeout: 12000 }).catch(() => {});

                // Parse Total Count — PG shows "più di 200 risultati" or "1.247 risultati"
                const countText = await page.evaluate(() => {
                    const selectors = [
                        '.listing-res__numresults span',
                        '.listing-res__numresults',
                        '.search-ind__res',
                        '[class*="numresults"]',
                        '[class*="num-results"]',
                    ];
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        const txt = el?.textContent?.trim() || '';
                        // Only trust elements that actually contain a digit or "più di"
                        if (txt && (/\d/.test(txt) || /pi[uù]\s+di/i.test(txt))) return txt;
                    }
                    const body = document.body.innerText;
                    // Preserve "più di X risultati" so the caller can parse it correctly.
                    const piuMatch = body.match(/pi[uù]\s+di\s+[\d.]+\s*risultat[^\n]*/i);
                    if (piuMatch) return piuMatch[0];
                    // Plain number: "1.247 risultati"
                    const numMatch = body.match(/\d[\d.]*\s+risultat/i);
                    if (numMatch) return numMatch[0];
                    return '0';
                });
                // Handle both "1.247 risultati" and "più di 200 risultati"
                const piuDiMatch = countText.match(/pi[uù]\s+di\s+([\d.]+)/i);
                const totalResults = piuDiMatch
                    ? parseInt(piuDiMatch[1].replace(/\./g, ''), 10) + 1
                    : parseInt(countText.replace(/\./g, ''), 10) || 0;
                Logger.info(`      📊 PG Total Results: ${totalResults} (raw: "${countText}")`);

                const cluster = TARGET_CLUSTERS[city];
                if (totalResults > 200) {
                    useCluster = true;
                    Logger.info(`      🚀 HIGH VOLUME DETECTED (>200). ACTIVATING CLUSTER STRATEGY.`);
                } else {
                    Logger.info(`      📉 Low volume (${totalResults}). Scanned only main city.`);
                }

                // Define Locations based on Cluster Decision
                const needMoreThanCity =
                    COMPANY_LIMIT !== Infinity &&
                    Number.isFinite(COMPANY_LIMIT) &&
                    COMPANY_LIMIT > totalResults &&
                    !!cluster;
                const locations = (useCluster || needMoreThanCity) && cluster ? cluster : [city];

                // 3. EXECUTE SEARCH
                for (const loc of locations) {
                    Logger.info(`      📍 Scanning Location: ${loc}`);

                    // --- SOURCE A: PAGINE GIALLE ---
                    totalGlobalFound = await scrapePG(page, keyword, loc, deduplicator, cityCompanies, totalGlobalFound, COMPANY_LIMIT);

                    // Check limit after PG
                    if (totalGlobalFound >= COMPANY_LIMIT) {
                        Logger.info(`🛑 LIMIT REACHED after PG: ${totalGlobalFound} companies. Stopping.`);
                        break;
                    }

                    // --- SOURCE B: GOOGLE MAPS (Deep Fill) ---
                    try {
                        const mapsResults = await GoogleMapsProvider.fetchDeepResults(page, loc, keyword);

                        for (const mRes of mapsResults) {
                            if (totalGlobalFound >= COMPANY_LIMIT) break; // LIMIT CHECK

                            try {
                                const existing = deduplicator.checkDuplicate(mRes);
                                if (existing) {
                                    deduplicator.merge(existing, mRes);
                                    Logger.info(`      ✨ Merged Maps data for: ${existing.company_name}`);
                                } else {
                                    deduplicator.add(mRes);
                                    cityCompanies.push(mRes);
                                    totalGlobalFound++;
                                }
                            } catch (itemErr) {
                                Logger.warn(`      [Maps] Skipping entry "${mRes.company_name}": ${(itemErr as Error).message}`);
                            }
                        }
                    } catch (mapsErr) {
                        Logger.warn(`      [Maps] Failed for ${loc}: ${(mapsErr as Error).message} — PG data preserved`);
                    }

                    // Early exit if limit reached
                    if (totalGlobalFound >= COMPANY_LIMIT) {
                        Logger.info(`🛑 LIMIT REACHED: ${totalGlobalFound} companies. Stopping.`);
                        break;
                    }
                }
            }

            // Save City Batch
            if (cityCompanies.length > 0) {
                Logger.info(`\n💾 Saving ${cityCompanies.length} companies for ${city}...`);
                await csvWriter.writeRecords(cityCompanies);
            }
        }

    } catch (e) {
        Logger.error('Main Loop Error', (e as Error).message);
    } finally {
        await browserFactory.close();
    }
}

async function scrapePG(
    page: Page,
    keyword: string,
    location: string,
    deduplicator: Deduplicator,
    list: CompanyInput[],
    currentCount: number,
    limit: number
): Promise<number> {
    let count = currentCount;

    try {
        let pageNum = 1;
        let hasNext = true;

        while (hasNext && pageNum <= MAX_PAGES_PG && count < limit) {
            const url = `https://www.paginegialle.it/ricerca/${encodeURIComponent(keyword)}/${encodeURIComponent(location)}/p-${pageNum}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for JS-rendered results before extracting — PG is a SPA,
            // domcontentloaded fires before React injects .search-itm elements.
            await page.waitForSelector('.search-itm', { timeout: 10000 }).catch(() => {});

            // Extract
            const items = await page.evaluate(({ loc, key }) => {
                return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                    const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                    const tel = item.querySelector('.search-itm__phone')?.textContent?.trim();
                    const web = item.querySelector('.search-itm__url')?.getAttribute('href');
                    const pgUrl = (item.querySelector('a.remove_blank_for_app') as HTMLAnchorElement | null)?.href;

                    const adr = item.querySelector('.search-itm__adr') as HTMLElement | null;
                    const addr = adr?.textContent?.replace(/\s+/g, ' ')?.trim();

                    const region = (adr?.querySelector('div')?.textContent || '').trim() || undefined;
                    const spans = adr ? Array.from(adr.querySelectorAll('span')).map(s => (s.textContent || '').trim()).filter(Boolean) : [];
                    const street = spans[0] || '';
                    const zip = spans[1] || undefined;
                    const cityName = spans[2] || undefined;
                    const provMatch = addr ? addr.match(/\(([A-Z]{2})\)/) : null;
                    const province = provMatch && provMatch[1] ? provMatch[1] : undefined;

                    if (!name) return null;
                    return {
                        company_name: name,
                        city: cityName || loc,
                        province,
                        zip_code: zip,
                        region,
                        address: addr || (street ? street : undefined),
                        phone: tel,
                        website: web,
                        category: key,
                        source: 'PG',
                        pg_url: pgUrl
                    } as CompanyInput;
                }).filter(x => x !== null);
            }, { loc: location, key: keyword }) as CompanyInput[];

            if (items.length === 0) break;

            for (const item of items) {
                if (!item) continue;
                if (count >= limit) break; // 🛑 LIMIT CHECK

                if (!deduplicator.checkDuplicate(item)) {
                    deduplicator.add(item);
                    list.push(item);
                    count++;
                }
            }

            // Next Page?
            hasNext = !!(await page.$('.search-pagi__next'));
            pageNum++;
            await delay(1000);
        }
    } catch (e) {
        Logger.error(`PG Scrape Error ${location}`, (e as Error).message);
    }

    return count;
}

main();
