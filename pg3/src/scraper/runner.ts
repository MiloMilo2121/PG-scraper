import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { BrowserFactory } from './core/browser/factory_v2';
import { CookieConsent } from './core/browser/cookie_consent';
import { Page } from 'playwright';
import { Deduplicator } from './utils/deduplicator';
import { CompanyInput } from './types';
import { Logger } from './utils/logger';
import { EnvValidator } from './utils/env_validator';

const MAX_PAGES_PG        = 20;
const BROWSER_REFRESH_EVERY = 5;
const OUTPUT_DIR          = 'output/campaigns';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── CLUSTERS ──────────────────────────────────────────────────────────────
const TARGET_CLUSTERS: Record<string, string[]> = {
    "Verona": [
        "Verona",
        "Villafranca di Verona", "San Giovanni Lupatoto", "Bussolengo",
        "Negrar di Valpolicella", "Pescantina", "Grezzana",
        "San Martino Buon Albergo", "Zevio", "Caldiero",
        "San Bonifacio", "Soave", "Cologna Veneta",
        "Legnago", "Isola della Scala", "Vigasio",
        "Castel d'Azzano", "Peschiera del Garda",
        "Bardolino", "Lazise", "Garda",
        "Valeggio sul Mincio", "Mozzecane",
    ],
    "Venezia": [
        "Venezia",
        "Mestre", "Marghera", "Spinea", "Mirano",
        "Dolo", "Mira", "Noale", "Vigonovo", "Pianiga",
        "Marcon", "Quarto d'Altino",
        "Chioggia", "Cavarzere",
        "San Donà di Piave", "Musile di Piave", "Eraclea",
        "Jesolo", "Caorle",
        "Portogruaro", "San Michele al Tagliamento", "Gruaro",
    ],
    "Padova": [
        "Padova",
        "Albignasego", "Selvazzano Dentro", "Vigonza",
        "Rubano", "Cadoneghe", "Limena", "Saonara",
        "Noventa Padovana", "Ponte San Nicolò",
        "Cittadella", "Camposampiero", "Piazzola sul Brenta",
        "Abano Terme", "Montegrotto Terme",
        "Monselice", "Este", "Conselve", "Montagnana",
    ],
    "Vicenza": [
        "Vicenza",
        "Bassano del Grappa", "Schio", "Thiene",
        "Arzignano", "Montecchio Maggiore", "Valdagno",
        "Lonigo", "Noventa Vicentina",
        "Marostica", "Sandrigo",
        "Brendola", "Montorso Vicentino",
        "Asiago", "Gallio",
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
        "Valdobbiadene", "Castelfranco Veneto",
    ],
    "Rovigo": [
        "Rovigo",
        "Adria", "Badia Polesine", "Lendinara",
        "Occhiobello", "Porto Viro", "Villadose",
        "Castelmassa", "Ariano nel Polesine",
        "Ficarolo", "Pontecchio Polesine",
    ],
    "Belluno": [
        "Belluno",
        "Feltre", "Sedico", "Ponte nelle Alpi",
        "Pieve di Cadore", "Agordo", "Mel",
        "Longarone", "Cortina d'Ampezzo",
    ],
    "Brescia": [
        "Brescia", "Desenzano del Garda", "Montichiari",
        "Lumezzane", "Palazzolo sull'Oglio", "Rovato", "Ghedi",
    ],
    "Mantova": ["Mantova", "Castiglione delle Stiviere", "Suzzara", "Viadana"],
};

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const parseArg = (name: string) =>
    args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const specificCategories = parseArg('category')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
const specificCity       = parseArg('city') ?? null;
const COMPANY_LIMIT      = parseInt(parseArg('limit') ?? '', 10) || Infinity;

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── ERRORS ─────────────────────────────────────────────────────────────────
class BrowserCorruptedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'BrowserCorruptedError'; }
}

