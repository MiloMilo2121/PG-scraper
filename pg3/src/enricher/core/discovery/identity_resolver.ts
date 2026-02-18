
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { ScraperClient } from '../../utils/scraper_client';
import { LLMService } from '../ai/llm_service';
import * as cheerio from 'cheerio';
import { ContentFilter } from './content_filter';

export interface FinancialData {
    revenue?: string;
    employees?: string;
    profit?: string;
    personnel_cost?: string; // New
    confidence?: string; // New: For AI confidence
    year?: string;
}

interface AIEmployeeResult {
    employees: string;
    confidence: string;
}

export interface IdentityResult {
    legal_name: string;
    vat_number: string;
    fiscal_code?: string;
    rea?: string; // New
    legal_form?: string; // New
    foundation_year?: string; // New
    activity_status?: string; // New
    activity_code?: string; // ATECO
    city?: string;
    province?: string; // New
    region?: string; // New
    address?: string;
    financials?: FinancialData;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    source_url: string;
}

export class IdentityResolver {

    /**
     * 🕵️ ZERO-COST IDENTITY RESOLUTION
     * Step 0: Find the "Official Identity" via fatturatoitalia.it
     * Uses Serper.dev (Google API) to find the specific profile page, then fetches it via ScraperClient.
     */
    private static readonly IDENTITY_TIMEOUT_MS = 20000; // 20s max for identity resolution

    public async resolveIdentity(company: CompanyInput): Promise<IdentityResult | null> {
        Logger.info(`[IdentityResolver] Resolving identity for: ${company.company_name}`);

        try {
            return await Promise.race([
                this._resolveIdentityInner(company),
                new Promise<null>((resolve) =>
                    setTimeout(() => {
                        Logger.warn(`[IdentityResolver] Timeout after ${IdentityResolver.IDENTITY_TIMEOUT_MS}ms for ${company.company_name}`);
                        resolve(null);
                    }, IdentityResolver.IDENTITY_TIMEOUT_MS)
                )
            ]);
        } catch (e: any) {
            Logger.warn(`[IdentityResolver] Error: ${e.message}`, { company_name: company.company_name });
            return null;
        }
    }

    private async _resolveIdentityInner(company: CompanyInput): Promise<IdentityResult | null> {
        const queries = [
            `site:fatturatoitalia.it "${company.company_name}" "${company.city || ''}"`,
        ];

        if (company.company_name.split(' ').length < 2 && company.category) {
            queries.push(`site:fatturatoitalia.it "${company.company_name}" "${company.category}" "${company.city || ''}"`);
        } else if (company.province) {
            queries.push(`site:fatturatoitalia.it "${company.company_name}" "${company.province}"`);
        }

        for (const query of queries) {
            const profileUrl = await this.findProfileUrl(query);
            if (profileUrl) {
                Logger.info(`[IdentityResolver] Profile found: ${profileUrl}`);
                const identity = await this.scrapeProfile(profileUrl, company);
                if (identity) {
                    return identity;
                }
            }
        }

        Logger.warn(`[IdentityResolver] Identity resolution failed for ${company.company_name}`);
        return null;
    }

