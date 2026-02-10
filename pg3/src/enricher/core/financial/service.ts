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
                    if (maybe.includes('@pec.') || maybe.includes('legalmail') || maybe.includes('arubapec') || maybe.includes('postecert')) {
                        data.pec = maybe;
                    }
                }
            }
        }

        // 1D. Google search for VAT (only when proxy is available)
        if (!validVat && process.env.DISABLE_PROXY !== 'true') {
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
            const raData = await this.scrapeReportAziende(company.company_name, company.city);
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

        // Fallback to Google only when proxy is available (otherwise it's mostly wasted work / blocks).
        if (!data.pec && process.env.DISABLE_PROXY !== 'true') {
            data.pec = await this.findPecDIY(company.company_name, company.city) || undefined;
        }

        Logger.info(`[Financial] ✅ Enrichment complete for ${company.company_name}: VAT=${data.vat || 'N/A'}, Revenue=${data.revenue || 'N/A'}`);
        return data;
    }

    // =========================================================================
    // P.IVA PATH: Direct UfficioCamerale with CaptchaSolver
    // =========================================================================
    private async scrapeUfficioCameraleDirect(vat: string): Promise<{ revenue?: string; employees?: string }> {
        if (process.env.DISABLE_PROXY === 'true') {
            Logger.info('[Financial] 🛡️ Proxy disabled - skipping Google-based registry lookup');
            return {};
        }
        let page;
        try {
            page = await this.browserFactory.newPage();

            // Step 1: Google search for the specific VAT on UfficioCamerale
            const googleQuery = `piva ${vat} site:ufficiocamerale.it OR site:registroimprese.it OR site:informazione-aziende.it`;
            await page.goto(`https://www.google.it/search?q=${encodeURIComponent(googleQuery)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Find first result link
            const firstLink = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('#search a'));
                for (const link of links) {
                    const href = (link as HTMLAnchorElement).href;
                    if (href.includes('ufficiocamerale.it') ||
                        href.includes('registroimprese.it') ||
                        href.includes('informazione-aziende.it')) {
                        return href;
                    }
                }
                return null;
            });

            if (!firstLink) {
                Logger.warn(`[Financial] No registry result for VAT: ${vat}`);
                return {};
            }

            // Step 2: Navigate to registry page
            await page.goto(firstLink, { waitUntil: 'domcontentloaded', timeout: 20000 });

            // Step 3: Check for CAPTCHA and solve if needed
            const hasCaptcha = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('captcha') || text.includes('verifica') || text.includes('robot');
            });

            if (hasCaptcha) {
                Logger.info(`[Financial] 🔐 CAPTCHA detected! Calling neutralizeGatekeeper...`);
                const solved = await CaptchaSolver.neutralizeGatekeeper(page);
                if (!solved) {
                    Logger.warn(`[Financial] ❌ CAPTCHA solving failed`);
                    return {};
                }
                // Prefer deterministic wait after CAPTCHA; fallback to short delay.
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
                    new Promise((resolve) => setTimeout(resolve, 3000)),
                ]);
            }

            // Step 4: Extract financial data
            return await page.evaluate(() => {
                const text = document.body.innerText;
                const result: { revenue?: string; employees?: string } = {};

                // Revenue patterns
                const revenuePatterns = [
                    /fatturato\s*(?:\d{4})?\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                    /ricavi\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
                    /volume\s*d['']affari\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i
                ];

                for (const pattern of revenuePatterns) {
                    const match = text.match(pattern);
                    if (match) {
                        result.revenue = `€ ${match[1]}`;
                        break;
                    }
                }

                // Employees patterns
                const employeePatterns = [
                    /(?:dipendenti|numero\s*dipendenti)\s*[:\s]*([\d\-\.]+)/i,
                    /organico\s*[:\s]*([\d\-\.]+)/i,
                    /addetti\s*[:\s]*([\d\-\.]+)/i
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

    // =========================================================================
    // P.IVA PATH: Secondary registries
    // =========================================================================
    private async scrapeSecondaryRegistries(vat: string): Promise<{ revenue?: string; employees?: string }> {
        let page;
        try {
            page = await this.browserFactory.newPage();

            // Try informazione-aziende.it directly
            await page.goto(`https://www.informazione-aziende.it/search?q=${vat}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Click first result if exists
            const firstResult = await page.$('.search-result a, .company-link');
            if (firstResult) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
                    firstResult.click()
                ]);
            }

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const result: { revenue?: string; employees?: string } = {};

                const revMatch = text.match(/fatturato\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M)?)/i);
                if (revMatch) result.revenue = `€ ${revMatch[1]}`;

                const empMatch = text.match(/dipendenti\s*[:\s]*([\d\-]+)/i);
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
        if (process.env.DISABLE_PROXY === 'true') {
            Logger.info('[Financial] 🛡️ Proxy disabled - skipping Google name-based financial search');
            return {};
        }
        let page;
        try {
            page = await this.browserFactory.newPage();

            const query = `"${company.company_name}" ${company.city || ''} fatturato dipendenti`;
            await page.goto(`https://www.google.it/search?q=${encodeURIComponent(query)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

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
            Logger.warn('[Financial] Google name-based financial search failed', {
                error: e as Error,
                company_name: company.company_name,
            });
            return {};
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // HELPER: Google search for VAT
    // =========================================================================
    private async googleSearchForVAT(company: CompanyInput): Promise<string | undefined> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const query = `"${company.company_name}" ${company.city || ''} "Partita IVA" OR "P.IVA"`;
            await page.goto(`https://www.google.it/search?q=${encodeURIComponent(query)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            const vat = await page.evaluate(() => {
                const text = document.body.innerText;
                const match = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
                return match ? match[1] : null;
            });

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
            Logger.warn('[Financial] Google VAT search failed', {
                error: e as Error,
                company_name: company.company_name,
            });
            return undefined;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // HELPER: Website VAT extraction
    // =========================================================================
    private async scrapeWebsiteForVatAndPec(url: string): Promise<{ vat?: string; pec?: string } | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const signals = await page.evaluate(() => {
                const text = document.body.innerText;
                const vatMatch = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
                const pecMatch = text.match(/([a-zA-Z0-9._%+-]+@(?:pec|legalmail|mypec|arubapec|postecert)\.[a-zA-Z0-9.-]+)/i);
                return {
                    vat: vatMatch ? vatMatch[1] : null,
                    pec: pecMatch ? pecMatch[1] : null,
                };
            });
            return {
                vat: signals?.vat || undefined,
                pec: signals?.pec ? String(signals.pec).toLowerCase() : undefined,
            };
        } catch (e) {
            Logger.warn('[Financial] Website VAT/PEC scrape failed', { error: e as Error, url });
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // HELPER: ReportAziende (name-based)
    // =========================================================================
    private async scrapeReportAziende(name: string, city?: string): Promise<{ revenue?: string; employees?: string } | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const q = city ? `${name} ${city}` : name;
            await page.goto(`https://www.reportaziende.it/cerca?q=${encodeURIComponent(q)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Click first result
            const first = await page.$('.risultato-titolo a, .company-title a');
            if (first) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
                    first.click()
                ]);
            }

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const r: any = {};

                const revMatch = text.match(/fatturato\s*(?:\(\d{4}\))?\s*[:\.]?\s*€?\s*([\d.,]+(?:\s*(?:mila|mln|milioni|k|m|€))?)/i);
                if (revMatch) r.revenue = '€ ' + revMatch[1];

                const empMatch = text.match(/dipendenti\s*(?:\(\d{4}\))?\s*[:\.]?\s*(\d+(?:-\d+)?)/i);
                if (empMatch) r.employees = empMatch[1];

                return (r.revenue || r.employees) ? r : null;
            });
        } catch (e) {
            Logger.warn('[Financial] ReportAziende scrape failed', { error: e as Error, company_name: name, city });
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
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
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(`https://www.google.it/search?q=${encodeURIComponent(name + ' PEC ' + (city || ''))}`, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
            });

            const pec = await page.evaluate(() => {
                const text = document.body.innerText;
                const match = text.match(/([a-zA-Z0-9._%+-]+@(?:pec|legalmail|mypec|arubapec|postecert)\.[a-zA-Z0-9.-]+)/i);
                return match ? match[0].toLowerCase() : null;
            });

            return pec;
        } catch (e) {
            Logger.warn('[Financial] PEC search failed', { error: e as Error, company_name: name, city });
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}
