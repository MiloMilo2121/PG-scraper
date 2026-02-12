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
 *   0. CategoryMatcher (GPT) resolves the query to ALL matching PG categories
 *   1. Pre-Flight: Check PG result count per (category, province code)
 *   2. If >200: GPT-4o-mini splits province into 5 equidistant municipalities
 *   3. Scrape PG for each (category, location) — full pagination
 *   4. Scrape Google Maps for each (category, location) — scroll to load all
 *   5. Dedup + Merge + CSV Output
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createObjectCsvWriter } from 'csv-writer';
import { Page } from 'puppeteer';
import { BrowserFactory } from './core/browser/factory_v2';
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
const PG_OVERFLOW_THRESHOLD = 200;
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
function parseCLI(): { query: string; provinceCodes: string[] } {
    const args = process.argv.slice(2);

    const queryArg = args.find(a => a.startsWith('--query='))?.split('=').slice(1).join('=');
    const provincesArg = args.find(a => a.startsWith('--provinces='))?.split('=').slice(1).join('=');

    if (!queryArg || !provincesArg) {
        console.error('Usage: npx ts-node src/scraper/generate_campaign_v2.ts --query="manifattura" --provinces="LO,MI,BS"');
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

    return { query: queryArg.trim(), provinceCodes };
}

/**
 * Resolve province code to the full name for Maps (Maps needs full names).
 */
function resolveProvinceName(code: string): string {
    return PROVINCE_CODES[code] || code;
}

// ─── PHASE 1: PRE-FLIGHT INTEL ──────────────────────────────────────────────
async function preFlightCheck(
    page: Page,
    categories: string[],
    provinces: string[]
): Promise<ScrapeTarget[]> {
    const targets: ScrapeTarget[] = [];

    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`📡 PHASE 1: PRE-FLIGHT INTELLIGENCE`);
    Logger.info(`${'═'.repeat(60)}`);

    for (const province of provinces) {
        for (const category of categories) {
            Logger.info(`\n🔍 Checking: "${category}" in ${province}...`);

            const pgUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(category)}/${encodeURIComponent(province)}`;

            try {
                await page.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // 🛡️ CAPTCHA CHECK
                if (await CaptchaSolver.neutralizeGatekeeper(page)) {
                    Logger.info(`   🔓 Captcha solved for ${category}/${province}. Reloading...`);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                }

                await CookieConsent.handle(page);

                // Parse total count
                const countText = await page.evaluate(() => {
                    const el = document.querySelector('.listing-res__numresults span') ||
                        document.querySelector('.search-ind__res') ||
                        document.querySelector('.listingresults__numresults span');
                    return el ? el.textContent : '0';
                });

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
                }

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
            }

            await delay(1500);
        }
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
        const url = `https://www.paginegialle.it/ricerca/${encodeURIComponent(target.category)}/${encodeURIComponent(target.location)}/p-${pageNum}`;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 🛡️ CAPTCHA CHECK
            if (await CaptchaSolver.neutralizeGatekeeper(page)) {
                Logger.info(`   🔓 Captcha solved for page ${pageNum}. Reloading...`);
                await page.reload({ waitUntil: 'domcontentloaded' });
            }

            const items = await page.evaluate((loc, cat, prov) => {
                return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                    const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                    const tel = item.querySelector('.search-itm__phone')?.textContent?.trim();
                    const web = item.querySelector('.search-itm__url')?.getAttribute('href');
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
            }, target.location, target.category, target.province);

            if (items.length === 0) {
                Logger.info(`   📄 PG: Page ${pageNum} empty. Done.`);
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
    const { query, provinceCodes } = parseCLI();

    Logger.info(`\n${'═'.repeat(60)}`);
    Logger.info(`🚀 CAMPAIGN GENERATOR V2 — INTELLIGENT MODE`);
    Logger.info(`🔍 Query: "${query}"`);
    Logger.info(`📍 Provinces: [${provinceCodes.map(c => `${c} (${resolveProvinceName(c)})`).join(', ')}]`);
    Logger.info(`${'═'.repeat(60)}\n`);

    // PHASE 0: CATEGORY INTELLIGENCE
    Logger.info(`${'═'.repeat(60)}`);
    Logger.info(`🧠 PHASE 0: CATEGORY INTELLIGENCE`);
    Logger.info(`${'═'.repeat(60)}`);

    const categories = await CategoryMatcher.match(query);

    if (categories.length === 0) {
        Logger.error(`❌ No PG categories matched for "${query}". Aborting.`);
        return;
    }

    Logger.info(`✅ Resolved "${query}" → ${categories.length} PG categories`);
    Logger.info(`📋 Categories: [${categories.join(', ')}]\n`);

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const browserFactory = BrowserFactory.getInstance();
    const page = await browserFactory.newPage();
    const globalDedup = new Deduplicator();
    const allCompanies: CompanyInput[] = [];

    try {
        // PHASE 1: Pre-Flight (using province CODES for PG URLs)
        const targets = await preFlightCheck(page, categories, provinceCodes);

        if (targets.length === 0) {
            Logger.warn('⚠️ No targets generated. Check categories and provinces.');
            return;
        }

        // PHASE 2 + 3: Scrape each target
        Logger.info(`\n${'═'.repeat(60)}`);
        Logger.info(`🔥 PHASE 2+3: SCRAPING (${targets.length} targets)`);
        Logger.info(`${'═'.repeat(60)}\n`);

        for (const [idx, target] of targets.entries()) {
            Logger.info(`\n┌── TARGET ${idx + 1}/${targets.length}: [${target.category}] ${target.location}`);

            // PG
            const pgResults = await scrapePG(page, target, globalDedup);
            allCompanies.push(...pgResults);

            await delay(PG_LOCATION_DELAY_MS);

            // Maps
            const { newCount } = await scrapeMaps(page, target, globalDedup);
            // newCount items are already in dedup but not in allCompanies array
            // We'll rebuild final list from dedup at the end

            Logger.info(`└── DONE: ${pgResults.length} PG + ${newCount} new Maps | Running total: ${globalDedup.count}`);

            await delay(2000);
        }

        // PHASE 4: Final output
        const finalList = globalDedup.getAll();

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
        await browserFactory.close();
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
