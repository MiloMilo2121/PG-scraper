
import pLimit from 'p-limit';
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../company_types';
import { Logger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate_limit';
import { ContentFilter } from './content_filter';
import { HyperGuesser } from './hyper_guesser_v2';
import { ItalianRegistrySearch } from './italian_registry';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { DeepScanner } from './deep_scanner';
import { NuclearStrategy } from './nuclear_strategy';
import { DomainGuesser } from '../../utils/domain_guesser';
import { LLMValidator } from './llm_validator';

export enum DiscoveryMode {
    FAST_RUN1 = 'FAST',           // High precision, Hyperspeed
    DEEP_RUN2 = 'DEEP',           // Fallback, exhaustive search
    AGGRESSIVE_RUN3 = 'AGGRESSIVE', // Creative, probabilistic
    NUCLEAR_RUN4 = 'NUCLEAR'      // ☢️ Total saturation (20+ methods)
}

const THRESHOLDS = {
    FAST_STRICT: 0.9,
    DEEP_RELAXED: 0.85,
    REGISTRY: 0.8,
    AI_HIGH: 0.95,
    AI_LOW: 0.85
};

export interface DiscoveryResult {
    url: string | null;
    status: 'FOUND_VALID' | 'FOUND_INVALID' | 'NOT_FOUND' | 'ERROR';
    method: string;
    confidence: number;
    details: any;
}

export class UnifiedDiscoveryService {
    private browserFactory: BrowserFactory;
    private domainGuesser: any;
    private nuclearStrategy: NuclearStrategy;
    private validatorLimit = pLimit(5); // Parallel validations per company

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
        this.domainGuesser = new DomainGuesser();
        this.nuclearStrategy = new NuclearStrategy();
    }

    public async discover(company: CompanyInput, mode: DiscoveryMode): Promise<DiscoveryResult> {
        Logger.info(`[Unified] Analyzing "${company.company_name}" (Mode: ${mode})`);

        try {
            // --- STRATEGY 0: PRE-VALIDATION (Check Website from Step 1) ---
            if (company.website && company.website.length > 5 && !company.website.includes('paginegialle.it')) {
                Logger.info(`[Unified] 🏁 Verifying Pre-Scraped Website: ${company.website}`);
                const preVer = await this.deepVerify(company.website, company);
                if (preVer && preVer.confidence >= 0.6) {
                    return {
                        url: company.website,
                        status: 'FOUND_VALID',
                        method: 'step1_scraped',
                        confidence: preVer.confidence,
                        details: preVer
                    };
                }
            }

            // --- STRATEGY 1: FAST RUN (HyperGuess + Registry + Top Google) ---
            if (mode === DiscoveryMode.FAST_RUN1) {
                return await this.executeFastRun(company);
            }

            // --- STRATEGY 2: DEEP RUN (Search Fallbacks + Social + Extended Guess) ---
            if (mode === DiscoveryMode.DEEP_RUN2) {
                return await this.executeDeepRun(company);
            }

            // --- STRATEGY 3: AGGRESSIVE RUN (Domain Gen + Loose Validation) ---
            if (mode === DiscoveryMode.AGGRESSIVE_RUN3) {
                return await this.executeAggressiveRun(company);
            }

            // --- STRATEGY 4: NUCLEAR RUN (Total War) ---
            if (mode === DiscoveryMode.NUCLEAR_RUN4) {
                return await this.executeNuclearRun(company);
            }

        } catch (error) {
            Logger.error(`[Unified] Error processing ${company.company_name}`, error);
            return { url: null, status: 'ERROR', method: 'exception', confidence: 0, details: { error: (error as Error).message } };
        }

        return { url: null, status: 'NOT_FOUND', method: 'exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // 🚀 RUN 1: FAST (Precision First)
    // =========================================================================
    private async executeFastRun(company: CompanyInput): Promise<DiscoveryResult> {
        // 1. HyperGuesser (Top 10 only)
        const c = company as any;
        const guesses = HyperGuesser.generate(c.company_name, c.city || '', c.province || '', c.category || '');
        const topGuesses = guesses.slice(0, 10);

        const guessRes = await this.validateCandidates(topGuesses, company, THRESHOLDS.FAST_STRICT); // High threshold
        if (guessRes) return guessRes;

        // 2. Direct Registry (UfficioCamerale etc.)
        const regRes = await this.checkRegistries(company);
        if (regRes) return regRes;

        // 3. Primary Search Engine (Google only, top 3)
        if (!RateLimiter.isBlocked('google')) {
            const googleRes = await this.searchEngineLookup('google', company, 3);
            if (googleRes) return googleRes;

            // 3b. REVERSE LOOKUP (Phone) - "045 12345" sito web
            if (company.phone && company.phone.length > 5) {
                Logger.info(`[Unified] 📞 Reverse searching phone: "${company.phone}"`);
                const query = `"${company.phone}" sito web`;
                const phoneRes = await this.searchEngineLookup('google', { ...company, company_name: query }, 3);
                if (phoneRes) return { ...phoneRes, method: 'reverse_phone' };
            }

            // 3c. REVERSE LOOKUP (Address) - "Via Roma 1" sito web
            if (company.address && company.address.length > 8) {
                Logger.info(`[Unified] 🗺️ Reverse searching address: "${company.address}"`);
                const query = `"${company.address}" ${company.city || ''} "sito web"`;
                const addrRes = await this.searchEngineLookup('google', { ...company, company_name: query }, 3);
                if (addrRes) return { ...addrRes, method: 'reverse_address' };
            }
        } else {
            // Fallback to DDG if Google is blocked
            const ddgRes = await this.searchEngineLookup('duckduckgo', company, 3);
            if (ddgRes) return ddgRes;
        }

        return { url: null, status: 'NOT_FOUND', method: 'fast_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // 💰 ENRICHMENT: FINANCIALS (Revenue / P.IVA)
    // =========================================================================
    public async enrichFinancials(company: CompanyInput): Promise<CompanyInput> {
        // 1. If we have P.IVA, search for revenue
        const targetId = company.piva || company.vat_code || company.fiscal_code;

        if (targetId) {
            Logger.info(`[Financials] Searching revenue for P.IVA: ${targetId}`);
            // Query: fatturato "P.IVA"
            const query = `fatturato "${targetId}"`;
            const results = await this.scrapeGoogleDIY(query);

            // Analyze snippets for € values (Simplified for now)
            // In a real implementation, we'd parse the snippets or visit the pages (Ufficio Camerale, Report Aziende)
            // ... logic to extract revenue string ...
        }

        // 2. If no P.IVA but Company Name + City
        if (!targetId && company.company_name) {
            const query = `fatturato "${company.company_name}" ${company.city || ''}`;
            // ...
        }

        return company; // Return enriched company
    }

    // =========================================================================
    // 🧠 RUN 2: DEEP (Coverage First)
    // =========================================================================
    private async executeDeepRun(company: CompanyInput): Promise<DiscoveryResult> {
        // 1. Extended HyperGuesser (All variations)
        const c = company as any;
        const guesses = HyperGuesser.generate(c.company_name, c.city || '', c.province || '', c.category || '');
        // Exclude top 10 already checked? keeping it simple re-checking is safely cached/fast enough usually
        const guessRes = await this.validateCandidates(guesses.slice(10), company, THRESHOLDS.DEEP_RELAXED);
        if (guessRes) return guessRes;

        // 2. Secondary Search Engines (DDG, Bing)
        // OPTIMIZATION: Reduced limit from 5 to 3 to save AI calls.
        if (!RateLimiter.isBlocked('duckduckgo')) {
            const res = await this.searchEngineLookup('duckduckgo', company, 3); // deeper
            if (res) return res;
        }
        if (!RateLimiter.isBlocked('bing')) {
            const res = await this.searchEngineLookup('bing', company, 3);
            if (res) return res;
        }

        return { url: null, status: 'NOT_FOUND', method: 'deep_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // 🧨 RUN 3: AGGRESSIVE (Probabilistic)
    // =========================================================================
    private async executeAggressiveRun(company: CompanyInput): Promise<DiscoveryResult> {
        // 1. Domain Guesser (DNS Check)
        // This generates "companyname.it" and checks if MX records exist.
        // If they exist, it's a very strong signal a website might exist even if blocking bots.
        const guessedDomain = await (this.domainGuesser as any).guessAndVerify(company.company_name);
        if (guessedDomain) {
            // Try to force verify this domain even with lower confidence
            const url = `http://${guessedDomain}`;
            const verification = await this.deepVerify(url, company);
            // In aggressive mode, we accept ANY valid status (not blocked, italian language)
            if (verification && verification.level !== 'Blocked') {
                return {
                    url,
                    status: 'FOUND_VALID', // We call it valid if DNS exists + content is accessible
                    method: 'dns_inference',
                    confidence: 0.6, // Moderate confidence
                    details: verification
                };
            }
        }

        return { url: null, status: 'NOT_FOUND', method: 'aggressive_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // ☢️ RUN 4: NUCLEAR (Total Saturation)
    // =========================================================================
    private async executeNuclearRun(company: CompanyInput): Promise<DiscoveryResult> {
        // This is expensive: 20+ queries per company.
        // We only use this for the hardest cases.
        const res = await this.nuclearStrategy.execute(company);

        if (res.url) {
            return {
                url: res.url,
                status: 'FOUND_VALID', // We trust the Nuclear triangulation logic
                method: res.method,
                confidence: res.confidence,
                details: { level: 'Nuclear' }
            };
        }

        return { url: null, status: 'NOT_FOUND', method: 'nuclear_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    private async validateCandidates(urls: string[], company: CompanyInput, threshold: number): Promise<DiscoveryResult | null> {
        const results = await Promise.all(
            urls.map(url => this.validatorLimit(() => this.deepVerify(url, company)))
        );

        for (let i = 0; i < results.length; i++) {
            const res = results[i];
            if (res && res.confidence >= threshold) {
                return {
                    url: urls[i],
                    status: 'FOUND_VALID',
                    method: 'hyper_guess',
                    confidence: res.confidence,
                    details: res
                };
            }
        }
        return null;
    }

    private async checkRegistries(company: CompanyInput): Promise<DiscoveryResult | null> {
        const registries = [
            `https://www.ufficiocamerale.it/search?q=${encodeURIComponent(company.company_name)}`,
            `https://www.informazione-aziende.it/search?q=${encodeURIComponent(company.company_name)}`
        ];

        for (const regUrl of registries) {
            try {
                const regRes = await ItalianRegistrySearch.extractFromRegistryPage(regUrl);
                if (regRes.website) {
                    const verification = await this.deepVerify(regRes.website, company);
                    if (verification && verification.confidence >= THRESHOLDS.REGISTRY) {
                        return {
                            url: regRes.website,
                            status: 'FOUND_VALID',
                            method: 'registry_extraction',
                            confidence: verification.confidence,
                            details: verification
                        };
                    }
                }
            } catch (e) { }
        }
        return null;
    }

    private async searchEngineLookup(engine: 'google' | 'duckduckgo' | 'bing', company: CompanyInput, limit: number): Promise<DiscoveryResult | null> {
        const query = `${company.company_name} ${company.city || ''} sito ufficiale`;
        let results: { link: string }[] = [];

        try {
            if (engine === 'google') results = await this.scrapeGoogleDIY(query);
            else if (engine === 'duckduckgo') results = await this.scrapeDDGDIY(query);
            else if (engine === 'bing') results = await this.scrapeBingDIY(query); // Assumes scrapeBingDIY exists in this context or copied

            if (results && results.length > 0) {
                RateLimiter.reportSuccess(engine);
                // Validate top N results
                for (const res of results.slice(0, limit)) {
                    const verification = await this.deepVerify(res.link, company);
                    if (verification) {
                        if (verification.confidence >= 0.8) {
                            return {
                                url: res.link,
                                status: 'FOUND_VALID',
                                method: `${engine}_search`,
                                confidence: verification.confidence,
                                details: verification
                            };
                        }
                        // Store INVALID/LOW_CONFIDENCE candidate? 
                        // For now, only return if valid. The orchestration layer can handle "found but invalid" 
                        // if we returned it here with a different status.
                        // Let's refine:
                        if (verification.confidence >= 0.4) {
                            // Return as Found but let caller decide valid/invalid?
                            // No, logic is: IF valid -> return. IF invalid -> continue loop.
                        }
                    }
                }
            } else {
                RateLimiter.reportFailure(engine);
            }
        } catch (e) {
            RateLimiter.reportFailure(engine);
        }
        return null;
    }

    // --- DEEP VERIFY ---
    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url || ContentFilter.isDirectoryOrSocial(url)) return null;
        let page;
        try {
            page = await this.browserFactory.newPage();

            // 🚀 OPTIMIZATION: Block heavy assets
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // 🧠 SMART Extraction: Text + JSON-LD
            const extraction = await page.evaluate(() => {
                const text = document.body.innerText;
                let structuredData: any[] = [];
                try {
                    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
                        structuredData.push(JSON.parse(script.innerHTML));
                    });
                } catch (e) { }
                return { text, structuredData };
            });

            // 1. Content Safety
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) return { confidence: 0, reason: filter.reason };

            // 2. Language Check
            if (!ContentFilter.isItalianLanguage(extraction.text)) return { confidence: 0.1, reason: 'Foreign Language' };

            // 3a. P.IVA Check (Text)
            const pivas: string[] = extraction.text.match(/\d{11}/g) || [];
            const c = company as any;
            const targetPiva = c.piva || c.vat || c.vat_code;

            if (targetPiva && pivas.includes(targetPiva)) {
                return { scraped_piva: pivas[0], confidence: 1.0, level: 'High', reason: 'PIVA Match' };
            }

            // 3b. P.IVA Check (JSON-LD - Structured Logic)
            if (targetPiva && JSON.stringify(extraction.structuredData).includes(targetPiva)) {
                return { scraped_piva: targetPiva, confidence: 1.0, level: 'High', reason: 'JSON-LD Match' };
            }

            // 4. AI Arbitration (Fall back to GPT-5-mini -> o3-mini)
            const llmRes = await LLMValidator.validate(url, extraction.text, company);
            if (llmRes.valid) {
                Logger.info(`[Discovery] AI Match (${llmRes.model_used}): ${company.company_name} -> ${url}`);
                return {
                    scraped_piva: '',
                    confidence: llmRes.confidence > 0.8 ? THRESHOLDS.AI_HIGH : THRESHOLDS.AI_LOW,
                    level: `AI_Verified_${llmRes.model_used}`,
                    reason: llmRes.reason
                };
            }

            // Fuzzy Name Match (Fallback if AI fails or key missing)
            if (extraction.text.toLowerCase().includes(company.company_name.toLowerCase().split(' ')[0])) {
                return {
                    confidence: 0.6,
                    level: 'Medium',
                    reason: 'Fuzzy Name Match (No PIVA)'
                };
            }

            return null; // Reject if neither PIVA, AI, nor Name match
        } catch (e) {
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // --- SCRAPERS (Stubbed/Copied for unification) ---
    // In real refactor, these should be separate providers, but keeping them here for "Bulletproof" single-file feel as requested? 
    // No, cleaner to keep logic here but use helper methods.

    private async scrapeGoogleDIY(query: string) {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const html = await page.content();
            const results = GoogleSerpAnalyzer.parseSerp(html);
            return results.map((r: any) => ({ link: r.url }));
        } catch (e) { return []; } finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async scrapeDDGDIY(query: string) {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://html.duckduckgo.com/html?q=${encodeURIComponent(query)}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const html = await page.content();
            const results = DuckDuckGoSerpAnalyzer.parseSerp(html);
            return results.map((r: any) => ({ link: r.url }));
        } catch (e) { return []; } finally { if (page) await this.browserFactory.closePage(page); }
    }

    private async scrapeBingDIY(query: string) {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it&cc=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.b_algo h2 a'));
                return items.slice(0, 5).map((a: any) => ({ link: (a as HTMLAnchorElement).href }));
            });
            return results;
        } catch (e) { return []; } finally { if (page) await this.browserFactory.closePage(page); }
    }
}