    private async findProfileUrl(query: string): Promise<string | null> {
        // 1. Try Bing First (Cheaper/Free via ScraperClient)
        try {
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
            // Use render: true to ensure Bing results load, but Scrape.do handles the heavy lifting
            const html = await ScraperClient.fetchText(bingUrl, { mode: 'scrape_do', render: true });
            const $ = cheerio.load(html);
            let matchedUrl: string | null = null;
            $('li.b_algo h2 a').each((i, el) => {
                if (matchedUrl) return;
                const url = $(el).attr('href');
                if (url && url.includes('fatturatoitalia.it')) {
                    matchedUrl = url;
                }
            });

            if (matchedUrl) {
                Logger.info(`[IdentityResolver] 🟢 Found via Bing: ${matchedUrl}`);
                return matchedUrl;
            }
        } catch (e) {
            Logger.warn(`[IdentityResolver] Bing fallback failed: ${query}`, { error: e as Error });
            // Continue to Serper fallback
        }

        // 2. Fallback to Serper (High Accuracy, Costly)
        if (process.env.SERPER_API_KEY) {
            try {
                Logger.info(`[IdentityResolver] 🟡 Bing failed, engaging Serper fallback...`);
                const response = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': process.env.SERPER_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ q: query, gl: 'it', hl: 'it' })
                });
                const data = await response.json();
                const firstResult = data.organic?.[0]?.link;
                if (firstResult && firstResult.includes('fatturatoitalia.it')) {
                    return firstResult;
                }
            } catch (e) {
                Logger.warn(`[IdentityResolver] Serper query failed: ${query}`, { error: e as Error });
            }
        }

        return null;
    }

    /**
     * 🧠 AI EMPLOYEE ESTIMATION (Optimization Phase)
     * If official data is missing, ask the AI to estimate based on the company website.
     * Uses Z.ai / DeepSeek / OpenAI via LLMService.
     */
    public async estimateEmployeesFromWebsite(company: CompanyInput, websiteUrl: string): Promise<string | undefined> {
        try {
            // 1. Fetch "Chi Siamo" or Homepage content
            // We use ScraperClient to get text (Markdown via Jina would be best, but text is fine)
            Logger.info(`[IdentityResolver] 🧠 Estimating employees for ${company.company_name} from ${websiteUrl}`);

            const html = await ScraperClient.fetchText(websiteUrl, { mode: 'auto', render: false });
            const text = this.distillContent(html);

            if (text.length < 500) {
                Logger.warn(`[IdentityResolver] Website content too short for estimation.`);
                return undefined;
            }

            // 2. Ask AI
            // We use a lightweight prompt to save tokens.
            const prompt = `
            Analyze this text from "${company.company_name}" website.
            Estimate the number of employees.
            Return ONLY a JSON object: { "employees": "1-10" | "10-50" | "50+" | "N/A", "confidence": "HIGH" | "LOW" }
            
            TEXT:
            ${text.slice(0, 8000)}
            `;

            // TS1117 Workaround: Remove generic, cast result
            const completion = await LLMService.completeStructured(prompt, {
                type: 'object',
                properties: {
                    employees: { type: 'string' },
                    confidence: { type: 'string' }
                },
                required: ['employees', 'confidence']
            }) as any;

            if (completion && completion.employees && completion.employees !== 'N/A') {
                Logger.info(`[IdentityResolver] 🤖 AI Estimate: ${completion.employees} (Conf: ${completion.confidence})`);
                return completion.employees;
            }

        } catch (e) {
            Logger.warn(`[IdentityResolver] AI Estimation failed`, { error: e as Error });
        }
        return undefined;
    }

    private distillContent(html: string): string {
        const $ = cheerio.load(html);
        $('script, style, noscript, svg, img').remove();
        return $('body').text().replace(/\s+/g, ' ').trim();
    }

    private async scrapeProfile(url: string, originalCompany: CompanyInput): Promise<IdentityResult | null> {
        try {
            // Fetch profile HTML without browser overhead
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do', render: false });
            const $ = cheerio.load(html);
            const bodyText = $('body').text();
            const lowerBody = bodyText.toLowerCase();

            // 1. Extract Legal Name
            let legalName = $('h1').first().text().trim();
            if (!legalName) legalName = this.extractByLabel($, 'Ragione sociale') || '';

            // 2. Extract VAT (P.IVA)
            let vat: string | undefined | null = this.extractByLabel($, 'Partita IVA');
            if (!vat) {
                const vatMatch = bodyText.match(/Partita IVA:?\s*(\d{11})/i);
                vat = vatMatch ? vatMatch[1] : undefined;
            }

            if (!legalName || !vat) return null;

            // 3. Extract Extended Fields
            const fiscalCode = this.extractByLabel($, 'Codice Fiscale') || vat;
            const rea = this.extractByLabel($, 'REA');
            const legalForm = this.extractByLabel($, 'Forma giuridica');
            const foundationYear = this.extractByLabel($, 'Anno Fondazione');
            const activityStatus = this.extractByLabel($, 'Stato Attività');

            // Geo
            const address = this.extractByLabel($, 'Indirizzo');
            const city = this.extractByLabel($, 'Città');
            const province = this.extractByLabel($, 'Provincia');
            const region = this.extractByLabel($, 'Regione');

            // 4. Extract Financials
            const revenue = this.extractByLabel($, 'Fatturato');
            const employees = this.extractByLabel($, 'N. Dipendenti') || this.extractByLabel($, 'Dipendenti');
            const profit = this.extractByLabel($, 'Utile');
            const personnelCost = this.extractByLabel($, 'Costo del personale');

            // 5. Extract Category/Activity
            const activity = this.extractByLabel($, 'Attività prevalente') || this.extractByLabel($, 'ATECO');

            // 6. Confidence Logic
            // Disambiguation: Must match City OR Province matches input
            let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

            const cityMatch = originalCompany.city && lowerBody.includes(originalCompany.city.toLowerCase());
            const provinceMatch = originalCompany.province && lowerBody.includes(originalCompany.province.toLowerCase());

            if (cityMatch || provinceMatch) {
                confidence = 'HIGH';
            } else if (originalCompany.vat_number && vat.includes(originalCompany.vat_number)) {
                confidence = 'HIGH';
            } else {
                // If geo doesn't match, risk of homonym (e.g. Rossi Srl in Milano vs Roma)
                // We mark it interesting but maybe uncertain
                confidence = 'MEDIUM';
            }

            return {
                legal_name: legalName,
                vat_number: vat,
                fiscal_code: fiscalCode,
                rea,
                legal_form: legalForm,
                foundation_year: foundationYear,
                activity_status: activityStatus,
                activity_code: activity,
                address,
                city,
                province,
                region,
                financials: {
                    revenue: this.cleanCurrency(revenue),
                    employees: this.cleanEmployees(employees),
                    profit: this.cleanCurrency(profit),
                    personnel_cost: this.cleanCurrency(personnelCost)
                },
                confidence,
                source_url: url
            };

        } catch (e) {
            Logger.warn('[IdentityResolver] Profile scraping failed', { url, error: e as Error });
            return null;
        }
    }

    /**
     * Extracts text following a label (e.g., "Fatturato: € 100").
     * Tries multiple strategies: Sibling element, Table cell, or Text proximity.
     */
    private extractByLabel($: cheerio.CheerioAPI, labelPattern: string): string | undefined {
        // Strategy 1: Definition lists or divs (Label -> Value)
        // Look for element containing label, then take the next element or text node
        try {
            // Find all elements containing the label
            const labelEls = $(`*:contains('${labelPattern}')`).filter((i, el) => {
                // Filter to ensure it's the deepest element containing the text (leaf node)
                return $(el).children().length === 0 || $(el).text().trim().startsWith(labelPattern);
            });

            if (labelEls.length > 0) {
                const finalEl = labelEls.last(); // Usually the most specific

                // Option A: Value is in the NEXT sibling
                let val = finalEl.next().text().trim();
                if (val) return val;

                // Option B: Value is in the SAME parent's text (e.g. <div>Label: Value</div>)
                const parentText = finalEl.parent().text().trim();
                if (parentText.length > labelPattern.length + 2) {
                    return parentText.replace(labelPattern, '').replace(/^[:\s]+/, '').trim();
                }

                // Option C: Table structure (TD -> next TD)
                const td = finalEl.closest('td');
                if (td.length > 0) {
                    return td.next('td').text().trim();
                }
            }
            return undefined;
        } catch (e) {
            return undefined;
        }
    }

    private cleanCurrency(value?: string): string | undefined {
        if (!value) return undefined;
        // Handle "€ 186.975.036" -> "186975036" (or keep formatting if preferred)
        // User request shows format "€ -2.299.451". Let's keep the standard numeric representation.
        // Actually, keeping the raw string is often safer for display, but for DB we might want numbers.
        // Let's return just numbers and minus sign.
        return value.replace(/[^0-9,-]/g, '').trim();
    }

    private cleanEmployees(value?: string): string | undefined {
        if (!value) return undefined;
        // Handle "oltre 1000" -> "1000+" or keep text
        return value.replace(/\n/g, '').trim();
    }
}
