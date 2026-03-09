/**
 * 🚀 CAMPAIGN GENERATOR V2
 * 
 * INTELLIGENT Input-driven PG + Maps scraping pipeline.
 * 
 * Usage:
 *   npx ts-node src/scraper/generate_campaign_v2.ts \
 *     --query="manifattura" \
 *     --provinces="LO,MI,BS"
 * 
 * The user provides a QUERY (e.g., "manifattura", "moda", "metalmeccanica")
 * and PROVINCE CODES (e.g., "LO", "MI"). The system:
 *   0. CategoryMatcher (LLM) resolves the query to ALL matching PG categories
 *   1. Pre-Flight: Check PG result count per (category, province code)
 *   2. If >200: LLM splits province into 5 equidistant municipalities
 *   3. Scrape PG for each (category, location) — full pagination
 *   4. Scrape Google Maps for each (category, location) — scroll to load all
 *   5. Dedup + Merge + CSV Output
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createObjectCsvWriter } from 'csv-writer';
import { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
// BrowserFactory BYPASSED: its newPage() initialization pipeline (GeneticFingerprinter,
// BrowserEvasion, ProxyManager, CookieConsent) detaches the page frame on the server.
// Raw puppeteer.launch() works perfectly (confirmed by diagnostic).
import { Deduplicator } from './utils/deduplicator';
import { CompanyInput } from './types';
import { MapsGridProvider } from './providers/maps_grid_provider';
import { MunicipalitySplitter } from './ai/municipality_splitter';
import { CategoryMatcher } from './ai/category_matcher';
import { CaptchaSolver } from '../enricher/core/security/captcha_solver';
import { PROVINCE_CODES, PROVINCE_NAME_TO_CODE } from './data/pg_categories';
import { Logger } from './utils/logger';
import { CookieConsent } from './core/browser/cookie_consent';

dotenv.config();

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PG_OVERFLOW_THRESHOLD = 199;
const MAX_PG_PAGES = 10;       // PG shows ~25/page, 10 pages = 250 max per location
const PG_PAGE_DELAY_MS = 2000; // Respect rate limits (Law 305)
const PG_LOCATION_DELAY_MS = 3000;
const OUTPUT_DIR = 'output/campaigns';

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface ScrapeTarget {
    category: string;
    location: string;
    province: string;
    isMunicipality: boolean;
    pgResultCount: number;
}

// ─── CLI PARSING ─────────────────────────────────────────────────────────────
function parseCLI(): { query: string; provinceCodes: string[]; resume: boolean } {
    const args = process.argv.slice(2);

    const queryArg = args.find(a => a.startsWith('--query='))?.split('=').slice(1).join('=');
    const provincesArg = args.find(a => a.startsWith('--provinces='))?.split('=').slice(1).join('=');
    const resume = args.includes('--resume');

    if (!queryArg || !provincesArg) {
        console.error('Usage: npx ts-node src/scraper/generate_campaign_v2.ts --query="manifattura" --provinces="LO,MI,BS" [--resume]');
        process.exit(1);
    }

    // Resolve province codes — accept both "MI" and "Milano"
    const rawProvinces = provincesArg.split(',').map(s => s.trim()).filter(Boolean);
    const provinceCodes = rawProvinces.map(p => {
        // Already a code?
        if (p.length <= 3 && PROVINCE_CODES[p.toUpperCase()]) {
            return p.toUpperCase();
        }
        // Full name → code
        const code = PROVINCE_NAME_TO_CODE[p.toLowerCase()];
        if (code) return code;
        // Fallback: use as-is (will be treated as code)
        Logger.warn(`[CLI] ⚠️ Unknown province "${p}", using as-is`);
        return p.toUpperCase();
    });

    return { query: queryArg.trim(), provinceCodes, resume };
}

/**
 * Resolve province code to the full name for Maps (Maps needs full names).
 */
function resolveProvinceName(code: string): string {
    return PROVINCE_CODES[code] || code;
}

