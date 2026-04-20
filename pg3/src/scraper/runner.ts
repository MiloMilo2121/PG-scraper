
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './core/browser/factory_v2';
import { Page } from 'playwright';
import { Deduplicator } from './utils/deduplicator';
import { CompanyInput } from './types';
import { Logger } from './utils/logger';
import { EnvValidator } from './utils/env_validator';

// --- CONFIGURATION ---
const MAX_PAGES_PG = 5;
const OUTPUT_DIR = 'output/campaigns';
const BROWSER_REFRESH_EVERY = 8; // proactive restart every N locations

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// --- CLUSTERS ---
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

// --- CLI ARGS ---
const args = process.argv.slice(2);
const categoryArg = args.find(a => a.startsWith('--category='))?.split('=')[1];
const specificCategories = categoryArg
    ? categoryArg.split(',').map(s => s.trim()).filter(Boolean)
    : null;
const specificCity = args.find(a => a.startsWith('--city='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const COMPANY_LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks browser + page health; restarts both if dead.
 * Called before every location scrape — catches browser crashes reactively.
 */
async function ensurePage(factory: BrowserFactory, current: Page): Promise<Page> {
    if (!current.isClosed() && await factory.isHealthy()) return current;
    Logger.warn('🔄 Browser/page dead — reactive restart');
    try { await factory.close(); } catch { /* ignore */ }
    return factory.newPage();
}

// --- CSV HELPERS ---
const CSV_HEADER = [
    { id: 'company_name', title: 'company_name' },
    { id: 'city',         title: 'city' },
    { id: 'province',     title: 'province' },
    { id: 'zip_code',     title: 'zip_code' },
    { id: 'region',       title: 'region' },
    { id: 'address',      title: 'address' },
    { id: 'phone',        title: 'phone' },
    { id: 'website',      title: 'website' },
    { id: 'category',     title: 'category' },
    { id: 'source',       title: 'source' },
    { id: 'vat_code',     title: 'vat_code' },
    { id: 'pg_url',       title: 'pg_url' },
];

function makeCsvWriter(filePath: string, append: boolean) {
    return createObjectCsvWriter({ path: filePath, header: CSV_HEADER, append });
}

// --- MAIN ---
async function main() {
    process.on('uncaughtException', (err) => {
        Logger.error('💥 uncaughtException', err.message + '\n' + err.stack);
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        Logger.error('💥 unhandledRejection', String(reason));
        process.exit(1);
    });

    Logger.info('🚀 UNIFIED CAMPAIGN GENERATOR v4.2 (Bulletproof)');

    try { EnvValidator.validate(); }
    catch (e) { Logger.error('Environment Error', (e as Error).message); process.exit(1); }

    const citiesToScan = specificCity ? [specificCity] : Object.keys(TARGET_CLUSTERS);
    const keywords = specificCategories ?? ['centro estetico', 'epilazione laser', 'beauty center'];

    Logger.info(`🎯 Scope: ${citiesToScan.join(', ')} | Keywords: ${keywords.join(', ')}`);
    if (COMPANY_LIMIT !== Infinity) Logger.info(`🛑 Limit: ${COMPANY_LIMIT}`);

    const factory = BrowserFactory.getInstance();
    let page = await factory.newPage();
    let navCount = 0;
    let totalFound = 0;

    try {
        for (const city of citiesToScan) {
            Logger.info(`\n🏙️  HUB: ${city}`);

            const cityCompanies: CompanyInput[] = [];
            const dedup = new Deduplicator();

            const timestamp = new Date().toISOString().split('T')[0];
            const slug = keywords.join('-').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const cityFile = path.join(OUTPUT_DIR, `campaign_${city.toLowerCase().replace(/\s+/g, '_')}_${slug}_${timestamp}.csv`);
            let csvInitialized = false;

            async function flush() {
                if (cityCompanies.length === 0) return;
                const writer = makeCsvWriter(cityFile, csvInitialized);
                await writer.writeRecords(cityCompanies);
                Logger.info(`      💾 Saved ${cityCompanies.length} records (${totalFound} cumulative)`);
                csvInitialized = true;
                cityCompanies.length = 0;
            }

            for (let ki = 0; ki < keywords.length; ki++) {
                const keyword = keywords[ki];
                Logger.info(`   🔎 Keyword [${ki + 1}/${keywords.length}]: "${keyword}"`);

                const cluster = TARGET_CLUSTERS[city];
                const locations = cluster ?? [city];
                if (cluster) {
                    Logger.info(`      🚀 Cluster: ${cluster.length} locations`);
                }

                for (let li = 0; li < locations.length; li++) {
                    const loc = locations[li];

                    // Proactive browser refresh every N locations
                    if (navCount > 0 && navCount % BROWSER_REFRESH_EVERY === 0) {
                        Logger.info(`      🔄 Proactive refresh (${navCount} done)`);
                        try {
                            await factory.close();
                            page = await factory.newPage();
                        } catch (e) {
                            Logger.error('Proactive refresh failed', (e as Error).message);
                            throw e;
                        }
                    } else {
                        // Reactive: recover from any browser crash immediately
                        page = await ensurePage(factory, page);
                    }
                    navCount++;

                    Logger.info(`      📍 [kw ${ki + 1}/${keywords.length}, loc ${li + 1}/${locations.length}] ${loc}`);

                    totalFound = await scrapePG(page, keyword, loc, dedup, cityCompanies, totalFound, COMPANY_LIMIT);

                    await flush();

                    if (totalFound >= COMPANY_LIMIT) {
                        Logger.info(`🛑 LIMIT: ${totalFound}. Stopping.`);
                        break;
                    }
                }

                if (totalFound >= COMPANY_LIMIT) break;
            }

            // Final flush for anything left
            await flush();
            Logger.info(`\n✅ ${city} done — ${totalFound} leads`);
        }

    } catch (e) {
        Logger.error('Main Loop Error', (e as Error).message);
    } finally {
        await factory.close();
    }
}

// --- SCRAPER ---
async function scrapePG(
    page: Page,
    keyword: string,
    location: string,
    dedup: Deduplicator,
    list: CompanyInput[],
    currentCount: number,
    limit: number,
): Promise<number> {
    let count = currentCount;

    try {
        let pageNum = 1;
        let hasNext = true;

        while (hasNext && pageNum <= MAX_PAGES_PG && count < limit) {
            const url = `https://www.paginegialle.it/ricerca/${encodeURIComponent(keyword)}/${encodeURIComponent(location)}/p-${pageNum}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // PG is a React SPA — wait for results to render (5 s is enough; 0 results → timeout is ok)
            await page.waitForSelector('.search-itm', { timeout: 5000 }).catch(() => {});

            const items = await page.evaluate(({ loc, key }) => {
                return Array.from(document.querySelectorAll('.search-itm')).map(el => {
                    const name = el.querySelector('.search-itm__rag')?.textContent?.trim();
                    if (!name) return null;

                    const tel  = el.querySelector('.search-itm__phone')?.textContent?.trim();
                    const web  = el.querySelector('.search-itm__url')?.getAttribute('href') ?? undefined;
                    const pgUrl = (el.querySelector('a.remove_blank_for_app') as HTMLAnchorElement | null)?.href;

                    const adr  = el.querySelector('.search-itm__adr') as HTMLElement | null;
                    const addr = adr?.textContent?.replace(/\s+/g, ' ').trim();
                    const spans = adr
                        ? Array.from(adr.querySelectorAll('span')).map(s => s.textContent?.trim() ?? '').filter(Boolean)
                        : [];

                    const zip      = spans[1] || undefined;
                    const cityName = spans[2] || undefined;
                    const province = addr?.match(/\(([A-Z]{2})\)/)?.[1];

                    return {
                        company_name: name,
                        city: cityName || loc,
                        province,
                        zip_code: zip,
                        address: addr || spans[0] || undefined,
                        phone: tel,
                        website: web,
                        category: key,
                        source: 'PG',
                        pg_url: pgUrl,
                    } as import('./types').CompanyInput;
                }).filter((x): x is import('./types').CompanyInput => x !== null);
            }, { loc: location, key: keyword });

            if (items.length === 0) break;

            for (const item of items) {
                if (count >= limit) break;
                if (!dedup.checkDuplicate(item)) {
                    dedup.add(item);
                    list.push(item);
                    count++;
                }
            }

            hasNext = !!(await page.$('.search-pagi__next'));
            pageNum++;
            await delay(1000);
        }
    } catch (e) {
        Logger.error(`PG Error [${location}]`, (e as Error).message);
    }

    return count;
}

main();
