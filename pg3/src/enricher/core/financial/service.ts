
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../../types';
import OpenAI from 'openai';
import { ViesService } from './vies';
import { Logger } from '../../utils/logger';

export interface FinancialData {
    vat?: string;
    revenue?: string;
    revenueYear?: string;
    employees?: string;
    isEstimatedEmployees: boolean;
    source?: string;
    pec?: string;
}

/**
 * 💰 FINANCIAL SERVICE
 * Ported from Step3 Enrichment.
 * Handles VAT, Revenue, Employees, and PEC discovery.
 */
export class FinancialService {
    private browserFactory: BrowserFactory;
    private openai: OpenAI;
    private vies: ViesService;
    private viesCache: Map<string, boolean> = new Map();

    constructor(apiKey?: string) {
        this.browserFactory = BrowserFactory.getInstance();
        const key = apiKey || process.env.OPENAI_API_KEY || '';
        this.openai = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
        this.vies = new ViesService();
    }

    async enrich(company: CompanyInput, websiteUrl?: string): Promise<FinancialData> {
        const data: FinancialData = { isEstimatedEmployees: false };
        let validVat: string | undefined;

        // 1. VAT Discovery
        // A. From Website
        if (websiteUrl) {
            const webData = await this.scrapeWebsiteForVAT(websiteUrl);
            if (webData.vat) {
                if (this.viesCache.has(webData.vat)) {
                    validVat = webData.vat;
                    data.source = 'Website + VIES (Cached)';
                } else {
                    const check = await this.vies.validateVat(webData.vat);
                    if (check.isValid) {
                        validVat = webData.vat;
                        this.viesCache.set(validVat, true);
                        data.source = 'Website + VIES Verified';
                    }
                }
            }
        }

        // B. External / AI
        if (!validVat) {
            const aiVat = await this.deepSearchVatAI(company);
            if (aiVat) {
                const check = await this.vies.validateVat(aiVat);
                if (check.isValid) {
                    validVat = aiVat;
                    data.source = 'AI Search + VIES Verified';
                }
            }
        }

        // C. External Directory (Bing)
        if (!validVat) {
            const extVat = await this.findVatExternal(company);
            if (extVat) {
                validVat = extVat;
                data.source = 'External Directory';
                // We don't force VIES invalidation here as external sources often have valid VATs that VIES times out on
            }
        }

        if (validVat) {
            data.vat = validVat;
            // 2. Financials from Registry (using VAT)
            const regData = await this.getFinancialsFromRegistry(validVat);
            if (regData.revenue) data.revenue = regData.revenue;
            if (regData.employees) data.employees = regData.employees;
        }

        // 3. Fallback: DIY ReportAziende (using Name)
        if (!data.revenue || !data.employees) {
            const raData = await this.scrapeReportAziende(company.company_name, company.city);
            if (raData) {
                if (!data.revenue && raData.revenue) data.revenue = raData.revenue;
                if (!data.employees && raData.employees) data.employees = raData.employees;
            }
        }

        // 4. Employee Estimation (AI)
        if (!data.employees && websiteUrl) {
            data.employees = await this.estimateEmployees(company, websiteUrl);
            data.isEstimatedEmployees = true;
        }

        // 5. PEC Discovery
        data.pec = await this.findPecDIY(company.company_name, company.city) || undefined;

        return data;
    }

    // --- HELPER METHODS ---

    private async deepSearchVatAI(company: CompanyInput): Promise<string | undefined> {
        try {
            const completion = await this.openai.chat.completions.create({
                messages: [{
                    role: "user",
                    content: `Find the "Partita IVA" (VAT Number) for "${company.company_name}" in "${company.city || ''}". Return ONLY the 11-digit number or "null".`
                }],
                model: "gpt-4o",
            });
            const text = completion.choices[0].message.content?.trim();
            if (text && /^\d{11}$/.test(text)) return text;
        } catch (e) { }
        return undefined;
    }

    private async scrapeWebsiteForVAT(url: string): Promise<{ vat?: string }> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const vat = await page.evaluate(() => {
                const text = document.body.innerText;
                const match = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
                return match ? match[1] : null;
            });
            return { vat: vat || undefined };
        } catch (e) {
            return {};
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async findVatExternal(company: CompanyInput): Promise<string | undefined> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const query = `"${company.company_name}" ${company.city || ''} "Partita IVA"`;
            await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
            const vat = await page.evaluate(() => {
                const text = document.body.innerText;
                const match = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[:\s]*(?:IT)?[\s]?(\d{11})/i);
                return match ? match[1] : null;
            });
            return vat || undefined;
        } catch { return undefined; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async getFinancialsFromRegistry(vat: string): Promise<{ revenue?: string, employees?: string }> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(`https://www.ufficiocamerale.it/cerca?q=${vat}`, { waitUntil: 'domcontentloaded' });

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const r: { revenue?: string, employees?: string } = {};

                const revMatch = text.match(/Fatturato\s*(?:stima|circa|stimato)?[:\s]*€?\s*([\d\.,]+(?:\s*(?:mln|milioni|mila|k|M))?)/i);
                if (revMatch) r.revenue = revMatch[1];

                const empMatch = text.match(/(?:Dipendenti|Numero dipendenti)[:\s]*([\d\.-]+)/i);
                if (empMatch) r.employees = empMatch[1];

                return r;
            });
        } catch { return {}; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async scrapeReportAziende(name: string, city?: string): Promise<{ revenue?: string, employees?: string } | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const q = city ? `${name} ${city}` : name;
            await page.goto(`https://www.reportaziende.it/cerca?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });

            // Try click first result
            try {
                const first = await page.$('.risultato-titolo a');
                if (first) {
                    await Promise.all([page.waitForNavigation({ timeout: 5000 }), first.click()]);
                }
            } catch { }

            return await page.evaluate(() => {
                const text = document.body.innerText;
                const r: any = {};
                const revMatch = text.match(/fatturato\s*(?:partita\s*iva)?\s*(?:\(\d{4}\))?\s*[:\.]?\s*€?\s*([\d.,]+(?:\s*(?:mila|mln|milioni|k|m|€))?)/i);
                if (revMatch) r.revenue = '€ ' + revMatch[1];
                const empMatch = text.match(/dipendenti\s*(?:\(\d{4}\))?\s*[:\.]?\s*(\d+(?:-\d+)?)/i);
                if (empMatch) r.employees = empMatch[1];
                return (r.revenue || r.employees) ? r : null;
            });
        } catch { return null; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async estimateEmployees(company: CompanyInput, url: string): Promise<string | undefined> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            const text = await page.evaluate(() => document.body.innerText.substring(0, 3000));

            const completion = await this.openai.chat.completions.create({
                messages: [{
                    role: "user",
                    content: `Estimate employees for "${company.company_name}" based on text:\n${text}\nReturn range (e.g. 10-25) or "unknown".`
                }],
                model: "gpt-4o",
            });
            return completion.choices[0].message.content?.trim();
        } catch { return undefined; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async findPecDIY(name: string, city?: string): Promise<string | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(name + ' PEC ' + (city || ''))}`, { waitUntil: 'domcontentloaded' });
            const text = await page.evaluate(() => document.body.innerText);
            const match = text.match(/([a-zA-Z0-9._%+-]+@(pec|legalmail|mypec|arubapec)\.[a-zA-Z0-9.-]+)/i);
            return match ? match[0] : null;
        } catch { return null; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }
}