/**
 * Resolve province code to the PagineGialle province search slug.
 * PG uses URL-path slugs like "provincia-di-verona" to distinguish
 * province-level searches from city-level.
 *
 * IMPORTANT CAVEATS:
 *  - "Reggio Emilia" must be "Reggio nell'Emilia" on PG
 *  - The slug format is "provincia-di-NAME" (lowercased, spaces→hyphens)
 */
const PG_PROVINCE_OVERRIDES: Record<string, string> = {
    'RE': "provincia-di-reggio-nell-emilia",    // PG official name
    'BT': "provincia-di-barletta-andria-trani",
    'VB': "provincia-di-verbano-cusio-ossola",
    'SU': "provincia-di-sud-sardegna",
    'FC': "provincia-di-forli-cesena",
    'MS': "provincia-di-massa-carrara",
    'PU': "provincia-di-pesaro-e-urbino",
    'MB': "provincia-di-monza-e-brianza",
};

function pgProvinceName(code: string): string {
    // Check overrides first
    if (PG_PROVINCE_OVERRIDES[code]) return PG_PROVINCE_OVERRIDES[code];

    const name = PROVINCE_CODES[code];
    if (!name) return code; // Fallback: use raw code if unknown

    // Convert to PG slug: "Cremona" → "provincia-di-cremona"
    const slug = name
        .toLowerCase()
        .replace(/'/g, '-')         // L'Aquila → l-aquila
        .replace(/\s+/g, '-')       // Reggio Calabria → reggio-calabria
        .replace(/-+/g, '-');       // Clean up double dashes

    return `provincia-di-${slug}`;
}

// ─── HELPER: SETUP PAGE ──────────────────────────────────────────────────────
const TARGETS_PER_BROWSER = 250; // Safe for 32GB RAM now that rogue processes are dead
let browserInstance: Browser | null = null;
let targetsCount = 0;

export interface BrowserSession {
    page: Page;
    context: BrowserContext;
}

async function getBrowser(): Promise<Browser> {
    if (browserInstance && browserInstance.isConnected() && targetsCount < TARGETS_PER_BROWSER) {
        return browserInstance;
    }

    Logger.info(`[Browser] 🔄 (Re)launching browser (Current count: ${targetsCount})...`);
    targetsCount = 0; // Reset count
    try {
        if (browserInstance) await browserInstance.close().catch(() => { });
    } catch { }

    const browserProfileDir = path.join(process.cwd(), 'search_profile_scraper');
    if (!fs.existsSync(browserProfileDir)) fs.mkdirSync(browserProfileDir, { recursive: true });

    browserInstance = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // 🔑 CRITICAL for server stability
            '--ignore-certificate-errors',
        ],
        executablePath: process.env.CHROME_BIN || undefined,
    });
    return browserInstance!;
}

async function setupPage(): Promise<BrowserSession> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const browser = await getBrowser();
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1920, height: 1080 }
            });
            const page = await context.newPage();
            page.setDefaultTimeout(45000); // 45s for server stability
            page.setDefaultNavigationTimeout(45000);

            targetsCount++;
            return { page, context };
        } catch (e) {
            lastError = e as Error;
            Logger.warn(`[Browser] ⚠️ setupPage failed (Attempt ${i + 1}/${maxRetries}): ${lastError.message}`);

            // Force reset on failure
            if (browserInstance) {
                await browserInstance.close().catch(() => { });
                browserInstance = null;
                targetsCount = 0;
            }

            await delay(2000 * (i + 1));
        }
    }

    throw new Error(`Failed to setup page after ${maxRetries} attempts. Last error: ${lastError?.message}`);
}

