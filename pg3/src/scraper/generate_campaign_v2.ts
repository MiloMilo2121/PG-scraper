/**
 * 🚀 CAMPAIGN GENERATOR V2
 * 
 * INTELLIGENT Input-driven PG + Maps scraping pipeline.
 * 
 * Usage:
 *   npx ts-node src/scraper/generate_campaign_v2.ts \
 *     --query="manifattura" \
 *     --provinces="LO,MI,BS" \
 *     --limit=100
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
import { parse as parseCsv } from 'csv-parse/sync';
import pLimit from 'p-limit';
import { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { Mutex } from 'async-mutex';
// BrowserFactory BYPASSED: its newPage() initialization pipeline (GeneticFingerprinter,
// BrowserEvasion, ProxyManager, CookieConsent) detaches the page frame on the server.
// Raw puppeteer.launch() works perfectly (confirmed by diagnostic).
import { Deduplicator } from './utils/deduplicator';
import { CompanyInput } from './types';
import { MapsGridProvider } from './providers/maps_grid_provider';
import { ImmobiliareAgencyProvider } from './providers/immobiliare_agencies';
import { MunicipalitySplitter } from './ai/municipality_splitter';
import { CategoryMatcher } from './ai/category_matcher';
import { CaptchaSolver } from '../shared-runtime/security/CaptchaSolver';
import { PROVINCE_CODES, PROVINCE_NAME_TO_CODE } from './data/pg_categories';
import { Logger } from './utils/logger';
import { CookieConsent } from './core/browser/cookie_consent';

dotenv.config();

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PG_OVERFLOW_THRESHOLD = 199;
const MAX_PG_PAGES = 8;       // PG shows ~25/page, 8 pages = 200 max per location
const PG_PAGE_DELAY_MS = 2000; // Respect rate limits (Law 305)
const PG_LOCATION_DELAY_MS = 3000;
const OUTPUT_DIR = 'output/campaigns';
const BLOCKED_WEBSITE_HOSTS = [
    'google.com',
    'google.it',
    'gstatic.com',
    'googleadservices.com',
    'doubleclick.net'
];
const TRACKING_QUERY_KEYS = new Set([
    'gclid',
    'fbclid',
    'msclkid',
    'igshid',
    'mc_cid',
    'mc_eid'
]);
const DEFAULT_SCRAPER_TARGET_CONCURRENCY = resolveParallelism(
    process.env.SCRAPER_TARGET_CONCURRENCY || process.env.CONCURRENCY_LIMIT,
    4,
    8
);
const DEFAULT_PREFLIGHT_CONCURRENCY = resolveParallelism(
    process.env.SCRAPER_PREFLIGHT_CONCURRENCY || process.env.SCRAPER_TARGET_CONCURRENCY || process.env.CONCURRENCY_LIMIT,
    Math.min(DEFAULT_SCRAPER_TARGET_CONCURRENCY, 4),
    6
);

function compactText(value?: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;

    const raw = Array.isArray(value)
        ? value.flat(Infinity).map((part) => String(part ?? '')).join(' ')
        : String(value);

    const cleaned = raw
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > 0 ? cleaned : undefined;
}

function resolveParallelism(rawValue: string | undefined, fallback: number, upperBound: number): number {
    const parsed = Number.parseInt(rawValue || '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.max(1, Math.min(parsed, upperBound));
}

function sanitizeCompanyName(value?: string): string | undefined {
    const cleaned = compactText(value);
    if (!cleaned) return undefined;
    return cleaned.replace(/\s+\|\s+/g, ' - ');
}

function isBlockedHost(hostname: string): boolean {
    return BLOCKED_WEBSITE_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
}

function normalizeWebsite(raw?: string): string | undefined {
    let candidate = compactText(raw);
    if (!candidate) return undefined;

    // Drop non-http navigations immediately.
    if (/^(mailto:|tel:|javascript:)/i.test(candidate)) return undefined;

    candidate = candidate
        .replace(/^<|>$/g, '')
        .replace(/&amp;/g, '&')
        .replace(/[)\],.;]+$/g, '');

    // Relative Google redirect links from SERP/maps cards.
    if (candidate.startsWith('/url?') || candidate.startsWith('/aclk?')) {
        try {
            const googleRedirect = new URL(`https://www.google.com${candidate}`);
            const target = googleRedirect.searchParams.get('q') || googleRedirect.searchParams.get('url');
            candidate = target || '';
        } catch {
            return undefined;
        }
        if (!candidate) return undefined;
    }

    if (!/^https?:\/\//i.test(candidate)) {
        candidate = `https://${candidate}`;
    }

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return undefined;
    }

    // Unwrap absolute Google redirect URLs.
    if (url.hostname.includes('google.') && url.pathname.startsWith('/url')) {
        const target = url.searchParams.get('q') || url.searchParams.get('url');
        if (!target) return undefined;
        try {
            url = new URL(target);
        } catch {
            return undefined;
        }
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname || !hostname.includes('.')) return undefined;
    if (isBlockedHost(hostname)) return undefined;
    if (url.pathname.startsWith('/aclk')) return undefined;

    // Remove common tracking params but keep functional query keys.
    const filtered = new URLSearchParams();
    for (const [key, val] of url.searchParams.entries()) {
        const lowKey = key.toLowerCase();
        if (lowKey.startsWith('utm_') || TRACKING_QUERY_KEYS.has(lowKey)) continue;
        filtered.append(key, val);
    }
    url.search = filtered.toString() ? `?${filtered.toString()}` : '';
    url.hash = '';

    return url.toString();
}

function sanitizeCompanyRecord(company: CompanyInput): CompanyInput | null {
    const companyName = sanitizeCompanyName(company.company_name);
    if (!companyName) return null;

    return {
        ...company,
        company_name: companyName,
        city: compactText(company.city),
        province: compactText(company.province),
        zip_code: compactText(company.zip_code),
        region: compactText(company.region),
        address: compactText(company.address),
        phone: compactText(company.phone),
        website: normalizeWebsite(company.website),
        category: compactText(company.category),
        source: compactText(company.source),
        vat_code: compactText(company.vat_code),
        pg_url: compactText(company.pg_url),
    };
}

function isRecordEligible(company: CompanyInput): boolean {
    const hasWebsite = !!company.website;
    const phoneDigits = (company.phone || '').replace(/\D/g, '');
    const hasPhone = phoneDigits.length >= 6;
    const hasAddress = !!company.address && company.address.length >= 6;
    const hasVat = !!(company.vat_code || company.piva || company.vat);

    return hasWebsite || (hasPhone && hasAddress) || (hasVat && (hasPhone || hasAddress));
}

function sanitizeCompanyBatch(companies: CompanyInput[]): CompanyInput[] {
    const sanitized: CompanyInput[] = [];
    for (const company of companies) {
        const cleaned = sanitizeCompanyRecord(company);
        if (cleaned) sanitized.push(cleaned);
    }
    return sanitized;
}

const BASE_CAMPAIGN_HEADERS = [
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
];

const IMMOBILIARE_CAMPAIGN_HEADERS = [
    { id: 'immobiliare_url', title: 'immobiliare_url' },
    { id: 'portal_association', title: 'portal_association' },
    { id: 'portal_years_on_immobiliare', title: 'portal_years_on_immobiliare' },
    { id: 'portal_quality_score', title: 'portal_quality_score' },
    { id: 'portal_announcements', title: 'portal_announcements' },
    { id: 'portal_description', title: 'portal_description' },
];

function buildCampaignHeaders(includeImmobiliare: boolean) {
    return includeImmobiliare
        ? [...BASE_CAMPAIGN_HEADERS, ...IMMOBILIARE_CAMPAIGN_HEADERS]
        : BASE_CAMPAIGN_HEADERS;
}

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface ScrapeTarget {
    category: string;
    location: string;
    province: string;
    isMunicipality: boolean;
    pgResultCount: number;
}

// ─── CLI PARSING ─────────────────────────────────────────────────────────────
export interface CampaignCliOptions {
    query: string;
    provinceCodes: string[];
    resume: boolean;
    checkpointFile: string;
    limit?: number;
    includeImmobiliare: boolean;
}

export function parseCLIArgs(args: string[]): CampaignCliOptions {

    const queryArg = args.find(a => a.startsWith('--query='))?.split('=').slice(1).join('=');
    const provincesArg = args.find(a => a.startsWith('--provinces='))?.split('=').slice(1).join('=');
    const resume = args.includes('--resume');
    const checkpointArg = args.find(a => a.startsWith('--checkpoint-file='))?.split('=').slice(1).join('=');
    const limitArg = args.find(a => a.startsWith('--limit='))?.split('=').slice(1).join('=');
    const includeImmobiliare = args.includes('--include-immobiliare');

    if (!queryArg || !provincesArg) {
        throw new Error('Missing required --query or --provinces argument');
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

    let limit: number | undefined;
    if (limitArg !== undefined) {
        const parsedLimit = Number.parseInt(limitArg, 10);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
            throw new Error(`Invalid --limit value "${limitArg}" (expected a positive integer)`);
        }
        limit = parsedLimit;
    }

    const checkpointFile = checkpointArg?.trim() || path.join(OUTPUT_DIR, 'campaign_INTERIM_CHECKPOINT.csv');

    return { query: queryArg.trim(), provinceCodes, resume, checkpointFile, limit, includeImmobiliare };
}

function parseCLI(): CampaignCliOptions {
    try {
        return parseCLIArgs(process.argv.slice(2));
    } catch (error) {
        console.error('Usage: npx ts-node src/scraper/generate_campaign_v2.ts --query="manifattura" --provinces="LO,MI,BS" [--limit=100] [--resume] [--checkpoint-file="output/campaigns/campaign_INTERIM_CHECKPOINT.csv"] [--include-immobiliare]');
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
    }
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
let activeSessions = 0;
const browserLaunchMutex = new Mutex();
const checkpointMutex = new Mutex();

export interface BrowserSession {
    page: Page;
    context: BrowserContext;
}

async function getBrowser(): Promise<Browser> {
    return browserLaunchMutex.runExclusive(async () => {
        if (browserInstance && browserInstance.isConnected()) {
            return browserInstance;
        }

        Logger.info(`[Browser] 🔄 Launching shared browser (Sessions served: ${targetsCount})...`);
        targetsCount = 0;
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // 🔑 CRITICAL for server stability
                '--ignore-certificate-errors',
            ],
            executablePath: process.env.CHROME_BIN || process.env.CHROME_PATH || undefined,
        });
        return browserInstance;
    });
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
            activeSessions++;
            return { page, context };
        } catch (e) {
            lastError = e as Error;
            Logger.warn(`[Browser] ⚠️ setupPage failed (Attempt ${i + 1}/${maxRetries}): ${lastError.message}`);
            await delay(2000 * (i + 1));
        }
    }

    throw new Error(`Failed to setup page after ${maxRetries} attempts. Last error: ${lastError?.message}`);
}

async function closeSession(session: BrowserSession | null): Promise<void> {
    if (!session) {
        return;
    }

    await session.page.close().catch(() => { });
    await session.context.close().catch(() => { });
    activeSessions = Math.max(0, activeSessions - 1);
}

async function flushInterimCheckpoint(interimFile: string, dedup: Deduplicator, includeImmobiliare: boolean): Promise<void> {
    const interimList = dedup.getAll();
    if (interimList.length === 0) {
        return;
    }

    await checkpointMutex.runExclusive(async () => {
        const interimWriter = createObjectCsvWriter({
            path: interimFile,
            header: buildCampaignHeaders(includeImmobiliare)
        });
        await interimWriter.writeRecords(interimList);
        Logger.info(`💾 Interim Checkpoint: ${interimFile} (${interimList.length} companies)`);
    });
}

function shouldSkipTargetOnResume(target: ScrapeTarget, dedup: Deduplicator): boolean {
    const existing = dedup
        .getAll()
        .filter(c => c.category === target.category && (c.city === target.location || c.province === target.location));
    return existing.length > 5;
}

async function preFlightSingle(category: string, province: string): Promise<ScrapeTarget[]> {
    let session: BrowserSession | null = null;
    try {
        session = await setupPage();
        const page = session.page;

        Logger.info(`\n🔍 Checking: "${category}" in ${province}...`);

        const pgLocation = pgProvinceName(province);
        const pgUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(category)}/${encodeURIComponent(pgLocation)}`;

        await page.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (await CaptchaSolver.neutralizeGatekeeper(page)) {
            Logger.info(`   🔓 Captcha solved for ${category}/${province}. Reloading...`);
            await page.reload({ waitUntil: 'domcontentloaded' });
        }

        await CookieConsent.handle(page);
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });

        await Promise.race([
            page.waitForSelector('.search-itm', { state: 'attached', timeout: 15000 }),
            page.waitForSelector('.no-result', { state: 'attached', timeout: 15000 }),
            page.waitForSelector('.listing-res__numresults span', { state: 'attached', timeout: 15000 }),
            page.waitForSelector('.search-ind__res', { state: 'attached', timeout: 15000 }),
            page.waitForSelector('.listingresults__numresults span', { state: 'attached', timeout: 15000 }),
        ]).catch(() => {
            Logger.warn(`   ⚠️ Pre-flight wait timed out for ${category}/${province}. Attempting DOM read anyway.`);
        });

        let countText = '0';
        try {
            countText = await page.evaluate(() => {
                const candidates = [
                    '.listing-res__numresults span',
                    '.listing-res__numresults',
                    '.search-ind__res',
                    '.listingresults__numresults span',
                    '.listingresults__numresults',
                    '[class*="numresults"]',
                ];

                for (const selector of candidates) {
                    const el = document.querySelector(selector);
                    const text = el?.textContent?.trim();
                    if (text && /\d/.test(text)) {
                        return text;
                    }
                }

                return '0';
            }) || '0';
        } catch (e) {
            const msg = (e as Error).message;
            if (msg.includes('detached') || msg.includes('destroyed')) {
                Logger.warn(`   ⚠️ Frame detached during pre-flight for ${category}/${province}. Retrying...`);
                await delay(1000);
                countText = await page.evaluate(() => {
                    const candidates = [
                        '.listing-res__numresults span',
                        '.listing-res__numresults',
                        '.search-ind__res',
                        '.listingresults__numresults span',
                        '.listingresults__numresults',
                        '[class*="numresults"]',
                    ];

                    for (const selector of candidates) {
                        const el = document.querySelector(selector);
                        const text = el?.textContent?.trim();
                        if (text && /\d/.test(text)) {
                            return text;
                        }
                    }

                    return '0';
                }) || '0';
            } else {
                throw e;
            }
        }

        const visibleListings = await page.locator('.search-itm').count().catch(() => 0);
        let totalResults = parseInt(countText?.replace(/\./g, '').replace(/[^\d]/g, '') || '0', 10);
        if (totalResults === 0 && visibleListings > 0) {
            totalResults = visibleListings;
            Logger.warn(`   ⚠️ Count selector returned 0 for ${category}/${province}, but ${visibleListings} listings are visible. Using visible count as lower bound.`);
        }
        Logger.info(`   📊 PG Results: ${totalResults}`);

        if (totalResults > PG_OVERFLOW_THRESHOLD) {
            Logger.info(`   🚨 OVERFLOW (>${PG_OVERFLOW_THRESHOLD})! Splitting by municipality...`);

            const municipalities = await MunicipalitySplitter.getMunicipalities(province);
            Logger.info(`   🏘️ Split municipalities: [${municipalities.join(', ')}]`);

            if (municipalities.length < 2) {
                Logger.warn(`   ⚠️ Splitter returned fewer than 2 municipalities for ${province}. Falling back to province-wide scrape.`);
                return [{
                    category,
                    location: province,
                    province,
                    isMunicipality: false,
                    pgResultCount: totalResults,
                }];
            }

            const splitTargets: ScrapeTarget[] = [];
            for (const muni of municipalities) {
                const municipalityName = compactText(muni);
                if (!municipalityName) {
                    Logger.warn(`   ⚠️ Skipping invalid municipality for ${province}: ${String(muni)}`);
                    continue;
                }

                splitTargets.push({
                    category,
                    location: municipalityName,
                    province,
                    isMunicipality: true,
                    pgResultCount: totalResults,
                });
            }
            return splitTargets;
        }

        if (totalResults > 0) {
            return [{
                category,
                location: province,
                province,
                isMunicipality: false,
                pgResultCount: totalResults,
            }];
        }

        Logger.warn(`   ⚠️ 0 results parsed for "${category}" in ${province}. Proceeding with province scrape (Fallback).`);
        return [{
            category,
            location: province,
            province,
            isMunicipality: false,
            pgResultCount: -1,
        }];
    } catch (error) {
        Logger.error(`   ❌ Pre-flight failed for ${category}/${province}: ${(error as Error).message}`);
        return [{
            category,
            location: province,
            province,
            isMunicipality: false,
            pgResultCount: -1,
        }];
    } finally {
        await closeSession(session);
    }
}

// ─── PHASE 1: PRE-FLIGHT INTEL ──────────────────────────────────────────────
async function preFlightCheck(
    // No browser arg needed, uses singleton
    categories: string[],
    provinces: string[]
): Promise<ScrapeTarget[]> {
    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`📡 PHASE 1: PRE-FLIGHT INTELLIGENCE`);
    Logger.info(`${'═'.repeat(60)}`);
    Logger.info(`⚙️ Pre-flight concurrency: ${DEFAULT_PREFLIGHT_CONCURRENCY}`);

    const limit = pLimit(DEFAULT_PREFLIGHT_CONCURRENCY);
    const jobs: Array<Promise<ScrapeTarget[]>> = [];

    for (const province of provinces) {
        for (const category of categories) {
            jobs.push(limit(async () => {
                const result = await preFlightSingle(category, province);
                await delay(1500);
                return result;
            }));
        }
    }

    const targetGroups = await Promise.all(jobs);
    const targets = targetGroups.flat();

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
                    const sanitize = (val?: string | null) => val ? val.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : '';

                    return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                        const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                        const tel = sanitize(item.querySelector('.search-itm__phone')?.textContent);

                        // Enhanced Website Extraction
                        // 1. Standard web icon/link
                        let web = item.querySelector('.search-itm__url')?.getAttribute('href') ||
                            item.querySelector('a[href^="http"]:not([href*="paginegialle.it"])')?.getAttribute('href') ||
                            item.querySelector('.search-itm__rag a')?.getAttribute('href');

                        // 2. Data attributes
                        if (!web || web.includes('javascript')) {
                            web = item.getAttribute('data-url') || item.getAttribute('data-href');
                        }

                        const pgUrl = (item.querySelector('a.remove_blank_for_app') as HTMLAnchorElement | null)?.href;

                        const adr = item.querySelector('.search-itm__adr') as HTMLElement | null;
                        const rawAddr = sanitize(adr?.textContent);

                        const region = sanitize(adr?.querySelector('div')?.textContent) || undefined;
                        const spans = adr ? Array.from(adr.querySelectorAll('span')).map(s => sanitize(s.textContent)).filter(Boolean) : [];
                        const street = spans[0] || '';
                        const zip = spans[1] || undefined;
                        const cityName = spans[2] || undefined;
                        const provMatch = rawAddr ? rawAddr.match(/\(([A-Z]{2})\)/) : null;
                        const province = provMatch?.[1] || prov;

                        if (!name) return null;
                        return {
                            company_name: sanitize(name),
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

                items = sanitizeCompanyBatch(items);
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

    const rawMapsResults = await MapsGridProvider.scrapeAll(page, target.category, target.location);
    const mapsResults = sanitizeCompanyBatch(rawMapsResults);

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

async function scrapeImmobiliareLane(
    target: ScrapeTarget,
    dedup: Deduplicator
): Promise<{ newCount: number; mergedCount: number; skipped: boolean }> {
    const provinceName = resolveProvinceName(target.province);

    try {
        const browser = await getBrowser();
        const immobiliareResults = await ImmobiliareAgencyProvider.scrapeProvince(browser, provinceName, target.province, {
            includeDetails: true,
        });
        const sanitized = sanitizeCompanyBatch(immobiliareResults);

        if (sanitized.length === 0) {
            Logger.warn(`[Immobiliare] ${provinceName}: source unavailable, empty, or challenged. Skipping lane.`);
            return { newCount: 0, mergedCount: 0, skipped: true };
        }

        let newCount = 0;
        let mergedCount = 0;

        for (const company of sanitized) {
            if (!company.province) {
                company.province = target.province;
            }

            const existing = dedup.checkDuplicate(company);
            if (existing) {
                dedup.merge(existing, company);
                mergedCount++;
            } else {
                dedup.add(company);
                newCount++;
            }
        }

        Logger.info(`[Immobiliare] ${provinceName}: ${sanitized.length} found → ${newCount} new, ${mergedCount} merged`);
        return { newCount, mergedCount, skipped: false };
    } catch (error) {
        Logger.warn(`[Immobiliare] ${provinceName}: lane skipped (${(error as Error).message})`);
        return { newCount: 0, mergedCount: 0, skipped: true };
    }
}

// ─── PROGRAMMATIC ENTRYPOINT ────────────────────────────────────────────────
export interface CampaignResult {
    count: number;
    combinedCsv?: string;
    perProvinceCsvs: string[];
    byProvince: Record<string, number>;
    droppedInvalid: number;
    droppedLowSignal: number;
}

/**
 * Programmatic counterpart of main(). Same logic, no process.exit, returns a
 * result object. Invoked by the agent-first entrypoint
 * `src/agent/agent_scraper.ts` and by the legacy CLI wrapper at the bottom of
 * this file.
 */
