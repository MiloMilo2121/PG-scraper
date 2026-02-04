
import pLimit from 'p-limit';
import { BrowserFactory } from '../browser/factory_v2';
import { GeneticFingerprinter } from '../browser/genetic_fingerprinter';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { RateLimiter, MemoryRateLimiter } from '../rate_limiter';
import { ContentFilter } from './content_filter';
import { HyperGuesser } from './hyper_guesser_v2';
import { ItalianRegistrySearch } from './italian_registry';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { NuclearStrategy } from './nuclear_strategy';
import { DomainGuesser } from '../../utils/domain_guesser';
import { LLMValidator } from '../ai/llm_validator';
import { AntigravityClient } from '../../observability/antigravity_client';
import { SatelliteVerifier } from '../verification/satellite_verifier';
import { HoneyPotDetector } from '../security/honeypot_detector';

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
    private rateLimiter: RateLimiter;

    constructor(
        browserFactory?: BrowserFactory,
        rateLimiter?: RateLimiter
    ) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
        this.rateLimiter = rateLimiter || new MemoryRateLimiter();
        this.domainGuesser = new DomainGuesser();
        this.nuclearStrategy = new NuclearStrategy();
    }

    public async discover(company: CompanyInput, mode: DiscoveryMode): Promise<DiscoveryResult> {
        Logger.info(`[Unified] Analyzing "${company.company_name}" (Mode: ${mode})`);

        // Notify Antigravity: START
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { mode });

        try {
            // --- STRATEGY 0: PRE-VALIDATION (Check Website from Step 1) ---
            if (company.website && company.website.length > 5 && !company.website.includes('paginegialle.it')) {
                Logger.info(`[Unified] 🏁 Verifying Pre-Scraped Website: ${company.website}`);
                const preVer = await this.deepVerify(company.website, company);
                if (preVer && preVer.confidence >= 0.6) {
                    const res: DiscoveryResult = {
                        url: company.website,
                        status: 'FOUND_VALID',
                        method: 'step1_scraped',
                        confidence: preVer.confidence,
                        details: preVer
                    };
                    this.notifySuccess(company, res);
                    return res;
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
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { error: (error as Error).message });
            return { url: null, status: 'ERROR', method: 'exception', confidence: 0, details: { error: (error as Error).message } };
        }

        // Notify Antigravity: NOT FOUND
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'Exhausted strategies' });
        return { url: null, status: 'NOT_FOUND', method: 'exhausted', confidence: 0, details: {} };
    }

    private notifySuccess(company: CompanyInput, res: DiscoveryResult) {
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'FOUND', {
            url: res.url,
            method: res.method,
            confidence: res.confidence
        });

        // 🕸️ KNOWLEDGE GRAPH UPDATE
        try {
            // Enrich company input with found website before merging
            const enrichedCompany = { ...company, website: res.url || company.website };
            import('../knowledge/graph_client').then(({ GraphClient }) => {
                const client = GraphClient.getInstance();
                // Fire and forget to not block flow
                client.mergeCompany(enrichedCompany).catch(e => {
                    // Silent fail for now if DB down
                });
            });
        } catch (e) { }
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
        if (guessRes) { this.notifySuccess(company, guessRes); return guessRes; }

        // 2. Direct Registry (UfficioCamerale etc.)
        const regRes = await this.checkRegistries(company);
        if (regRes) { this.notifySuccess(company, regRes); return regRes; }

        // 3. Primary Search Engine (Google only, top 3)
        await this.rateLimiter.waitForSlot('google');
        const googleRes = await this.searchEngineLookup('google', company, 3);
        if (googleRes) { this.notifySuccess(company, googleRes); return googleRes; }

        // 3b. REVERSE LOOKUP (Phone) - "045 12345" sito web
        if (company.phone && company.phone.length > 5) {
            Logger.info(`[Unified] 📞 Reverse searching phone: "${company.phone}"`);
            await this.rateLimiter.waitForSlot('google');
            const query = `"${company.phone}" sito web`;
            const phoneRes = await this.searchEngineLookup('google', { ...company, company_name: query }, 3);
            if (phoneRes) {
                const res: DiscoveryResult = { ...phoneRes, method: 'reverse_phone' };
                this.notifySuccess(company, res);
                return res;
            }
        }

        // Fallback to DDG
        await this.rateLimiter.waitForSlot('duckduckgo');
        const ddgRes = await this.searchEngineLookup('duckduckgo', company, 3);
        if (ddgRes) { this.notifySuccess(company, ddgRes); return ddgRes; }

        return { url: null, status: 'NOT_FOUND', method: 'fast_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // 💰 ENRICHMENT: FINANCIALS (Revenue / P.IVA)
    // =========================================================================
    public async enrichFinancials(company: CompanyInput): Promise<CompanyInput> {
        const targetId = company.piva || company.vat_code || company.fiscal_code;
        if (targetId) {
            Logger.info(`[Financials] Searching revenue for P.IVA: ${targetId}`);
            // Logic placeholder
        }
        return company;
    }

    // =========================================================================
    // 🧠 RUN 2: DEEP (Coverage First)
    // =========================================================================
    private async executeDeepRun(company: CompanyInput): Promise<DiscoveryResult> {
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { step: 'Deep Run Escalation' });

        // 1. Extended HyperGuesser
        const c = company as any;
        const guesses = HyperGuesser.generate(c.company_name, c.city || '', c.province || '', c.category || '');
        const guessRes = await this.validateCandidates(guesses.slice(10), company, THRESHOLDS.DEEP_RELAXED);
        if (guessRes) { this.notifySuccess(company, guessRes); return guessRes; }

        // 2. Secondary Search
        await this.rateLimiter.waitForSlot('duckduckgo');
        const res = await this.searchEngineLookup('duckduckgo', company, 3);
        if (res) { this.notifySuccess(company, res); return res; }

        await this.rateLimiter.waitForSlot('bing');
        const resBing = await this.searchEngineLookup('bing', company, 3);
        if (resBing) { this.notifySuccess(company, resBing); return resBing; }

        return { url: null, status: 'NOT_FOUND', method: 'deep_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // 🧨 RUN 3: AGGRESSIVE (Probabilistic)
    // =========================================================================
    private async executeAggressiveRun(company: CompanyInput): Promise<DiscoveryResult> {
        const guessedDomain = await (this.domainGuesser as any).guessAndVerify(company.company_name);
        if (guessedDomain) {
            const url = `http://${guessedDomain}`;
            const verification = await this.deepVerify(url, company);
            if (verification && verification.confidence >= 0.4) { // Lower bar
                const res: DiscoveryResult = {
                    url,
                    status: 'FOUND_VALID',
                    method: 'dns_inference',
                    confidence: 0.6,
                    details: verification
                };
                this.notifySuccess(company, res);
                return res;
            }
        }
        return { url: null, status: 'NOT_FOUND', method: 'aggressive_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // ☢️ RUN 4: NUCLEAR (Total Saturation)
    // =========================================================================
    private async executeNuclearRun(company: CompanyInput): Promise<DiscoveryResult> {
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { step: 'NUCLEAR LAUNCH DETECTED' });
        const res = await this.nuclearStrategy.execute(company);

        if (res.url) {
            const result: DiscoveryResult = {
                url: res.url,
                status: 'FOUND_VALID',
                method: res.method,
                confidence: res.confidence,
                details: { level: 'Nuclear' }
            };
            this.notifySuccess(company, result);
            return result;
        }

        // 🛰️ SATELLITE VERIFICATION (Fall back if no web found but we want physical confirmation)
        if (company.address && company.city && process.env.ENABLE_SATELLITE_VERIFICATION === 'true') {
            Logger.info(`[Nuclear] 🛰️ Initiating Satellite Verification for: ${company.address}`);
            const satellite = SatelliteVerifier.getInstance();
            const image = await satellite.fetchStreetView(company.address, company.city);

            if (image) {
                const analysis = await satellite.analyzeImage(image, company.company_name);
                if (analysis.isCommercial && analysis.confidence > 0.7) {
                    return {
                        url: null, // No website
                        status: 'FOUND_VALID', // But valid business!
                        method: 'satellite_vision',
                        confidence: analysis.confidence,
                        details: { ...analysis, note: 'Physical Presence Verified' }
                    };
                }
            }
        }

        return { url: null, status: 'NOT_FOUND', method: 'nuclear_exhausted', confidence: 0, details: {} };
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    private async validateCandidates(urls: string[], company: CompanyInput, threshold: number): Promise<DiscoveryResult | null> {
        // Parallel Verification
        const results = await Promise.all(
            urls.map(url => this.validatorLimit(async () => {
                const res = await this.deepVerify(url, company);
                if (res && res.confidence >= threshold) return { url, details: res };
                return null;
            }))
        );

        // Filter valid
        const validCandidates = results.filter(r => r !== null) as { url: string, details: any }[];

        if (validCandidates.length === 0) return null;
        if (validCandidates.length === 1) {
            return {
                url: validCandidates[0].url,
                status: 'FOUND_VALID',
                method: 'hyper_guess',
                confidence: validCandidates[0].details.confidence,
                details: validCandidates[0].details
            };
        }

        // ⚖️ TRUST ARBITER: Resolve conflicts
        // We need to import TrustArbiter dynamically or statically
        const { TrustArbiter } = require('../knowledge/trust_arbiter'); // Lazy load to avoid circular if any
        const arbiter = new TrustArbiter(); // Or singleton if available

        // Map to Arbiter Candidates
        const arbiterCandidates = validCandidates.map(c => ({
            source: 'WebScraper',
            url: c.url,
            confidence: c.details.confidence,
            metadata: c.details
        }));

        const best = await arbiter.resolve(company, arbiterCandidates);

        if (best) {
            return {
                url: best.url,
                status: 'FOUND_VALID',
                method: 'trust_arbiter_consensus',
                confidence: best.confidence,
                details: best.metadata
            };
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
            else if (engine === 'bing') results = await this.scrapeBingDIY(query);

            if (results && results.length > 0) {
                this.rateLimiter.reportSuccess(engine);
                for (const res of results.slice(0, limit)) {
                    const verification = await this.deepVerify(res.link, company);
                    if (verification) {
                        if (verification.confidence >= 0.8) { // Base trust
                            return {
                                url: res.link,
                                status: 'FOUND_VALID',
                                method: `${engine}_search`,
                                confidence: verification.confidence,
                                details: verification
                            };
                        }
                    }
                }
            } else {
                this.rateLimiter.reportFailure(engine);
            }
        } catch (e) {
            this.rateLimiter.reportFailure(engine);
        }
        return null;
    }

    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url || ContentFilter.isDirectoryOrSocial(url)) return null;
        let page;
        try {
            page = await this.browserFactory.newPage();

            // Resource optimization
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const extraction = await page.evaluate(() => {
                const text = document.body.innerText;
                const html = document.body.innerHTML;
                let structuredData: any[] = [];
                try {
                    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
                        structuredData.push(JSON.parse(script.innerHTML));
                    });
                } catch (e) { }
                return { text, html, structuredData };
            });

            // 🛡️ HONEYPOT CHECK 2: Content Analysis
            const honeyPot = HoneyPotDetector.getInstance();
            const safety = honeyPot.analyzeContent(extraction.html);
            if (!safety.safe) {
                Logger.warn(`[DeepVerify] 🍯 Trap Detected: ${url} -> ${safety.reason}`);
                return { confidence: 0, reason: safety.reason };
            }

            // 1. Content Safety
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) {
                if (extraction.text.includes('Captcha') || extraction.text.includes('Access Denied')) {
                    const geneId = (page as any).__geneId;
                    if (geneId) GeneticFingerprinter.getInstance().reportFailure(geneId);
                }
                return { confidence: 0, reason: filter.reason };
            }

            // 🧬 SUCCESS: We accessed the page effectively
            const geneId = (page as any).__geneId;
            if (geneId) GeneticFingerprinter.getInstance().reportSuccess(geneId);

            // 2. Language
            if (!ContentFilter.isItalianLanguage(extraction.text)) return { confidence: 0.1, reason: 'Foreign Language' };

            // 3. LLM/AI Validation
            const llmRes = await LLMValidator.validateCompany(company, extraction.text);
            if (llmRes.isValid) {
                return {
                    scraped_piva: '',
                    confidence: llmRes.confidence,
                    level: 'AI_Verified',
                    reason: llmRes.reason
                };
            }

            // Fallback PIVA check
            const pivas: string[] = extraction.text.match(/\d{11}/g) || [];
            const targetPiva = company.vat_code || company.piva;

            if (targetPiva && pivas.includes(targetPiva)) {
                return { scraped_piva: pivas[0], confidence: 1.0, level: 'High', reason: 'PIVA Match' };
            }

            return null;

        } catch (e: any) {
            // 👻 GHOST HUNTER: Website is dead? Check the archive.
            if (e.message.includes('ERR_NAME_NOT_RESOLVED') || e.message.includes('timeout') || e.message.includes('404')) {
                import('./ghost_hunter').then(async ({ GhostHunter }) => {
                    const ghost = GhostHunter.getInstance();
                    const ghostHtml = await ghost.recover(url);
                    if (ghostHtml) {
                        Logger.info(`[DeepVerify] 👻 Recovered dead site ${url} via Wayback Machine!`);
                        // We could recursively validate this ghost content, but for now we log it.
                        // Ideally call LLMValidator here.
                    }
                });
            }
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // --- SCRAPERS ---
    private async scrapeGoogleDIY(query: string) {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const html = await page.content();
            const results = await GoogleSerpAnalyzer.parseSerp(html);
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