// ─── PHASE 1: PRE-FLIGHT INTEL ──────────────────────────────────────────────
async function preFlightCheck(
    // No browser arg needed, uses singleton
    categories: string[],
    provinces: string[]
): Promise<ScrapeTarget[]> {
    const targets: ScrapeTarget[] = [];

    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`📡 PHASE 1: PRE-FLIGHT INTELLIGENCE`);
    Logger.info(`${'═'.repeat(60)}`);

    let preflightTargets = 0;

    for (const province of provinces) {
        for (const category of categories) {
            // Check if we need to restart the browser to prevent OOM
            if (preflightTargets >= TARGETS_PER_BROWSER) {
                Logger.info(`\n🔄 Pre-Flight: Reached ${TARGETS_PER_BROWSER} checks. Recycling browser memory...`);
                if (browserInstance) {
                    await browserInstance.close().catch(e => Logger.error(`Error closing browser: ${e.message}`));
                    browserInstance = null;
                }
                await getBrowser();
                preflightTargets = 0;
            }

            let session: BrowserSession | null = null;
            try {
                session = await setupPage();
                const page = session.page;

                Logger.info(`\n🔍 Checking: "${category}" in ${province}...`);

                // Use 'Provincia di X' format to force province-level search on PagineGialle
                // e.g. 'Verona' = solo comune, 'Provincia di Verona' = intera provincia
                const pgLocation = pgProvinceName(province);
                const pgUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(category)}/${encodeURIComponent(pgLocation)}`;

                await page.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // 🛡️ CAPTCHA CHECK
                if (await CaptchaSolver.neutralizeGatekeeper(page)) {
                    Logger.info(`   🔓 Captcha solved for ${category}/${province}. Reloading...`);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }

                await CookieConsent.handle(page);

                // Parse total count
                let countText = '0';
                try {
                    countText = await page.evaluate(() => {
                        const el = document.querySelector('.listing-res__numresults span') ||
                            document.querySelector('.search-ind__res') ||
                            document.querySelector('.listingresults__numresults span');
                        return el ? el.textContent : '0';
                    }) || '0';
                } catch (e) {
                    const msg = (e as Error).message;
                    if (msg.includes('detached') || msg.includes('destroyed')) {
                        Logger.warn(`   ⚠️ Frame detached during pre-flight for ${category}/${province}. Retrying...`);
                        await delay(1000);
                        countText = await page.evaluate(() => {
                            const el = document.querySelector('.listing-res__numresults span') ||
                                document.querySelector('.search-ind__res') ||
                                document.querySelector('.listingresults__numresults span');
                            return el ? el.textContent : '0';
                        }) || '0';
                    } else {
                        throw e;
                    }
                }

                const totalResults = parseInt(countText?.replace(/\./g, '').replace(/[^\d]/g, '') || '0', 10);
                Logger.info(`   📊 PG Results: ${totalResults}`);

                if (totalResults > PG_OVERFLOW_THRESHOLD) {
                    // OVERFLOW → Split by municipality
                    Logger.info(`   🚨 OVERFLOW (>${PG_OVERFLOW_THRESHOLD})! Splitting by municipality...`);

                    const municipalities = await MunicipalitySplitter.getMunicipalities(province);
                    Logger.info(`   🏘️ GPT municipalities: [${municipalities.join(', ')}]`);

                    for (const muni of municipalities) {
                        targets.push({
                            category,
                            location: muni,
                            province,
                            isMunicipality: true,
                            pgResultCount: totalResults,
                        });
                    }
                } else if (totalResults > 0) {
                    // NORMAL → Scrape province directly
                    targets.push({
                        category,
                        location: province,
                        province,
                        isMunicipality: false,
                        pgResultCount: totalResults,
                    });
                } else {
                    Logger.warn(`   ⚠️ 0 results parsed for "${category}" in ${province}. Proceeding with province scrape (Fallback).`);
                    targets.push({
                        category,
                        location: province,
                        province,
                        isMunicipality: false,
                        pgResultCount: -1,
                    });
                } // End if(totalResults > PG_OVERFLOW_THRESHOLD)
            } catch (error) {
                Logger.error(`   ❌ Pre-flight failed for ${category}/${province}: ${(error as Error).message}`);
                // Fallback: add province anyway
                targets.push({
                    category,
                    location: province,
                    province,
                    isMunicipality: false,
                    pgResultCount: -1,
                });
            } finally {
                if (session) {
                    await session.page.close().catch(() => { });
                    await session.context.close().catch(() => { });
                }
            }
            preflightTargets++;

            await delay(1500);
        }
        // Force GC/Cleanup between provinces
        if (global.gc) global.gc();
    }

    // Summary
    Logger.info(`\n${'─'.repeat(60)}`);
    Logger.info(`📋 SCRAPE PLAN: ${targets.length} targets`);
    for (const t of targets) {
        Logger.info(`   → [${t.category}] ${t.location} (${t.isMunicipality ? 'municipality' : 'province'}) | PG: ${t.pgResultCount}`);
    }
    Logger.info(`${'─'.repeat(60)}\n`);

    return targets;
}

// ─── PHASE 2: PG SCRAPING ───────────────────────────────────────────────────
async function scrapePG(
    page: Page,
    target: ScrapeTarget,
    dedup: Deduplicator
): Promise<CompanyInput[]> {
    const results: CompanyInput[] = [];
    let pageNum = 1;
    let hasNext = true;

    Logger.info(`   📄 PG: Scraping "${target.category}" in ${target.location}...`);

    while (hasNext && pageNum <= MAX_PG_PAGES) {
        // For province-level searches, use 'Provincia di X' to avoid PG defaulting to the city
        // For municipalities (when splitter was triggered), use the exact municipality name as-is
        const pgLocation = target.isMunicipality ? target.location : pgProvinceName(target.location);
        const url = `https://www.paginegialle.it/ricerca/${encodeURIComponent(target.category)}/${encodeURIComponent(pgLocation)}/p-${pageNum}`;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 🛡️ CAPTCHA CHECK
            if (await CaptchaSolver.neutralizeGatekeeper(page)) {
                Logger.info(`   🔓 Captcha solved for page ${pageNum}. Reloading...`);
                await page.reload({ waitUntil: 'domcontentloaded' });
            }

            let items: CompanyInput[] = [];
            try {
                // Wait for either results to load OR the "no results" message
                await Promise.race([
                    page.waitForSelector('.search-itm', { state: 'attached', timeout: 15000 }),
                    page.waitForSelector('.no-result', { state: 'attached', timeout: 15000 })
                ]).catch(() => {
                    Logger.warn(`   ⚠️ Timeout waiting for .search-itm on page ${pageNum}. DOM might be empty or Captcha blocked.`);
                });

                items = await page.evaluate(({ loc, cat, prov }) => {
                    return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                        const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                        const tel = item.querySelector('.search-itm__phone')?.textContent?.trim();

                        // Enhanced Website Extraction
                        // 1. Standard web icon/link
                        let web = item.querySelector('.search-itm__url')?.getAttribute('href');

                        // 2. Action buttons (often "Sito Web" is a button)
                        if (!web) {
                            const webBtn = Array.from(item.querySelectorAll('a')).find(a =>
                                a.textContent?.toLowerCase().includes('sito web') ||
                                a.className.includes('web') ||
                                a.href.includes('http') && !a.href.includes('paginegialle.it') // crude check
                            );
                            if (webBtn) web = webBtn.getAttribute('href');
                        }

                        // 3. Data attributes (sometimes hidden)
                        if (!web) {
                            web = item.getAttribute('data-url');
                        }

                        const pgUrl = (item.querySelector('a.remove_blank_for_app') as HTMLAnchorElement | null)?.href;

                        const adr = item.querySelector('.search-itm__adr') as HTMLElement | null;
                        const rawAddr = adr?.textContent?.replace(/\s+/g, ' ')?.trim();

                        const region = (adr?.querySelector('div')?.textContent || '').trim() || undefined;
                        const spans = adr ? Array.from(adr.querySelectorAll('span')).map(s => (s.textContent || '').trim()).filter(Boolean) : [];
                        const street = spans[0] || '';
                        const zip = spans[1] || undefined;
                        const cityName = spans[2] || undefined;
                        const provMatch = rawAddr ? rawAddr.match(/\(([A-Z]{2})\)/) : null;
                        const province = provMatch?.[1] || prov;

                        if (!name) return null;
                        return {
                            company_name: name,
                            city: cityName || loc,
                            province,
                            zip_code: zip,
                            region,
                            address: rawAddr || (street ? street : undefined),
                            phone: tel,
                            website: web,
                            category: cat,
                            source: 'PG',
                            pg_url: pgUrl
                        };
                    }).filter(x => x !== null);
                }, { loc: target.location, cat: target.category, prov: target.province }) as CompanyInput[];
            } catch (evalError) {
                const msg = (evalError as Error).message;
                if (msg.includes('detached') || msg.includes('destroyed')) {
                    Logger.warn(`   ⚠️ Frame detached on page ${pageNum}. Retrying once...`);
                    await delay(1000);
                    try {
                        // Reuse the same logic logic or just reload and skip to next iteration
                        // Ideally we should re-evaluate, but for simplicity let's reload the page
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        // Simple retry - if this fails, the outer catch will catch it
                        // For now, let's just log and continue to avoid infinite loops
                        continue;
                    } catch (retryError) {
                        Logger.error(`   ❌ Retry failed for page ${pageNum}: ${(retryError as Error).message}`);
                        break;
                    }
                }
                throw evalError;
            }

            if (items.length === 0) {
                Logger.info(`   📄 PG: Page ${pageNum} empty. Done.`);
                try {
                    // Help user debug why it's empty (e.g. anti-bot proxy ban)
                    await page.screenshot({ path: `/tmp/pg_empty_${target.location}_p${pageNum}.png` });
                } catch { }
                break;
            }

            // Dedup and collect
            let added = 0;
            for (const item of items) {
                if (!item) continue;
                if (!dedup.checkDuplicate(item as CompanyInput)) {
                    dedup.add(item as CompanyInput);
                    results.push(item as CompanyInput);
                    added++;
                }
            }

            Logger.info(`   📄 PG: Page ${pageNum} → ${items.length} items, ${added} new (${results.length} total)`);

            // Check next page
            hasNext = !!(await page.$('.search-pagi__next'));
            pageNum++;

            if (hasNext) await delay(PG_PAGE_DELAY_MS);

        } catch (error) {
            Logger.error(`   ❌ PG Page ${pageNum} error: ${(error as Error).message}`);
            break;
        }
    }

    return results;
}

