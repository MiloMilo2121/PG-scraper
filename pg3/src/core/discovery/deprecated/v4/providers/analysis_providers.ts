import { IAnalysisProvider, AnalysisResult } from '../interfaces/types';
import { CompanyInput } from '../../../company_types';
import { BrowserFactory } from '../../../browser/factory_v2';
import { ContentFilter } from '../../content_filter';
import { LLMValidator } from '../../llm_validator';

export class StandardAnalyzer implements IAnalysisProvider {
    name = 'StandardAnalyzer';
    private browserFactory: BrowserFactory;

    constructor(browserFactory?: BrowserFactory) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
    }

    async analyze(url: string, company: CompanyInput): Promise<AnalysisResult> {
        let page;

        // Default failure result
        const fail = (reason: string, confidence: number = 0): AnalysisResult => ({
            isValid: false,
            confidence,
            url,
            details: { method: 'StandardAnalyzer', reason }
        });

        if (!url || ContentFilter.isDirectoryOrSocial(url)) {
            return fail('Directory/Social Blocked');
        }

        try {
            page = await this.browserFactory.newPage();
            // Block heavy resources for speed
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'media', 'font', 'stylesheet'].includes(type)) req.abort();
                else req.continue();
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // 🧠 SMART Extraction: Get Text + Metadata + JSON-LD
            const extraction = await page.evaluate(() => {
                const text = document.body.innerText;
                const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

                let structuredData: any[] = [];
                try {
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    scripts.forEach(script => {
                        const json = JSON.parse(script.innerHTML);
                        structuredData.push(json);
                    });
                } catch (e) { }

                return { text, metaDesc, structuredData };
            });

            // --- Validation Pipeline ---

            // 1. Content Safety
            const safety = ContentFilter.isValidContent(extraction.text);
            if (!safety.valid) return fail(safety.reason || 'Content Filter');

            // 2. Language Check
            if (!ContentFilter.isItalianLanguage(extraction.text)) return fail('Foreign Language', 0.1);

            // 3. Structured Data Check (JSON-LD) 🏅
            const jsonLdMatch = this.checkJsonLd(extraction.structuredData, company);
            if (jsonLdMatch) {
                return {
                    isValid: true,
                    confidence: 1.0,
                    url,
                    details: { method: 'JSON-LD/Schema.org', reason: 'Explicit Structured Data Match', level: 'High' }
                };
            }

            // 4. P.IVA Check (in Text)
            const pivas: string[] = extraction.text.match(/\d{11}/g) || [];
            const c = company as any;
            const targetPiva = c.piva || c.vat || c.vat_code;

            if (targetPiva && pivas.includes(targetPiva)) {
                return {
                    isValid: true,
                    confidence: 1.0,
                    url,
                    details: { method: 'PIVA_MATCH', scraped_piva: pivas[0], level: 'High' }
                };
            }

            // 5. AI Arbitration
            const llmRes = await LLMValidator.validate(url, extraction.text, company);
            if (llmRes.valid) {
                return {
                    isValid: true,
                    confidence: llmRes.confidence,
                    url,
                    details: { method: `AI_${llmRes.model_used}`, level: 'AI_Verified', reason: llmRes.reason }
                };
            }

            // 6. Fallback Name Match
            if (extraction.text.toLowerCase().includes(company.company_name.toLowerCase().split(' ')[0])) {
                return {
                    isValid: true,
                    confidence: 0.6,
                    url,
                    details: { method: 'FUZZY_NAME', level: 'Medium', reason: 'Fuzzy Name Match (No PIVA)' }
                };
            }

            return fail('No Match Found');

        } catch (e) {
            return fail(`Error: ${(e as Error).message}`);
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private checkJsonLd(data: any[], company: CompanyInput): boolean {
        // Look for "Organization" or "LocalBusiness" matching the VAT or heavily matching the name
        const targetVat = company.vat_code || company.piva;
        if (!targetVat) return false;

        const jsonString = JSON.stringify(data).toLowerCase();
        // 1. Direct VAT Match in JSON
        if (jsonString.includes(targetVat)) return true;

        return false;
    }
}
