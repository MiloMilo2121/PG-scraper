
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './core/browser/factory_v2';
import { Page } from 'puppeteer';
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
const TARGET_CLUSTERS: Record<string, string[]> = {
    "Verona": ["Verona", "Villafranca di Verona", "San Giovanni Lupatoto", "Bussolengo", "San Bonifacio", "Legnago", "Peschiera del Garda"],
    "Brescia": ["Brescia", "Desenzano del Garda", "Montichiari", "Lumezzane", "Palazzolo sull'Oglio", "Rovato", "Ghedi"],
    "Vicenza": ["Vicenza", "Bassano del Grappa", "Schio", "Thiene", "Arzignano", "Montecchio Maggiore"],
    "Padova": ["Padova", "Albignasego", "Selvazzano Dentro", "Vigonza", "Cittadella", "Abano Terme"],
    "Mantova": ["Mantova", "Castiglione delle Stiviere", "Suzzara", "Viadana"],
    // Treviso is often low volume on PG for niche queries; scan nearby municipalities to satisfy small fixed limits.
    "Treviso": ["Treviso", "Villorba", "Silea", "Paese", "Preganziol", "Quinto di Treviso", "Oderzo", "Conegliano", "Vittorio Veneto", "Montebelluna", "Castelfranco Veneto"]
};

// --- DEFAULT ARGS ---
const args = process.argv.slice(2);
const specificCategory = args.find(a => a.startsWith('--category='))?.split('=')[1];
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
    const keywords = specificCategory ? [specificCategory] : ["meccatronica", "automazione industriale"]; // Default

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
                    { id: 'vat_code', title: 'vat_code' }
                ]
            });

            for (const keyword of keywords) {
                Logger.info(`   🔎 Keyword: "${keyword}"`);

                // 2. THE BARRIER CHECK (PagineGialle Total Results)
                let useCluster = false;
                const pgUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(keyword)}/${encodeURIComponent(city)}`;

                await page.goto(pgUrl, { waitUntil: 'domcontentloaded' });
                await CookieConsent.handle(page); // 🍪 Smash cookies

                // Parse Total Count
                const countText = await page.evaluate(() => {
                    const el = document.querySelector('.listing-res__numresults span') || document.querySelector('.search-ind__res');
                    return el ? el.textContent : '0';
                });
                const totalResults = parseInt(countText?.replace(/\./g, '') || '0', 10);
                Logger.info(`      📊 PG Total Results: ${totalResults}`);

                if (totalResults > 200) {
                    useCluster = true;
                    Logger.info(`      🚀 HIGH VOLUME DETECTED (>200). ACTIVATING CLUSTER STRATEGY.`);
                } else {
                    Logger.info(`      📉 Low volume. Scanned only main city.`);
                }

                // Define Locations based on Cluster Decision
                const cluster = TARGET_CLUSTERS[city];
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
                    // Only run maps if PG yield was low OR if we are in main city to ensure quality
                    // Actually, let's run it always for maximum coverage but handle dedupe
                    const mapsResults = await GoogleMapsProvider.fetchDeepResults(page, loc, keyword);

                    for (const mRes of mapsResults) {
                        if (totalGlobalFound >= COMPANY_LIMIT) break; // LIMIT CHECK

                        const existing = deduplicator.checkDuplicate(mRes);
                        if (existing) {
                            // Smart Merge
                            deduplicator.merge(existing, mRes);
                            Logger.info(`      ✨ Merged Maps data for: ${existing.company_name}`);
                        } else {
                            deduplicator.add(mRes);
                            cityCompanies.push(mRes);
                            totalGlobalFound++;
                        }
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

            // Extract
            const items = await page.evaluate((loc, key) => {
                return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                    const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                    const addr = item.querySelector('.search-itm__adr')?.textContent?.trim();
                    const tel = item.querySelector('.search-itm__phone')?.textContent?.trim();
                    const web = item.querySelector('.search-itm__url')?.getAttribute('href');

                    if (!name) return null;
                    return {
                        company_name: name,
                        city: loc,
                        address: addr,
                        phone: tel,
                        website: web,
                        category: key,
                        source: 'PG'
                    } as CompanyInput;
                }).filter(x => x !== null);
            }, location, keyword);

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