// ─── PHASE 3: MAPS SCRAPING ─────────────────────────────────────────────────
async function scrapeMaps(
    page: Page,
    target: ScrapeTarget,
    dedup: Deduplicator
): Promise<{ newCount: number; mergedCount: number }> {
    Logger.info(`   🗺️ Maps: Scraping "${target.category}" in ${target.location}...`);

    const mapsResults = await MapsGridProvider.scrapeAll(page, target.category, target.location);

    let newCount = 0;
    let mergedCount = 0;

    for (const mRes of mapsResults) {
        // Assign target province if Maps didn't extract one (fixes "unknown" bucket)
        if (!mRes.province && target.province) {
            mRes.province = target.province;
        }
        const existing = dedup.checkDuplicate(mRes);
        if (existing) {
            dedup.merge(existing, mRes);
            mergedCount++;
        } else {
            dedup.add(mRes);
            newCount++;
        }
    }

    Logger.info(`   🗺️ Maps: ${mapsResults.length} found → ${newCount} new, ${mergedCount} merged`);

    return { newCount, mergedCount };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
    const { query, provinceCodes, resume } = parseCLI();

    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`🚀 CAMPAIGN GENERATOR V2 — INTELLIGENT MODE`);
    Logger.info(`🔍 Query: "${query}"`);
    Logger.info(`📍 Provinces: [${provinceCodes.map(c => `${c} (${resolveProvinceName(c)})`).join(', ')}]`);
    if (resume) Logger.info(`🔄 Resume Mode: ACTIVE (Using output/campaigns/campaign_INTERIM_CHECKPOINT.csv if available)`);
    Logger.info(`${'═'.repeat(60)}\n`);

    // PHASE 0: CATEGORY INTELLIGENCE
    Logger.info(`${'═'.repeat(60)}`);
    Logger.info(`🧠 PHASE 0: CATEGORY INTELLIGENCE`);
    Logger.info(`${'═'.repeat(60)}`);

    let categories: string[];
    if (query.includes(',')) {
        Logger.info('⚡ Query contains commas - Skipping LLM matching, using query tags directly.');
        categories = query.split(',').map(s => s.trim());
    } else {
        categories = await CategoryMatcher.match(query);
    }

    if (categories.length === 0) {
        Logger.error(`❌ No PG categories matched for "${query}". Aborting.`);
        return;
    }

    Logger.info(`✅ Resolved "${query}" → ${categories.length} PG categories`);
    Logger.info(`📋 Categories: [${categories.join(', ')}]\n`);

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // 🔑 DIRECT BROWSER LAUNCH managed by getBrowser() helper
    Logger.info('[Browser] 🚀 Initializing browser...');
    await getBrowser();
    Logger.info('[Browser] ✅ Browser ready');

    const globalDedup = new Deduplicator();
    const allCompanies: CompanyInput[] = [];

    // Load existing data if resuming
    if (resume) {
        const interimFile = path.join(OUTPUT_DIR, `campaign_INTERIM_CHECKPOINT.csv`);
        if (fs.existsSync(interimFile)) {
            Logger.info(`🔄 Resume: Loading existing data from ${interimFile}...`);
            const content = fs.readFileSync(interimFile, 'utf-8');
            const lines = content.split('\n').slice(1); // skip header
            for (const line of lines) {
                if (!line.trim()) continue;
                // Simple CSV parse for resume - assuming standard format from our writer
                const parts = line.split(',');
                const company = {
                    company_name: parts[0],
                    city: parts[1],
                    province: parts[2],
                    zip_code: parts[3],
                    region: parts[4],
                    address: parts[5],
                    phone: parts[6],
                    website: parts[7],
                    category: parts[8],
                    source: parts[9],
                    vat_code: parts[10],
                    pg_url: parts[11],
                };
                globalDedup.add(company as any);
            }
            Logger.info(`🔄 Resume: ${globalDedup.count} records restored.`);
        }
    }

    try {
        // PHASE 1: Pre-Flight (using province CODES for PG URLs)
        const targets = await preFlightCheck(categories, provinceCodes);

        if (targets.length === 0) {
            Logger.warn('⚠️ No targets generated. Check categories and provinces.');
            return;
        }

        // PHASE 2 + 3: Scrape each target
        Logger.info(`\n${'═'.repeat(60)}`);
        Logger.info(`🔥 PHASE 2+3: SCRAPING (${targets.length} targets)`);
        Logger.info(`${'═'.repeat(60)}\n`);

        let targetsProcessedInCurrentBrowser = 0;

        for (const [idx, target] of targets.entries()) {
            // SKIP logic if resuming (simple heuristic: if we have record for this cat/location skip)
            // But better: idx check if we stored it, or just rely on dedup to skip network calls.
            // Actually, to save time, we should skip the entire target if it's already "dense" in dedup.
            if (resume && globalDedup.count > 0) {
                const existing = globalDedup.getAll().filter(c => c.category === target.category && (c.city === target.location || c.province === target.location));
                if (existing.length > 5) { // Arbitrary threshold to assume target was done
                    Logger.info(`⏭️ Skipping Target ${idx + 1}/${targets.length}: [${target.category}] ${target.location} (Already in dedup)`);
                    continue;
                }
            }
            // Check if we need to restart the browser
            if (targetsProcessedInCurrentBrowser >= TARGETS_PER_BROWSER) {
                Logger.info(`\n🔄 Reached ${TARGETS_PER_BROWSER} targets. Closing browser and launching new one...`);
                if (browserInstance) {
                    await browserInstance.close().catch(e => Logger.error(`Error closing browser: ${e.message}`));
                    browserInstance = null; // Reset instance
                }
                await getBrowser(); // Launch new browser
                targetsProcessedInCurrentBrowser = 0; // Reset counter
            }

            let session: BrowserSession | null = null;
            try {
                session = await setupPage();
                Logger.info(`\n┌── TARGET ${idx + 1}/${targets.length}: [${target.category}] ${target.location}`);

                // PG
                const pgResults = await scrapePG(session.page, target, globalDedup);
                allCompanies.push(...pgResults);

                await delay(PG_LOCATION_DELAY_MS);

                // Maps
                const { newCount } = await scrapeMaps(session.page, target, globalDedup);
                // newCount items are already in dedup but not in allCompanies array
                // We'll rebuild final list from dedup at the end

                Logger.info(`└── DONE: ${pgResults.length} PG + ${newCount} new Maps | Running total: ${globalDedup.count}`);

            } finally {
                if (session) {
                    await session.page.close().catch(() => { });
                    await session.context.close().catch(() => { });
                }
            }
            targetsProcessedInCurrentBrowser++;

            // 💾 INTERIM SAVE (Law 901: DATA PRESERVATION FIRST)
            const interimList = globalDedup.getAll();
            if (interimList.length > 0) {
                const interimFile = path.join(OUTPUT_DIR, `campaign_INTERIM_CHECKPOINT.csv`);
                const interimWriter = createObjectCsvWriter({
                    path: interimFile,
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
                        { id: 'pg_url', title: 'pg_url' },
                    ]
                });
                await interimWriter.writeRecords(interimList);
                Logger.info(`💾 Interim Checkpoint: ${interimFile} (${interimList.length} companies)`);
            }
        }

        // PHASE 4: Final output
        const finalList = globalDedup.getAll();

        if (finalList.length === 0) {
            Logger.warn('\n⚠️  SCRAPING FINISHED BUT NO COMPANIES FOUND.');
            Logger.warn('   This usually means all targets returned 0 results or browser crashes were systematic.');
            Logger.error('❌ FATAL: Generation failed to produce any data.');
            process.exit(1);
        }

        Logger.info(`\n${'═'.repeat(60)}`);
        Logger.info(`💾 PHASE 4: SAVING RESULTS`);
        Logger.info(`📊 Total unique companies: ${finalList.length}`);
        Logger.info(`${'═'.repeat(60)}\n`);

        // Group by province for separate CSVs
        const byProvince = new Map<string, CompanyInput[]>();
        for (const company of finalList) {
            const prov = company.province || 'unknown';
            if (!byProvince.has(prov)) byProvince.set(prov, []);
            byProvince.get(prov)!.push(company);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        for (const [prov, companies] of byProvince) {
            const filename = `campaign_${prov.toLowerCase()}_${timestamp}.csv`;
            const filepath = path.join(OUTPUT_DIR, filename);

            const csvWriter = createObjectCsvWriter({
                path: filepath,
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
                    { id: 'pg_url', title: 'pg_url' },
                ]
            });

            await csvWriter.writeRecords(companies);
            Logger.info(`💾 Saved: ${filepath} (${companies.length} companies)`);
        }

        // Also save a combined CSV
        const combinedFile = path.join(OUTPUT_DIR, `campaign_COMBINED_${timestamp}.csv`);
        const combinedWriter = createObjectCsvWriter({
            path: combinedFile,
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
                { id: 'pg_url', title: 'pg_url' },
            ]
        });
        await combinedWriter.writeRecords(finalList);
        Logger.info(`💾 Combined: ${combinedFile} (${finalList.length} companies)`);

        // Summary
        Logger.info(`\n${'═'.repeat(60)}`);
        Logger.info(`✅ CAMPAIGN GENERATION COMPLETE`);
        Logger.info(`📊 Total: ${finalList.length} unique companies`);

        const pgCount = finalList.filter(c => c.source === 'PG').length;
        const mapsCount = finalList.filter(c => c.source === 'Maps').length;
        const mergedCount = finalList.filter(c => c.source?.includes('+')).length;
        Logger.info(`   PG only: ${pgCount} | Maps only: ${mapsCount} | Merged: ${mergedCount}`);
        Logger.info(`${'═'.repeat(60)}\n`);

    } catch (error) {
        Logger.error(`💀 FATAL: ${(error as Error).message}`);
    } finally {
        if (browserInstance) await browserInstance.close().catch(() => { });
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