// ─── URL ────────────────────────────────────────────────────────────────────
// PG canonical search URLs use lowercase hyphens, no accents, no apostrophes.
function pgSlug(s: string): string {
    return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[''']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ─── BROWSER ────────────────────────────────────────────────────────────────
// cookiesAccepted is per-browser-session; reset when browser restarts.
let cookiesAccepted = false;

async function ensurePage(factory: BrowserFactory, current: Page): Promise<Page> {
    if (!current.isClosed() && await factory.isHealthy()) return current;
    Logger.warn('🔄 Reactive restart — browser/page dead');
    try { await factory.close(); } catch { /* ignore */ }
    await delay(800);
    cookiesAccepted = false;
    return factory.newPage();
}

async function restartBrowser(factory: BrowserFactory): Promise<Page> {
    await factory.close();
    await delay(800);
    cookiesAccepted = false;
    return factory.newPage();
}

// ─── CSV ────────────────────────────────────────────────────────────────────
const CSV_HEADER = [
    { id: 'company_name', title: 'company_name' },
    { id: 'city',         title: 'city'         },
    { id: 'province',     title: 'province'     },
    { id: 'zip_code',     title: 'zip_code'     },
    { id: 'address',      title: 'address'      },
    { id: 'phone',        title: 'phone'        },
    { id: 'website',      title: 'website'      },
    { id: 'category',     title: 'category'     },
    { id: 'source',       title: 'source'       },
    { id: 'vat_code',     title: 'vat_code'     },
    { id: 'pg_url',       title: 'pg_url'       },
];

async function writeCsv(filePath: string, append: boolean, rows: CompanyInput[]): Promise<void> {
    if (rows.length === 0) return;
    await createObjectCsvWriter({ path: filePath, header: CSV_HEADER, append }).writeRecords(rows);
}

// ─── CHECKPOINT ─────────────────────────────────────────────────────────────
type Checkpoint = Record<string, true>;

function cpKey(kw: string, loc: string) { return `${kw}|${loc}`; }

function loadCheckpoint(file: string): Checkpoint {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveCheckpoint(file: string, cp: Checkpoint): void {
    fs.writeFileSync(file, JSON.stringify(cp));
}

// ─── SCRAPER ────────────────────────────────────────────────────────────────
async function scrapePG(
    page: Page,
    keyword: string,
    location: string,
    dedup: Deduplicator,
    sink: CompanyInput[],
    count: number,
    limit: number,
): Promise<number> {
    const kwSlug  = pgSlug(keyword);
    const locSlug = pgSlug(location);
    let pageNum   = 1;

    try {
        // Navigate to page 1
        const firstUrl = `https://www.paginegialle.it/ricerca/${kwSlug}/${locSlug}/p-1`;
        try {
            await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            throw new BrowserCorruptedError(`goto [${location} p1]: ${(e as Error).message}`);
        }

        // Accept cookies once per browser session, after first real navigation
        if (!cookiesAccepted) {
            await page.waitForSelector(
                '#onetrust-accept-btn-handler, [class*="cookie"] button, button[class*="accept"]',
                { timeout: 2000 },
            ).catch(() => {});
            await CookieConsent.handle(page);
            await delay(300);
            cookiesAccepted = true;
        }

        let consecutiveEmpty = 0;

        while (pageNum <= MAX_PAGES_PG && count < limit) {
            // Wait for results to render (React SPA); silently skip if 0-result page
            await page.waitForSelector('.search-itm', { timeout: 6000 }).catch(() => {});

            const { items, nextHref } = await page.evaluate(({ loc, key }) => {
                const rows = Array.from(document.querySelectorAll('.search-itm')).map(el => {
                    const name = el.querySelector('.search-itm__rag')?.textContent?.trim();
                    if (!name) return null;

                    const adr    = el.querySelector('.search-itm__adr') as HTMLElement | null;
                    const addr   = adr?.textContent?.replace(/\s+/g, ' ').trim();
                    const spans  = adr
                        ? Array.from(adr.querySelectorAll('span'))
                            .map(s => s.textContent?.trim() ?? '')
                            .filter(Boolean)
                        : [];

                    return {
                        company_name: name,
                        phone:    el.querySelector('.search-itm__phone')?.textContent?.trim() ?? undefined,
                        website:  el.querySelector('.search-itm__url')?.getAttribute('href') ?? undefined,
                        pg_url:   (el.querySelector('a.remove_blank_for_app') as HTMLAnchorElement | null)?.href ?? undefined,
                        address:  addr || spans[0] || undefined,
                        zip_code: spans[1] || undefined,
                        city:     spans[2] || loc,
                        province: addr?.match(/\(([A-Z]{2})\)/)?.[1] ?? undefined,
                        category: key,
                        source:   'PG',
                    };
                }).filter((x): x is NonNullable<typeof x> => x !== null);

                // Find next-page link — multiple selector fallbacks
                const nextEl = document.querySelector<HTMLAnchorElement>(
                    '.search-pagi__next:not(.disabled), a[rel="next"], [class*="pagi"][class*="next"]:not([class*="disabled"])'
                );
                const href = nextEl?.href ?? null;
                // Discard JS pseudo-links
                const nextHref = (href && !href.includes('javascript:') && href !== window.location.href)
                    ? href : null;

                return { items: rows, nextHref };
            }, { loc: location, key: keyword });

            let added = 0;
            for (const item of items as CompanyInput[]) {
                if (count >= limit) break;
                if (!dedup.checkDuplicate(item)) {
                    dedup.add(item);
                    sink.push(item);
                    count++;
                    added++;
                }
            }

            Logger.info(`         p${pageNum}: ${items.length} items, +${added} new → ${count} | next=${nextHref ? 'yes' : 'no'}`);

            if (items.length === 0) {
                consecutiveEmpty++;
                if (consecutiveEmpty >= 2) break; // two blank pages in a row = truly done
            } else {
                consecutiveEmpty = 0;
            }

            if (!nextHref || count >= limit) break;

            // Navigate using the actual href from the DOM (most reliable)
            try {
                await page.goto(nextHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) {
                throw new BrowserCorruptedError(`goto [${location} p${pageNum + 1}]: ${(e as Error).message}`);
            }
            pageNum++;
            await delay(1200);
        }
    } catch (e) {
        if (e instanceof BrowserCorruptedError) throw e;
        Logger.error(`PG [${location}]`, (e as Error).message);
    }

    return count;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
    process.on('uncaughtException', err => {
        Logger.error('💥 uncaughtException', err.stack ?? err.message);
        process.exit(1);
    });
    process.on('unhandledRejection', reason => {
        Logger.error('💥 unhandledRejection', String(reason));
        process.exit(1);
    });

    Logger.info('🚀 PG SCRAPER v5.0 — resilient + Italian locale');
    try { EnvValidator.validate(); }
    catch (e) { Logger.error('Env', (e as Error).message); process.exit(1); }

    const cities   = specificCity ? [specificCity] : Object.keys(TARGET_CLUSTERS);
    const keywords = specificCategories ?? ['centro estetico', 'epilazione laser', 'beauty center'];
    Logger.info(`🎯 ${cities.join(', ')} | Keywords: ${keywords.join(', ')}`);
    if (COMPANY_LIMIT !== Infinity) Logger.info(`🛑 Limit: ${COMPANY_LIMIT}`);

    const factory = BrowserFactory.getInstance();
    let page = await factory.newPage();
    let navCount = 0;

    try {
        for (const city of cities) {
            Logger.info(`\n🏙️  ${city}`);

            const dedup = new Deduplicator();
            const batch: CompanyInput[] = [];
            let cityTotal = 0;

            const today    = new Date().toISOString().split('T')[0];
            const kwSlug   = keywords.join('-').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const citySlug = city.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const csvFile  = path.join(OUTPUT_DIR, `campaign_${citySlug}_${kwSlug}_${today}.csv`);
            const cpFile   = path.join(OUTPUT_DIR, `.cp_${citySlug}_${today}.json`);

            const cp = loadCheckpoint(cpFile);
            // needsHeader: write CSV header on first flush only if file is new
            let needsHeader = !fs.existsSync(csvFile);
            if (!needsHeader) Logger.info(`   ♻️  Resume — ${Object.keys(cp).length} locations done`);

            const flush = async () => {
                if (batch.length === 0) return;
                await writeCsv(csvFile, !needsHeader, batch);
                needsHeader = false; // header written, always append from now on
                Logger.info(`   💾 +${batch.length} saved (${cityTotal} total for ${city})`);
                batch.length = 0;
            };

            const locations = TARGET_CLUSTERS[city] ?? [city];
            Logger.info(`   ${locations.length} locations × ${keywords.length} keywords`);

            outer: for (let ki = 0; ki < keywords.length; ki++) {
                const keyword = keywords[ki];
                Logger.info(`   🔎 [${ki + 1}/${keywords.length}] "${keyword}"`);

                for (let li = 0; li < locations.length; li++) {
                    const loc = locations[li];
                    const key = cpKey(keyword, loc);
                    if (cp[key]) { Logger.info(`      ⏩ ${loc}`); continue; }

                    // Proactive browser restart before memory accumulates
                    if (navCount > 0 && navCount % BROWSER_REFRESH_EVERY === 0) {
                        Logger.info(`      🔄 Proactive restart (#${navCount})`);
                        page = await restartBrowser(factory);
                    } else {
                        page = await ensurePage(factory, page);
                    }
                    navCount++;

                    Logger.info(`      [${li + 1}/${locations.length}] ${loc}`);

                    let scrapeOk = false;
                    for (let attempt = 0; attempt <= 2; attempt++) {
                        try {
                            cityTotal = await scrapePG(page, keyword, loc, dedup, batch, cityTotal, COMPANY_LIMIT);
                            scrapeOk = true;
                            break;
                        } catch (e) {
                            if (e instanceof BrowserCorruptedError && attempt < 2) {
                                Logger.warn(`      🔄 BrowserCorruptedError at ${loc}, retry ${attempt + 1}`);
                                page = await restartBrowser(factory);
                            } else {
                                Logger.error(`      Fatal [${loc}]`, (e as Error).message);
                                break;
                            }
                        }
                    }

                    await flush();

                    if (scrapeOk) {
                        cp[key] = true;
                        saveCheckpoint(cpFile, cp);
                    }

                    if (cityTotal >= COMPANY_LIMIT) {
                        Logger.info(`🛑 Limit reached: ${cityTotal}`);
                        break outer;
                    }
                }
            }

            await flush();
            try { fs.unlinkSync(cpFile); } catch { /* already deleted or never created */ }
            Logger.info(`\n✅ ${city} done — ${cityTotal} leads`);
        }
    } catch (e) {
        Logger.error('Main loop', (e as Error).message);
    } finally {
        await factory.close();
    }
}

main();
