/**
 * 💰 FINANCIAL SERVICE v2
 * P.IVA CONDITIONAL LOGIC
 * 
 * Flow:
 *   IF (P.IVA exists) → Google "piva {vat} ufficiocamerale" → Scrape with CaptchaSolver
 *   ELSE → Google "{nome} {città} fatturato" → Scrape secondary portals
 */

import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../../types';
import OpenAI from 'openai';
import { ViesService } from './vies';
import { Logger } from '../../utils/logger';
import { CaptchaSolver } from '../security/captcha_solver';
import { config } from '../../config';
import { PagineGialleHarvester } from '../directories/paginegialle';
import { ScraperClient } from '../../utils/scraper_client';
import * as cheerio from 'cheerio';

export interface FinancialData {
    vat?: string;
    revenue?: string;
    revenueYear?: string;
    employees?: string;
    isEstimatedEmployees: boolean;
    source?: string;
    pec?: string;
}

export class FinancialService {
    private browserFactory: BrowserFactory;
    private openai: OpenAI | null;
    private vies: ViesService;
    private viesCache: Map<string, boolean> = new Map();

    constructor(apiKey?: string) {
        this.browserFactory = BrowserFactory.getInstance();
        const key = (apiKey || config.llm.apiKey || '').trim();
        this.openai = key ? new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true }) : null;
        if (!this.openai) {
            Logger.info('[Financial] OPENAI_API_KEY missing - employee estimation disabled');
        }
        this.vies = new ViesService();
    }

    // =========================================================================
    // 💰 MAIN ENRICHMENT ENTRY POINT
    // =========================================================================
    async enrich(company: CompanyInput, websiteUrl?: string): Promise<FinancialData> {
        const data: FinancialData = { isEstimatedEmployees: false };
        let validVat: string | undefined;
        let websiteSignals: { vat?: string; pec?: string } | null = null;

        // =====================================================================
        // PHASE 1: VAT DISCOVERY
        // =====================================================================

        // 1A. Check if company already has P.IVA
        const existingVatRaw = (company as any).vat_code || (company as any).piva || (company as any).fiscal_code;
        const existingVat = typeof existingVatRaw === 'string' ? existingVatRaw.replace(/\D/g, '') : '';
        if (existingVat && /^\d{11}$/.test(existingVat)) {
            Logger.info(`[Financial] 🎯 P.IVA present in input: ${existingVat}`);
            if (this.viesCache.has(existingVat)) {
                validVat = existingVat;
                data.source = 'Pre-existing (Cached VIES)';
            } else {
                const check = await this.vies.validateVat(existingVat);
                if (check.isValid) {
                    validVat = existingVat;
                    this.viesCache.set(existingVat, true);
                    data.source = 'Pre-existing + VIES';
                } else {
                    Logger.warn(`[Financial] ⚠️ Input P.IVA failed VIES validation: ${existingVat}`);
                }
            }
        }

        // 1B. Extract from website
        if (!validVat && websiteUrl) {
            websiteSignals = await this.scrapeWebsiteForVatAndPec(websiteUrl);
            if (websiteSignals?.vat) {
                if (this.viesCache.has(websiteSignals.vat)) {
                    validVat = websiteSignals.vat;
                    data.source = 'Website (Cached VIES)';
                } else {
                    const check = await this.vies.validateVat(websiteSignals.vat);
                    if (check.isValid) {
                        validVat = websiteSignals.vat;
                        this.viesCache.set(validVat, true);
                        data.source = 'Website + VIES';
                    }
                }
            }
        }

        // 1C. Directory extraction (PagineGialle phone reverse)
        if (!validVat && company.phone) {
            const pg = await PagineGialleHarvester.harvestByPhone(company);
            const pgVat = (pg?.vat || '').replace(/\D/g, '');
            if (pgVat && /^\d{11}$/.test(pgVat)) {
                if (this.viesCache.has(pgVat)) {
                    validVat = pgVat;
                    data.source = 'PagineGialle (Cached VIES)';
                } else {
                    const check = await this.vies.validateVat(pgVat);
                    if (check.isValid) {
                        validVat = pgVat;
                        this.viesCache.set(pgVat, true);
                        data.source = 'PagineGialle + VIES';
                    } else {
                        Logger.warn(`[Financial] ⚠️ PagineGialle VAT failed VIES validation: ${pgVat}`);
                    }
                }

                // If PG email looks like a PEC, keep it.
                if (!data.pec && pg?.email) {
                    const maybe = pg.email.toLowerCase();
                    if (maybe.includes('@pec.') || maybe.includes('legalmail') || maybe.includes('arubapec') || maybe.includes('postecert') || maybe.includes('registerpec') || maybe.includes('sicurezzapostale') || maybe.includes('pecspeciale') || maybe.includes('cert.') || maybe.includes('cgn.')) {
                        data.pec = maybe;
                    }
                }
            }
        }

        // 1D. Google search for VAT (Scrape.do or proxy-backed; auto-skips when unavailable)
        if (!validVat) {
            const googleVat = await this.googleSearchForVAT(company);
            if (googleVat) {
                validVat = googleVat;
                data.source = 'Google + VIES';
            }
        }

        // =====================================================================
        // PHASE 2: FINANCIAL DATA - CONDITIONAL FLOW
        // =====================================================================

        if (validVat) {
            data.vat = validVat;
            Logger.info(`[Financial] 🎯 P.IVA found: ${validVat}. Targeting UfficioCamerale...`);

            // ✅ P.IVA EXISTS → Target UfficioCamerale directly
            const registryData = await this.scrapeUfficioCameraleDirect(validVat);
            if (registryData.revenue) data.revenue = registryData.revenue;
            if (registryData.employees) data.employees = registryData.employees;

            // Fallback to secondary registries if UfficioCamerale failed
            if (!data.revenue) {
                const fallback = await this.scrapeSecondaryRegistries(validVat);
                if (fallback.revenue) data.revenue = fallback.revenue;
                if (fallback.employees && !data.employees) data.employees = fallback.employees;
            }

        } else {
            Logger.info(`[Financial] ⚠️ No P.IVA found. Searching by name...`);

            // ❌ NO P.IVA → Search by company name via Google
            const nameSearch = await this.googleSearchFinancialsByName(company);
            if (nameSearch.revenue) data.revenue = nameSearch.revenue;
            if (nameSearch.employees) data.employees = nameSearch.employees;
        }

        // =====================================================================
        // PHASE 3: FALLBACK - ReportAziende (Name-based search)
        // =====================================================================
        if (!data.revenue || !data.employees) {
            const raData = await this.scrapeReportAziende(company.company_name, company.city, validVat);
            if (raData) {
                if (!data.revenue && raData.revenue) data.revenue = raData.revenue;
                if (!data.employees && raData.employees) data.employees = raData.employees;
            }
        }

        // =====================================================================
        // PHASE 4: EMPLOYEE ESTIMATION (AI fallback)
        // =====================================================================
        if (!data.employees && websiteUrl && this.openai) {
            data.employees = await this.estimateEmployees(company, websiteUrl);
            if (data.employees) data.isEstimatedEmployees = true;
        }

        // =====================================================================
        // PHASE 5: PEC DISCOVERY
        // =====================================================================
        if (!data.pec && websiteUrl) {
            if (!websiteSignals) {
                websiteSignals = await this.scrapeWebsiteForVatAndPec(websiteUrl);
            }
            if (websiteSignals?.pec) {
                data.pec = websiteSignals.pec;
            }
        }

        // Fallback to Google (via Scrape.do or proxies). Method auto-skips when unavailable.
        if (!data.pec) {
            data.pec = await this.findPecDIY(company.company_name, company.city) || undefined;
        }

        Logger.info(`[Financial] ✅ Enrichment complete for ${company.company_name}: VAT=${data.vat || 'N/A'}, Revenue=${data.revenue || 'N/A'}`);
        return data;
    }

    // =========================================================================
    // P.IVA PATH: Direct UfficioCamerale with CaptchaSolver
    // Now uses direct URL construction + Scrape.do fallback when proxy disabled
    // =========================================================================
    private async scrapeUfficioCameraleDirect(vat: string): Promise<{ revenue?: string; employees?: string }> {
        // Try direct HTTP-based registry scraping first (works with Scrape.do even without proxy)
        const directUrls = [
            `https://www.ufficiocamerale.it/p-iva/IT${vat}`,
            `https://www.ufficiocamerale.it/p-iva/${vat}`,
            `https://www.informazione-aziende.it/Azienda_Partita-IVA-${vat}`,
        ];

        for (const directUrl of directUrls) {
            try {
                const resp = await ScraperClient.fetchHtml(directUrl, { mode: 'auto', render: false, maxRetries: 1, timeoutMs: 15000 });
                const body = typeof resp.data === 'string' ? resp.data : '';
                if (body.length < 500) continue;

                const extracted = this.extractFinancialFromHtml(body);
                if (extracted.revenue || extracted.employees) {
                    Logger.info(`[Financial] Direct registry hit: ${directUrl}`);
                    return extracted;
                }
            } catch {
                // Try next URL
            }
        }

        // Fallback: Google-based search (requires proxy or Scrape.do)
        if (process.env.DISABLE_PROXY === 'true' && !ScraperClient.isScrapeDoEnabled()) {
            Logger.info('[Financial] Proxy disabled and no Scrape.do - direct URLs exhausted for registry lookup');
            return {};
        }

        let page;
        try {
            page = await this.browserFactory.newPage();

            const googleQuery = `"${vat}" site:ufficiocamerale.it OR site:registroimprese.it OR site:informazione-aziende.it`;
            await page.goto(`https://www.google.it/search?q=${encodeURIComponent(googleQuery)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            const firstLink = await page.evaluate(() => {
                // Try multiple selector patterns for Google results
                const selectors = ['#search a', '.g a', 'a[href*="ufficiocamerale"]', 'a[href*="registroimprese"]', 'a[href*="informazione-aziende"]'];
                for (const sel of selectors) {
                    const links = Array.from(document.querySelectorAll(sel));
                    for (const link of links) {
                        const href = (link as HTMLAnchorElement).href;
                        if (href.includes('ufficiocamerale.it') ||
                            href.includes('registroimprese.it') ||
                            href.includes('informazione-aziende.it')) {
                            return href;
                        }
                    }
                }
                return null;
            });

            if (!firstLink) {
                Logger.warn(`[Financial] No registry result for VAT: ${vat}`);
                return {};
            }

            await page.goto(firstLink, { waitUntil: 'domcontentloaded', timeout: 20000 });

            const hasCaptcha = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('captcha') || text.includes('verifica') || text.includes('robot');
            });

            if (hasCaptcha) {
                Logger.info(`[Financial] CAPTCHA detected! Calling neutralizeGatekeeper...`);
                const solved = await CaptchaSolver.neutralizeGatekeeper(page);
                if (!solved) {
                    Logger.warn(`[Financial] CAPTCHA solving failed`);
                    return {};
                }
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
                    new Promise((resolve) => setTimeout(resolve, 3000)),
                ]);
            }

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const result: { revenue?: string; employees?: string } = {};

                const revenuePatterns = [
                    /fatturato\s*(?:\(?\d{4}\)?)?\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                    /ricavi\s*(?:\(?\d{4}\)?)?\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                    /volume\s*d['']affari\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                    /valore\s*della\s*produzione\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                ];

                for (const pattern of revenuePatterns) {
                    const match = text.match(pattern);
                    if (match) {
                        result.revenue = `€ ${match[1]}`;
                        break;
                    }
                }

                const employeePatterns = [
                    /(?:dipendenti|numero\s*dipendenti)\s*(?:\(?\d{4}\)?)?\s*[:\s]*([\d\-\.]+)/i,
                    /organico\s*(?:\(?\d{4}\)?)?\s*[:\s]*([\d\-\.]+)/i,
                    /addetti\s*(?:\(?\d{4}\)?)?\s*[:\s]*([\d\-\.]+)/i,
                    /collaboratori\s*[:\s]*([\d\-\.]+)/i,
                ];

                for (const pattern of employeePatterns) {
                    const match = text.match(pattern);
                    if (match) {
                        result.employees = match[1];
                        break;
                    }
                }

                return result;
            });

        } catch (e: any) {
            Logger.error(`[Financial] UfficioCamerale scrape failed:`, { message: e.message });
            return {};
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private extractFinancialFromHtml(html: string): { revenue?: string; employees?: string } {
        const $ = cheerio.load(html);
        const text = ($('body').text() || '').replace(/\s+/g, ' ').trim();
        const result: { revenue?: string; employees?: string } = {};

        const revenuePatterns = [
            /fatturato\s*(?:\(?\d{4}\)?)?\s*[:\.\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
            /ricavi\s*(?:\(?\d{4}\)?)?\s*[:\.\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
            /volume\s*d['']affari\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
            /valore\s*della\s*produzione\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
        ];
        for (const pattern of revenuePatterns) {
            const match = text.match(pattern);
            if (match) { result.revenue = `€ ${match[1]}`; break; }
        }

        const employeePatterns = [
            /(?:dipendenti|numero\s*dipendenti)\s*(?:\(?\d{4}\)?)?\s*[:\.\s]*([\d\-\.]+)/i,
            /organico\s*(?:\(?\d{4}\)?)?\s*[:\.\s]*([\d\-\.]+)/i,
            /addetti\s*(?:\(?\d{4}\)?)?\s*[:\.\s]*([\d\-\.]+)/i,
        ];
        for (const pattern of employeePatterns) {
            const match = text.match(pattern);
            if (match) { result.employees = match[1]; break; }
        }

        return result;
    }

    // =========================================================================
    // P.IVA PATH: Secondary registries (HTTP-first, browser fallback)
    // =========================================================================
    private async scrapeSecondaryRegistries(vat: string): Promise<{ revenue?: string; employees?: string }> {
        // Try direct HTTP scraping first (faster, works without proxy via Scrape.do)
        const directUrls = [
            `https://www.informazione-aziende.it/Azienda_Partita-IVA-${vat}`,
            `https://www.informazione-aziende.it/Ricerca_Aziende?q=${vat}`,
            `https://www.reportaziende.it/${vat}`,
        ];

        for (const url of directUrls) {
            try {
                const resp = await ScraperClient.fetchHtml(url, { mode: 'auto', render: false, maxRetries: 1, timeoutMs: 12000 });
                const body = typeof resp.data === 'string' ? resp.data : '';
                if (body.length < 300) continue;
                const extracted = this.extractFinancialFromHtml(body);
                if (extracted.revenue || extracted.employees) {
                    Logger.info(`[Financial] Secondary registry hit: ${url}`);
                    return extracted;
                }
            } catch {
                continue;
            }
        }

        // Browser fallback (only if proxy enabled)
        if (process.env.DISABLE_PROXY === 'true') return {};

        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(`https://www.informazione-aziende.it/Ricerca_Aziende?q=${vat}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            const firstResult = await page.$('a[href*="/Azienda_"], a[href*="/impresa"], .search-result a, .company-link');
            if (firstResult) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
                    firstResult.click()
                ]);
            }

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const result: { revenue?: string; employees?: string } = {};

                const revMatch = text.match(/fatturato\s*(?:\(?\d{4}\)?)?\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M)?)/i);
                if (revMatch) result.revenue = `€ ${revMatch[1]}`;

                const empMatch = text.match(/(?:dipendenti|addetti|organico)\s*(?:\(?\d{4}\)?)?\s*[:\s]*([\d\-]+)/i);
                if (empMatch) result.employees = empMatch[1];

                return result;
            });

        } catch (e) {
            Logger.warn('[Financial] Secondary registries scrape failed', { error: e as Error, vat });
            return {};
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // NO P.IVA PATH: Google search by name for financials
    // =========================================================================
    private async googleSearchFinancialsByName(company: CompanyInput): Promise<{ revenue?: string; employees?: string }> {
        if (process.env.DISABLE_PROXY === 'true' && !ScraperClient.isScrapeDoEnabled()) {
            Logger.info('[Financial] 🛡️ Proxy disabled and SCRAPE_DO_TOKEN missing - skipping Google name-based financial search');
            return {};
        }

        const query = `"${company.company_name}" ${company.city || ''} fatturato dipendenti`;
        const googleUrl = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;

        try {
            const html = await ScraperClient.fetchText(googleUrl, {
                mode: 'auto',
                render: true,
                super: true,
                timeoutMs: 20000,
                maxRetries: 1,
            });

            const $ = cheerio.load(html);
            const text = ($('body').text() || '').replace(/\s+/g, ' ');
            const result: { revenue?: string; employees?: string } = {};

            const revMatch = text.match(/fatturato\s*(?:di)?\s*(?:circa)?\s*€?\s*([\d.,]+\s*(?:mln|milioni|mila|euro)?)/i);
            if (revMatch) result.revenue = `€ ${revMatch[1]}`;

            const empMatch = text.match(/(\d+)\s*dipendenti/i);
            if (empMatch) result.employees = empMatch[1];

            if (result.revenue || result.employees) {
                return result;
            }

            // Click-through equivalent: fetch first relevant result link
            const candidates: string[] = [];
            $('a').each((_, el) => {
                let href = ($(el).attr('href') || '').trim();
                if (!href) return;
                if (href.startsWith('/url?q=')) {
                    href = href.split('/url?q=')[1].split('&')[0];
                    try { href = decodeURIComponent(href); } catch { /* ignore */ }
                }
                if (!href.startsWith('http')) return;
                if (href.includes('reportaziende.it') || href.includes('aziende.cc') || href.includes('finanze-aziende.it')) {
                    candidates.push(href);
                }
            });

            if (candidates.length > 0) {
                const target = candidates[0];
                const html2 = await ScraperClient.fetchText(target, { mode: 'auto', render: true, super: true, timeoutMs: 20000, maxRetries: 1 });
                const $2 = cheerio.load(html2);
                const t2 = ($2('body').text() || '').replace(/\s+/g, ' ');

                const rev2 = t2.match(/fatturato\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|m|€)?)/i);
                if (rev2) result.revenue = `€ ${rev2[1]}`;
                const emp2 = t2.match(/dipendenti\s*[:\s]*([\d\-]+)/i);
                if (emp2) result.employees = emp2[1];
            }

            return result;
        } catch (e) {
            Logger.warn('[Financial] Google name-based financial search failed (Scrape.do/HTTP)', {
                error: e as Error,
                company_name: company.company_name,
            });
        }

        // Fallback: Puppeteer (only if proxies are enabled).
        if (process.env.DISABLE_PROXY !== 'true') {
            let page;
            try {
                page = await this.browserFactory.newPage();

                await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

                // Extract from SERP snippets first
                const serpData = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const result: { revenue?: string; employees?: string } = {};

                    // Look for revenue in snippets
                    const revMatch = text.match(/fatturato\s*(?:di)?\s*(?:circa)?\s*€?\s*([\d.,]+\s*(?:mln|milioni|mila|euro)?)/i);
                    if (revMatch) result.revenue = `€ ${revMatch[1]}`;

                    // Look for employees in snippets
                    const empMatch = text.match(/(\d+)\s*dipendenti/i);
                    if (empMatch) result.employees = empMatch[1];

                    return result;
                });

                if (serpData.revenue || serpData.employees) {
                    return serpData;
                }

                // Click through to first relevant result
                const firstLink = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('#search a'));
                    for (const link of links) {
                        const href = (link as HTMLAnchorElement).href;
                        if (href.includes('reportaziende.it') ||
                            href.includes('aziende.cc') ||
                            href.includes('finanze-aziende.it')) {
                            return href;
                        }
                    }
                    return null;
                });

                if (firstLink) {
                    await page.goto(firstLink, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    return await page.evaluate(() => {
                        const text = document.body.innerText;
                        const result: { revenue?: string; employees?: string } = {};

                        const revMatch = text.match(/fatturato\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni)?)/i);
                        if (revMatch) result.revenue = `€ ${revMatch[1]}`;

                        const empMatch = text.match(/dipendenti\s*[:\s]*([\d\-]+)/i);
                        if (empMatch) result.employees = empMatch[1];

                        return result;
                    });
                }

                return {};

            } catch (e) {
                Logger.warn('[Financial] Google name-based financial search failed (Puppeteer)', {
                    error: e as Error,
                    company_name: company.company_name,
                });
                return {};
            } finally {
                if (page) await this.browserFactory.closePage(page);
            }
        }

        return {};
    }

    // =========================================================================
    // HELPER: Google search for VAT
    // =========================================================================
    private async googleSearchForVAT(company: CompanyInput): Promise<string | undefined> {
        if (process.env.DISABLE_PROXY === 'true' && !ScraperClient.isScrapeDoEnabled()) {
            return undefined;
        }

        const query = `"${company.company_name}" ${company.city || ''} "Partita IVA" OR "P.IVA"`;
        const googleUrl = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;

        try {
            const html = await ScraperClient.fetchText(googleUrl, { mode: 'auto', render: true, super: true, timeoutMs: 20000, maxRetries: 1 });
            const $ = cheerio.load(html);
            const text = ($('body').text() || '').replace(/\s+/g, ' ');
            const match = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
            const vat = match?.[1] || null;

            if (vat) {
                // Validate with VIES
                const check = await this.vies.validateVat(vat);
                if (check.isValid) {
                    this.viesCache.set(vat, true);
                    return vat;
                }
            }

            return undefined;
        } catch (e) {
            Logger.warn('[Financial] Google VAT search failed (Scrape.do/HTTP)', { error: e as Error, company_name: company.company_name });
        }

        // Fallback: Puppeteer (only if proxies are enabled).
        if (process.env.DISABLE_PROXY !== 'true') {
            let page;
            try {
                page = await this.browserFactory.newPage();
                await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

                const vat = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const match = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
                    return match ? match[1] : null;
                });

                if (vat) {
                    const check = await this.vies.validateVat(vat);
                    if (check.isValid) {
                        this.viesCache.set(vat, true);
                        return vat;
                    }
                }
            } catch (e) {
                Logger.warn('[Financial] Google VAT search failed (Puppeteer)', { error: e as Error, company_name: company.company_name });
            } finally {
                if (page) await this.browserFactory.closePage(page);
            }
        }

        return undefined;
    }

    // =========================================================================
    // HELPER: Website VAT extraction - checks homepage + subpages (privacy, contatti, footer links)
    // =========================================================================
    private async scrapeWebsiteForVatAndPec(url: string): Promise<{ vat?: string; pec?: string } | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Extract from homepage first
            let signals = await this.extractVatPecFromPage(page);
            if (signals.vat && signals.pec) {
                return { vat: signals.vat, pec: signals.pec };
            }

            // If not found on homepage, check footer links and subpages
            const subpageUrls = await page.evaluate((baseUrl: string) => {
                const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
                const targets: string[] = [];
                const seen = new Set<string>();
                let baseHost: string;
                try { baseHost = new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { return []; }

                const keywords = ['privacy', 'contatt', 'contact', 'note-legali', 'legal', 'chi-siamo', 'chisiamo', 'about', 'impressum', 'cookie'];
                for (const link of links) {
                    const href = link.href;
                    if (!href || !href.startsWith('http')) continue;
                    try {
                        const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
                        if (host !== baseHost) continue;
                    } catch { continue; }

                    const hrefLower = href.toLowerCase();
                    const textLower = (link.textContent || '').toLowerCase();
                    if (keywords.some(kw => hrefLower.includes(kw) || textLower.includes(kw))) {
                        if (!seen.has(href)) {
                            seen.add(href);
                            targets.push(href);
                        }
                    }
                }
                return targets.slice(0, 4);
            }, url);

            for (const subUrl of subpageUrls) {
                try {
                    await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    const subSignals = await this.extractVatPecFromPage(page);
                    if (!signals.vat && subSignals.vat) signals.vat = subSignals.vat;
                    if (!signals.pec && subSignals.pec) signals.pec = subSignals.pec;
                    if (signals.vat && signals.pec) break;
                } catch {
                    continue;
                }
            }

            return {
                vat: signals.vat || undefined,
                pec: signals.pec || undefined,
            };
        } catch (e) {
            Logger.warn('[Financial] Website VAT/PEC scrape failed', { error: e as Error, url });
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async extractVatPecFromPage(page: any): Promise<{ vat: string | null; pec: string | null }> {
        return page.evaluate(() => {
            const text = document.body?.innerText || '';
            const html = document.body?.innerHTML || '';

            // VAT patterns - multiple Italian formats
            const vatPatterns = [
                /(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva|partita\s*iva)[:\s]*(?:IT)?[\s]?(\d{11})/i,
                /(?:C\.?\s*F\.?\s*(?:\/|\s*e\s*)\s*P\.?\s*I\.?\s*V\.?\s*A\.?)[:\s]*(?:IT)?[\s]?(\d{11})/i,
                /(?:Cod\.?\s*Fisc\.?\s*(?:\/|\s*e\s*)\s*P\.?\s*IVA)[:\s]*(?:IT)?[\s]?(\d{11})/i,
                /IT\s?(\d{11})\b/,
            ];

            let vat: string | null = null;
            for (const pattern of vatPatterns) {
                const match = text.match(pattern);
                if (match?.[1]) { vat = match[1]; break; }
            }

            // Also try footer/bottom area specifically for VAT (common Italian pattern)
            if (!vat) {
                // Check last 2000 chars of text (usually footer)
                const footerText = text.slice(-2000);
                for (const pattern of vatPatterns) {
                    const match = footerText.match(pattern);
                    if (match?.[1]) { vat = match[1]; break; }
                }
            }

            // Also try HTML for hidden/structured VAT data
            if (!vat) {
                const htmlVatMatch = html.match(/(?:vatID|taxID|partita.?iva)["'\s:]*(?:IT)?["'\s:]*(\d{11})/i);
                if (htmlVatMatch?.[1]) vat = htmlVatMatch[1];
            }

            // PEC patterns - comprehensive Italian PEC provider list
            const pecPattern = /([a-zA-Z0-9._%+\-]+@(?:pec\.[a-zA-Z0-9.\-]+|[a-zA-Z0-9.\-]*(?:legalmail|arubapec|postecert|mypec|registerpec|sicurezzapostale|pecspeciale|cert\.legalmail|cgn\.legalmail|pec\.it|pec\.buffetti)\.[a-zA-Z]{2,}))/i;
            const pecMatch = text.match(pecPattern);
            let pec: string | null = pecMatch ? pecMatch[1].toLowerCase() : null;

            // Also check for PEC in HTML (meta tags, structured data)
            if (!pec) {
                const htmlPecMatch = html.match(/(?:pec|email.?certificata)["'\s:]*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]*pec[a-zA-Z0-9.\-]*\.[a-zA-Z]{2,})/i);
                if (htmlPecMatch?.[1]) pec = htmlPecMatch[1].toLowerCase();
            }

            return { vat, pec };
        });
    }

    // =========================================================================
    // HELPER: ReportAziende (name-based)
    // =========================================================================
    private async scrapeReportAziende(
        name: string,
        city?: string,
        vat?: string
    ): Promise<{ revenue?: string; employees?: string } | null> {
        const vatDigits = (vat || '').replace(/\D/g, '');
        const q = vatDigits && /^\d{11}$/.test(vatDigits) ? vatDigits : (city ? `${name} ${city}` : name);
        const searchUrl = `https://www.reportaziende.it/cerca?q=${encodeURIComponent(q)}`;

        try {
            const firstTry = await ScraperClient.fetchHtml(searchUrl, { mode: 'auto', render: false, maxRetries: 1 });
            let companyUrl = this.extractFirstReportAziendeResultUrl(firstTry.data);

            // Some pages are JS-heavy or protected; try a rendered request via Scrape.do if available.
            if (!companyUrl && ScraperClient.isScrapeDoEnabled()) {
                const rendered = await ScraperClient.fetchHtml(searchUrl, {
                    mode: 'scrape_do',
                    render: true,
                    super: true,
                    maxRetries: 1,
                });
                companyUrl = this.extractFirstReportAziendeResultUrl(rendered.data);
            }

            if (!companyUrl) return null;

            const detail = await ScraperClient.fetchHtml(companyUrl, { mode: 'auto', render: false, maxRetries: 1 });
            const $ = cheerio.load(detail.data);
            const text = ($('body').text() || '').replace(/\s+/g, ' ').trim();

            const r: any = {};
            const revMatch = text.match(
                /fatturato\s*(?:\(\d{4}\))?\s*[:\.]?\s*€?\s*([\d.,]+(?:\s*(?:mila|mln|milioni|k|m|€))?)/i
            );
            if (revMatch) r.revenue = '€ ' + revMatch[1];

            const empMatch = text.match(/dipendenti\s*(?:\(\d{4}\))?\s*[:\.]?\s*(\d+(?:-\d+)?)/i);
            if (empMatch) r.employees = empMatch[1];

            return (r.revenue || r.employees) ? r : null;
        } catch (e) {
            Logger.warn('[Financial] ReportAziende scrape failed', { error: e as Error, company_name: name, city, vat });
            return null;
        }
    }

    private extractFirstReportAziendeResultUrl(html: string): string | null {
        try {
            const $ = cheerio.load(html);
            const base = 'https://www.reportaziende.it';

            const candidates: string[] = [];
            const pushHref = (href?: string | null) => {
                const raw = (href || '').trim();
                if (!raw) return;
                if (raw.startsWith('javascript:') || raw.startsWith('#')) return;
                const absolute = raw.startsWith('http') ? raw : new URL(raw, base).toString();
                try {
                    const u = new URL(absolute);
                    const host = u.hostname.replace(/^www\./, '').toLowerCase();
                    if (host !== 'reportaziende.it') return;
                    const path = u.pathname.toLowerCase();
                    if (path === '/' || path.startsWith('/cerca') || path.includes('privacy') || path.includes('cookie')) return;
                    candidates.push(u.toString());
                } catch {
                    return;
                }
            };

            // Preferred selectors (legacy)
            pushHref($('.risultato-titolo a').first().attr('href'));
            pushHref($('.company-title a').first().attr('href'));

            // Pattern-based fallback
            const patternSelectors = [
                'a[href*="/azienda"]',
                'a[href*="/impresa"]',
                'a[href*="/scheda"]',
                'a[href*="/dettaglio"]',
            ];
            for (const sel of patternSelectors) {
                if (candidates.length > 0) break;
                $(sel).slice(0, 8).each((_, el) => pushHref($(el).attr('href')));
            }

            // Last resort: first internal link that looks like a company page.
            if (candidates.length === 0) {
                $('a[href]').slice(0, 80).each((_, el) => pushHref($(el).attr('href')));
            }

            return candidates[0] || null;
        } catch {
            return null;
        }
    }

    // =========================================================================
    // HELPER: Employee estimation (AI)
    // =========================================================================
    private async estimateEmployees(company: CompanyInput, url: string): Promise<string | undefined> {
        if (!this.openai) return undefined;
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            const text = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');

            const completion = await this.openai.chat.completions.create({
                messages: [{
                    role: 'user',
                    content: `Estimate employees for "${company.company_name}" based on:\n${text}\nReturn ONLY a number or range (e.g. "10-25"). If unknown, return "unknown".`
                }],
                model: 'gpt-4o-mini',
                max_tokens: 20
            });

            const result = completion.choices[0].message.content?.trim();
            return result !== 'unknown' ? result : undefined;
        } catch (e) {
            Logger.warn('[Financial] Employee estimation failed', {
                error: e as Error,
                company_name: company.company_name,
                url,
            });
            return undefined;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // HELPER: PEC discovery
    // =========================================================================
    private async findPecDIY(name: string, city?: string): Promise<string | null> {
        // If proxies are disabled and Scrape.do isn't configured, Google is almost always blocked.
        if (process.env.DISABLE_PROXY === 'true' && !ScraperClient.isScrapeDoEnabled()) {
            return null;
        }

        const query = `${name} PEC ${city || ''}`.trim();
        const googleUrl = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;

        try {
            const html = await ScraperClient.fetchText(googleUrl, {
                mode: 'auto',
                render: true,
                super: true,
                timeoutMs: 20000,
                maxRetries: 1,
            });

            const $ = cheerio.load(html);
            const text = ($('body').text() || '').replace(/\s+/g, ' ');
            const match = text.match(/([a-zA-Z0-9._%+-]+@(?:pec\.[a-zA-Z0-9.-]+|[a-zA-Z0-9.-]*(?:legalmail|arubapec|postecert|mypec|registerpec|sicurezzapostale|pecspeciale|pec\.it|pec\.buffetti)\.[a-zA-Z0-9.-]+))/i);
            return match ? match[1].toLowerCase() : null;
        } catch (e) {
            Logger.warn('[Financial] PEC search failed (Scrape.do/HTTP)', { error: e as Error, company_name: name, city });
        } finally {
            // no browser resources
        }

        // Fallback: Puppeteer-based Google search when proxies are enabled.
        if (process.env.DISABLE_PROXY !== 'true') {
            let page;
            try {
                page = await this.browserFactory.newPage();
                await page.goto(googleUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                });

                const pec = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const match = text.match(/([a-zA-Z0-9._%+-]+@(?:pec\.[a-zA-Z0-9.-]+|[a-zA-Z0-9.-]*(?:legalmail|arubapec|postecert|mypec|registerpec|sicurezzapostale|pecspeciale|pec\.it|pec\.buffetti)\.[a-zA-Z0-9.-]+))/i);
                    return match ? match[0].toLowerCase() : null;
                });

                return pec;
            } catch (e) {
                Logger.warn('[Financial] PEC search failed (Puppeteer)', { error: e as Error, company_name: name, city });
            } finally {
                if (page) await this.browserFactory.closePage(page);
            }
        }

        return null;
    }
}