export async function runCampaignProgrammatic(
    opts: CampaignCliOptions & { outputDir?: string }
): Promise<CampaignResult> {
    const { query, provinceCodes, resume, checkpointFile, limit: maxCompanies, includeImmobiliare } = opts;
    const effectiveOutputDir = opts.outputDir ?? OUTPUT_DIR;
    const interimFile = checkpointFile;
    const useImmobiliareLane = includeImmobiliare && /immobil/i.test(query.toLowerCase());

    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`🚀 CAMPAIGN GENERATOR V2 — INTELLIGENT MODE`);
    Logger.info(`🔍 Query: "${query}"`);
    Logger.info(`📍 Provinces: [${provinceCodes.map(c => `${c} (${resolveProvinceName(c)})`).join(', ')}]`);
    if (typeof maxCompanies === 'number') Logger.info(`🎯 Limit Mode: max ${maxCompanies} companies`);
    if (resume) Logger.info(`🔄 Resume Mode: ACTIVE (Using ${checkpointFile} if available)`);
    Logger.info(`🏢 Immobiliare lane: ${useImmobiliareLane ? 'ACTIVE' : includeImmobiliare ? 'requested but skipped for this query' : 'off'}`);
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
        return {
            count: 0,
            perProvinceCsvs: [],
            byProvince: {},
            droppedInvalid: 0,
            droppedLowSignal: 0,
        };
    }

    Logger.info(`✅ Resolved "${query}" → ${categories.length} PG categories`);
    Logger.info(`📋 Categories: [${categories.join(', ')}]\n`);

    if (!fs.existsSync(effectiveOutputDir)) fs.mkdirSync(effectiveOutputDir, { recursive: true });

    // 🔑 DIRECT BROWSER LAUNCH managed by getBrowser() helper
    Logger.info('[Browser] 🚀 Initializing browser...');
    await getBrowser();
    Logger.info('[Browser] ✅ Browser ready');

    const globalDedup = new Deduplicator();
    const allCompanies: CompanyInput[] = [];
    const immobiliareProcessedProvinces = new Set<string>();

    // Load existing data if resuming
    if (resume) {
        if (fs.existsSync(interimFile)) {
            Logger.info(`🔄 Resume: Loading existing data from ${interimFile}...`);
            const content = fs.readFileSync(interimFile, 'utf-8');
            const rows = parseCsv(content, {
                columns: true,
                skip_empty_lines: true,
                bom: true,
                relax_quotes: true,
            }) as Record<string, string>[];

            for (const row of rows) {
                const company = sanitizeCompanyRecord({
                    company_name: row.company_name || '',
                    city: row.city,
                    province: row.province,
                    zip_code: row.zip_code,
                    region: row.region,
                    address: row.address,
                    phone: row.phone,
                    website: row.website,
                    category: row.category,
                    source: row.source,
                    vat_code: row.vat_code,
                    pg_url: row.pg_url,
                } as CompanyInput);

                if (company) {
                    globalDedup.add(company);
                }
            }
            Logger.info(`🔄 Resume: ${globalDedup.count} records restored.`);
        }
    }

    try {
        // PHASE 1: Pre-Flight (using province CODES for PG URLs)
        const targets = await preFlightCheck(categories, provinceCodes);

        if (targets.length === 0) {
            Logger.warn('⚠️ No targets generated. Check categories and provinces.');
            return {
                count: 0,
                perProvinceCsvs: [],
                byProvince: {},
                droppedInvalid: 0,
                droppedLowSignal: 0,
            };
        }

        // PHASE 2 + 3: Scrape each target
        Logger.info(`\n${'═'.repeat(60)}`);
        Logger.info(`🔥 PHASE 2+3: SCRAPING (${targets.length} targets)`);
        Logger.info(`${'═'.repeat(60)}\n`);
        Logger.info(`⚙️ Target concurrency: ${DEFAULT_SCRAPER_TARGET_CONCURRENCY}`);

        const targetLimiter = pLimit(DEFAULT_SCRAPER_TARGET_CONCURRENCY);
        let limitReachedLogged = false;
        await Promise.all(targets.map((target, idx) => targetLimiter(async () => {
            if (typeof maxCompanies === 'number' && globalDedup.count >= maxCompanies) {
                if (!limitReachedLogged) {
                    limitReachedLogged = true;
                    Logger.info(`⏭️ Limit reached (${globalDedup.count}/${maxCompanies}). Skipping remaining queued targets.`);
                }
                return;
            }

            if (resume && globalDedup.count > 0 && shouldSkipTargetOnResume(target, globalDedup)) {
                Logger.info(`⏭️ Skipping Target ${idx + 1}/${targets.length}: [${target.category}] ${target.location} (Already in dedup)`);
                return;
            }

            let session: BrowserSession | null = null;
            try {
                session = await setupPage();
                Logger.info(`\n┌── TARGET ${idx + 1}/${targets.length}: [${target.category}] ${target.location}`);

                const pgResults = await scrapePG(session.page, target, globalDedup);
                allCompanies.push(...pgResults);

                await delay(PG_LOCATION_DELAY_MS);

                if (useImmobiliareLane && !immobiliareProcessedProvinces.has(target.province)) {
                    immobiliareProcessedProvinces.add(target.province);
                    const immobiliareResult = await scrapeImmobiliareLane(target, globalDedup);
                    if (immobiliareResult.skipped) {
                        Logger.info(`   🏢 Immobiliare: skipped for ${resolveProvinceName(target.province)}`);
                    }
                    await delay(1500);
                }

                const { newCount } = await scrapeMaps(session.page, target, globalDedup);
                Logger.info(`└── DONE: ${pgResults.length} PG + ${newCount} new Maps | Running total: ${globalDedup.count}`);
            } catch (error) {
                Logger.error(`└── FAILED: [${target.category}] ${target.location} → ${(error as Error).message}`);
            } finally {
                await closeSession(session);
            }

            await flushInterimCheckpoint(interimFile, globalDedup, useImmobiliareLane);
        })));

        // PHASE 4: Final output + quality gate
        const rawFinalList = globalDedup.getAll();
        let droppedInvalid = 0;
        const normalizedFinalList: CompanyInput[] = [];

        for (const company of rawFinalList) {
            const cleaned = sanitizeCompanyRecord(company);
            if (!cleaned) {
                droppedInvalid++;
                continue;
            }
            normalizedFinalList.push(cleaned);
        }

        let finalList = normalizedFinalList; // Quality Gate DISATTIVATO per prendere tutto
        const droppedLowSignal = normalizedFinalList.length - finalList.length;
        const totalDropped = droppedInvalid + droppedLowSignal;
        if (totalDropped > 0) {
            Logger.info(`🧹 Quality Gate: removed ${totalDropped} rows (invalid=${droppedInvalid}, low_signal=${droppedLowSignal})`);
        }

        if (typeof maxCompanies === 'number' && finalList.length > maxCompanies) {
            const beforeTrim = finalList.length;
            finalList = finalList.slice(0, maxCompanies);
            Logger.info(`✂️ Limit Mode: trimming eligible list from ${beforeTrim} to ${finalList.length}`);
        }

        if (finalList.length === 0) {
            Logger.warn('\n⚠️  SCRAPING FINISHED BUT NO COMPANIES FOUND.');
            Logger.warn('   This usually means all targets returned 0 results or browser crashes were systematic.');
            throw new Error('Campaign generation produced zero companies');
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

        const perProvinceCsvs: string[] = [];
        const byProvinceCounts: Record<string, number> = {};

        for (const [prov, companies] of byProvince) {
            const filename = `campaign_${prov.toLowerCase()}_${timestamp}.csv`;
            const filepath = path.join(effectiveOutputDir, filename);

            const csvWriter = createObjectCsvWriter({
                path: filepath,
                header: buildCampaignHeaders(useImmobiliareLane)
            });

            await csvWriter.writeRecords(companies);
            Logger.info(`💾 Saved: ${filepath} (${companies.length} companies)`);
            perProvinceCsvs.push(filepath);
            byProvinceCounts[prov] = companies.length;
        }

        // Also save a combined CSV
        const combinedFile = path.join(effectiveOutputDir, `campaign_COMBINED_${timestamp}.csv`);
        const combinedWriter = createObjectCsvWriter({
            path: combinedFile,
            header: buildCampaignHeaders(useImmobiliareLane)
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

        return {
            count: finalList.length,
            combinedCsv: combinedFile,
            perProvinceCsvs,
            byProvince: byProvinceCounts,
            droppedInvalid,
            droppedLowSignal,
        };

    } finally {
        if (browserInstance) await browserInstance.close().catch(() => { });
    }
}

// ─── MAIN (CLI entrypoint, kept for back-compat) ────────────────────────────
async function main() {
    const opts = parseCLI();
    try {
        await runCampaignProgrammatic(opts);
    } catch (error) {
        Logger.error(`💀 FATAL: ${(error as Error).message}`);
        process.exit(1);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

if (require.main === module) {
    main().catch(e => {
        console.error('Fatal:', e);
        process.exit(1);
    });
}
