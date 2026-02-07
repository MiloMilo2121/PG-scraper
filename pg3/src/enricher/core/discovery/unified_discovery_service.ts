/**
 * 🌊 UNIFIED DISCOVERY SERVICE v2
 * WAVE-BASED ARCHITECTURE
 * 
 * Wave 1: THE SWARM (Parallel: HyperGuesser + Google Name + Google Address + Google Phone)
 * Wave 2: THE NET (Fallback: Bing + DuckDuckGo)
 * Wave 3: THE JUDGE (AI Validation if Regex fails)
 * 
 * NO REGISTRY CALLS HERE - Registries are for Financial data only
 */

import pLimit from 'p-limit';
import { HTTPRequest } from 'puppeteer';
import { BrowserFactory } from '../browser/factory_v2';
import { GeneticFingerprinter } from '../browser/genetic_fingerprinter';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { RateLimiter, MemoryRateLimiter } from '../rate_limiter';
import { ContentFilter } from './content_filter';
import { HyperGuesser } from './hyper_guesser_v2';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { LLMValidator } from '../ai/llm_validator';
import { AntigravityClient } from '../../observability/antigravity_client';
import { HoneyPotDetector } from '../security/honeypot_detector';
import { config } from '../../config';

// ============================================================================
// INTERFACES
// ============================================================================

// Discovery modes for multi-run pipeline (runner.ts)
export enum DiscoveryMode {
    FAST_RUN1 = 'FAST_RUN1',         // Quick pass with basic methods
    DEEP_RUN2 = 'DEEP_RUN2',         // Full wave execution
    AGGRESSIVE_RUN3 = 'AGGRESSIVE_RUN3', // Retry with relaxed thresholds
    NUCLEAR_RUN4 = 'NUCLEAR_RUN4'    // All methods, maximum effort
}

export interface DiscoveryResult {
    url: string | null;
    status: 'FOUND_VALID' | 'FOUND_INVALID' | 'NOT_FOUND' | 'ERROR';
    method: string;
    confidence: number;
    wave: string;
    details: any;
}

export interface WaveResult {
    candidates: Array<{
        url: string;
        source: string;
        rawConfidence: number;
    }>;
}

const THRESHOLDS = {
    WAVE1_SWARM: config.discovery.thresholds.wave1,
    WAVE2_NET: config.discovery.thresholds.wave2,
    WAVE3_JUDGE: config.discovery.thresholds.wave3,
    MINIMUM_VALID: config.discovery.thresholds.minValid
};

// ============================================================================
// UNIFIED DISCOVERY SERVICE v2
// ============================================================================

export class UnifiedDiscoveryService {
    private browserFactory: BrowserFactory;
    private rateLimiter: RateLimiter;
    private validatorLimit = pLimit(5);
    private fingerprinter: GeneticFingerprinter;

    constructor(
        browserFactory?: BrowserFactory,
        rateLimiter?: RateLimiter
    ) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
        this.rateLimiter = rateLimiter || new MemoryRateLimiter();
        this.fingerprinter = GeneticFingerprinter.getInstance();
    }

    // =========================================================================
    // 🌊 MAIN DISCOVERY ENTRY POINT
    // =========================================================================
    public async discover(company: CompanyInput, mode: DiscoveryMode = DiscoveryMode.DEEP_RUN2): Promise<DiscoveryResult> {
        Logger.info(`[Discovery] 🌊 Starting WAVE discovery for "${company.company_name}" (Mode: ${mode})`);
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { mode });

        try {
            // --- PRE-CHECK: Validate existing website if present ---
            if (company.website && company.website.length > 5 && !company.website.includes('paginegialle.it')) {
                Logger.info(`[Discovery] 🏁 Pre-validating existing website: ${company.website}`);
                const preCheck = await this.deepVerify(company.website, company);
                if (preCheck && preCheck.confidence >= THRESHOLDS.MINIMUM_VALID) {
                    const result: DiscoveryResult = {
                        url: company.website,
                        status: 'FOUND_VALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck
                    };
                    this.notifySuccess(company, result);
                    return result;
                }
            }

            // =====================================================================
            // 🌊 WAVE 1: THE SWARM (Parallel Execution)
            // =====================================================================
            Logger.info(`[Discovery] 🐝 WAVE 1: THE SWARM`);
            const wave1Result = await this.executeWave1Swarm(company);
            if (wave1Result) {
                this.notifySuccess(company, wave1Result);
                return wave1Result;
            }

            // =====================================================================
            // 🌊 WAVE 2: THE NET (Bing + DuckDuckGo)
            // =====================================================================
            Logger.info(`[Discovery] 🕸️ WAVE 2: THE NET`);
            const wave2Result = await this.executeWave2Net(company);
            if (wave2Result) {
                this.notifySuccess(company, wave2Result);
                return wave2Result;
            }

            // =====================================================================
            // 🌊 WAVE 3: THE JUDGE (AI Validation)
            // =====================================================================
            Logger.info(`[Discovery] ⚖️ WAVE 3: THE JUDGE`);
            const wave3Result = await this.executeWave3Judge(company);
            if (wave3Result) {
                this.notifySuccess(company, wave3Result);
                return wave3Result;
            }

            // All waves exhausted
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'All waves exhausted' });
            return {
                url: null,
                status: 'NOT_FOUND',
                method: 'waves_exhausted',
                confidence: 0,
                wave: 'ALL',
                details: {}
            };

        } catch (error) {
            Logger.error(`[Discovery] Error for ${company.company_name}:`, { error: error as Error });
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { error: (error as Error).message });
            return {
                url: null,
                status: 'ERROR',
                method: 'exception',
                confidence: 0,
                wave: 'ERROR',
                details: { error: (error as Error).message }
            };
        }
    }

    // =========================================================================
    // 🐝 WAVE 1: THE SWARM
    // Parallel: HyperGuesser + Google Name + Google Address + Google Phone
    // =========================================================================
    private async executeWave1Swarm(company: CompanyInput): Promise<DiscoveryResult | null> {
        // Launch all methods in parallel
        const [
            hyperGuessResult,
            googleNameResult,
            googleAddressResult,
            googlePhoneResult
        ] = await Promise.all([
            this.hyperGuesserAttack(company),
            this.googleSearchByName(company),
            this.googleSearchByAddress(company),
            this.googleSearchByPhone(company)
        ]);

        // Collect all candidates
        const allCandidates: Array<{ url: string; source: string; confidence: number }> = [];

        if (hyperGuessResult) allCandidates.push(...hyperGuessResult);
        if (googleNameResult) allCandidates.push(...googleNameResult);
        if (googleAddressResult) allCandidates.push(...googleAddressResult);
        if (googlePhoneResult) allCandidates.push(...googlePhoneResult);

        Logger.info(`[Wave1] 🐝 Collected ${allCandidates.length} candidates from Swarm`);

        // Validate candidates in parallel
        return await this.validateAndSelectBest(allCandidates, company, 'WAVE1_SWARM', THRESHOLDS.WAVE1_SWARM);
    }

    private async hyperGuesserAttack(company: CompanyInput): Promise<Array<{ url: string; source: string; confidence: number }> | null> {
        try {
            const guesses = HyperGuesser.generate(
                company.company_name,
                company.city || '',
                company.province || '',
                company.category || ''
            );

            // Take top 15 guesses for DNS resolution
            const topGuesses = guesses.slice(0, 15);
            Logger.info(`[HyperGuesser] Generated ${topGuesses.length} domain candidates`);

            return topGuesses.map(url => ({
                url,
                source: 'hyper_guesser',
                confidence: 0.7 // Initial confidence, will be verified
            }));
        } catch (e) {
            Logger.warn(`[HyperGuesser] Failed:`, { error: e as Error });
            return null;
        }
    }

    private async googleSearchByName(company: CompanyInput): Promise<Array<{ url: string; source: string; confidence: number }> | null> {
        try {
            await this.rateLimiter.waitForSlot('google');
            const query = `"${company.company_name}" ${company.city || ''} sito ufficiale`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 5).map(r => ({
                url: r.link,
                source: 'google_name',
                confidence: 0.75
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google name search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async googleSearchByAddress(company: CompanyInput): Promise<Array<{ url: string; source: string; confidence: number }> | null> {
        if (!company.address) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            // Task 04: Reverse Address Search with exact match
            const query = `"${company.address}" ${company.city || ''} sito web`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 3).map(r => ({
                url: r.link,
                source: 'google_address',
                confidence: 0.8 // Higher confidence for address match
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google address search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async googleSearchByPhone(company: CompanyInput): Promise<Array<{ url: string; source: string; confidence: number }> | null> {
        if (!company.phone || company.phone.length < 6) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            const query = `"${company.phone}" sito web`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 3).map(r => ({
                url: r.link,
                source: 'google_phone',
                confidence: 0.85 // High confidence for phone match
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google phone search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    // =========================================================================
    // 🕸️ WAVE 2: THE NET (Bing + DuckDuckGo)
    // =========================================================================
    private async executeWave2Net(company: CompanyInput): Promise<DiscoveryResult | null> {
        const allCandidates: Array<{ url: string; source: string; confidence: number }> = [];

        // Bing search
        try {
            await this.rateLimiter.waitForSlot('bing');
            const query = `${company.company_name} ${company.city || ''} sito`;
            const bingResults = await this.scrapeBingDIY(query);
            bingResults.slice(0, 5).forEach(r => {
                allCandidates.push({ url: r.link, source: 'bing', confidence: 0.65 });
            });
            this.rateLimiter.reportSuccess('bing');
        } catch (e) {
            this.rateLimiter.reportFailure('bing');
            Logger.warn('[Wave2] Bing search failed', { error: e as Error, company_name: company.company_name });
        }

        // DuckDuckGo search
        try {
            await this.rateLimiter.waitForSlot('duckduckgo');
            const query = `${company.company_name} ${company.city || ''} sito ufficiale`;
            const ddgResults = await this.scrapeDDGDIY(query);
            ddgResults.slice(0, 5).forEach(r => {
                allCandidates.push({ url: r.link, source: 'duckduckgo', confidence: 0.65 });
            });
            this.rateLimiter.reportSuccess('duckduckgo');
        } catch (e) {
            this.rateLimiter.reportFailure('duckduckgo');
            Logger.warn('[Wave2] DuckDuckGo search failed', { error: e as Error, company_name: company.company_name });
        }

        Logger.info(`[Wave2] 🕸️ Collected ${allCandidates.length} candidates from Net`);

        return await this.validateAndSelectBest(allCandidates, company, 'WAVE2_NET', THRESHOLDS.WAVE2_NET);
    }

    // =========================================================================
    // ⚖️ WAVE 3: THE JUDGE (AI-powered final validation)
    // =========================================================================
    private async executeWave3Judge(company: CompanyInput): Promise<DiscoveryResult | null> {
        // Collect any remaining unverified candidates and use AI for final validation
        Logger.info(`[Wave3] ⚖️ AI Judge - attempting low-confidence redemption`);

        // Try DNS-based domain guessing with AI validation
        const guesses = HyperGuesser.generate(
            company.company_name,
            company.city || '',
            company.province || '',
            company.category || ''
        );

        // Try remaining guesses (after top 15 used in Wave 1)
        for (const url of guesses.slice(15, 30)) {
            try {
                const verification = await this.deepVerifyWithAI(url, company);
                if (verification && verification.confidence >= THRESHOLDS.WAVE3_JUDGE) {
                    return {
                        url,
                        status: 'FOUND_VALID',
                        method: 'ai_judge',
                        confidence: verification.confidence,
                        wave: 'WAVE3_JUDGE',
                        details: verification
                    };
                }
            } catch (e) {
                Logger.warn('[Wave3] AI judge candidate verification failed', {
                    error: e as Error,
                    company_name: company.company_name,
                    url,
                });
                continue;
            }
        }

        return null;
    }

    // =========================================================================
    // VALIDATION HELPERS
    // =========================================================================

    private async validateAndSelectBest(
        candidates: Array<{ url: string; source: string; confidence: number }>,
        company: CompanyInput,
        wave: string,
        threshold: number
    ): Promise<DiscoveryResult | null> {
        if (candidates.length === 0) return null;

        // Deduplicate by URL
        const seen = new Set<string>();
        const unique = candidates.filter(c => {
            if (seen.has(c.url)) return false;
            if (ContentFilter.isDirectoryOrSocial(c.url)) return false;
            seen.add(c.url);
            return true;
        });

        Logger.info(`[${wave}] Validating ${unique.length} unique candidates...`);

        // Parallel verification with concurrency limit
        const verifications = await Promise.all(
            unique.slice(0, 10).map(candidate =>
                this.validatorLimit(async () => {
                    const result = await this.deepVerify(candidate.url, company);
                    if (result && result.confidence >= threshold) {
                        return {
                            url: candidate.url,
                            source: candidate.source,
                            confidence: result.confidence,
                            details: result
                        };
                    }
                    return null;
                })
            )
        );

        // Filter valid results
        const valid = verifications.filter(v => v !== null) as Array<{
            url: string;
            source: string;
            confidence: number;
            details: any;
        }>;

        if (valid.length === 0) return null;

        // Select best by confidence
        valid.sort((a, b) => b.confidence - a.confidence);
        const best = valid[0];

        return {
            url: best.url,
            status: 'FOUND_VALID',
            method: best.source,
            confidence: best.confidence,
            wave,
            details: best.details
        };
    }

    // =========================================================================
    // DEEP VERIFICATION
    // =========================================================================

    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url || ContentFilter.isDirectoryOrSocial(url)) return null;

        let page;
        try {
            page = await this.browserFactory.newPage();

            // Block unnecessary resources
            await page.setRequestInterception(true);
            const requestHandler = (req: HTTPRequest) => {
                if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            };
            page.on('request', requestHandler);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const extraction = await page.evaluate(() => {
                const text = document.body?.innerText || '';
                const html = document.body?.innerHTML || '';
                return { text, html };
            });

            // 🛡️ HONEYPOT CHECK
            const honeyPot = HoneyPotDetector.getInstance();
            const safety = honeyPot.analyzeContent(extraction.html);
            if (!safety.safe) {
                Logger.warn(`[DeepVerify] 🍯 Trap: ${url} -> ${safety.reason}`);
                return { confidence: 0, reason: safety.reason };
            }

            // Content validation
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) {
                // Report failure to genetic algorithm if blocked
                if (extraction.text.includes('Captcha') || extraction.text.includes('Access Denied')) {
                    const geneId = (page as any).__geneId;
                    if (geneId) this.fingerprinter.reportFailure(geneId);
                }
                return { confidence: 0, reason: filter.reason };
            }

            // Report success to genetic algorithm
            const geneId = (page as any).__geneId;
            if (geneId) this.fingerprinter.reportSuccess(geneId);

            // Language check
            if (!ContentFilter.isItalianLanguage(extraction.text)) {
                return { confidence: 0.1, reason: 'Foreign Language' };
            }

            // REGEX VALIDATION FIRST (faster than AI)
            const nameMatch = this.regexCompanyMatch(extraction.text, company);
            if (nameMatch.confidence >= 0.8) {
                return nameMatch;
            }

            // P.IVA match
            const pivas: string[] = extraction.text.match(/\d{11}/g) || [];
            const targetPiva = company.vat_code || company.piva || company.vat;
            if (targetPiva && pivas.includes(targetPiva)) {
                return { confidence: 1.0, reason: 'P.IVA Match', scraped_piva: targetPiva };
            }

            // Check for name presence
            const companyNameLower = company.company_name.toLowerCase();
            if (extraction.text.toLowerCase().includes(companyNameLower)) {
                return { confidence: 0.7, reason: 'Name Present' };
            }

            return null;

        } catch (e) {
            Logger.warn('[DeepVerify] Verification failed', { error: e as Error, url, company_name: company.company_name });
            return null;
        } finally {
            if (page) {
                page.removeAllListeners('request');
                await this.browserFactory.closePage(page);
            }
        }
    }

    private async deepVerifyWithAI(url: string, company: CompanyInput): Promise<any | null> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.setRequestInterception(true);
            const requestHandler = (req: HTTPRequest) => {
                if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            };
            page.on('request', requestHandler);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const text = await page.evaluate(() => document.body?.innerText || '');

            // Use LLM for final validation
            const llmResult = await LLMValidator.validateCompany(company, text);
            if (llmResult.isValid) {
                return {
                    confidence: llmResult.confidence,
                    reason: llmResult.reason,
                    level: 'AI_Verified'
                };
            }

            return null;
        } catch (e) {
            Logger.warn('[DeepVerifyWithAI] Verification failed', { error: e as Error, url, company_name: company.company_name });
            return null;
        } finally {
            if (page) {
                page.removeAllListeners('request');
                await this.browserFactory.closePage(page);
            }
        }
    }

    private regexCompanyMatch(text: string, company: CompanyInput): { confidence: number; reason: string } {
        const textLower = text.toLowerCase();
        const nameLower = company.company_name.toLowerCase();

        // Direct name match
        if (textLower.includes(nameLower)) {
            // Check for additional signals
            const hasAddress = company.address && textLower.includes(company.address.toLowerCase());
            const hasCity = company.city && textLower.includes(company.city.toLowerCase());
            const hasPhone = company.phone && textLower.includes(company.phone.replace(/\s+/g, ''));

            let confidence = 0.6;
            if (hasAddress) confidence += 0.15;
            if (hasCity) confidence += 0.1;
            if (hasPhone) confidence += 0.15;

            return { confidence: Math.min(confidence, 1.0), reason: 'Regex Match' };
        }

        return { confidence: 0, reason: 'No Match' };
    }

    // =========================================================================
    // SCRAPERS
    // =========================================================================

    private async scrapeGoogleDIY(query: string): Promise<Array<{ link: string }>> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const html = await page.content();
            const results = await GoogleSerpAnalyzer.parseSerp(html);
            return results.map((r: { url: string }) => ({ link: r.url }));
        } catch (e) {
            Logger.warn('[ScrapeGoogleDIY] Failed', { error: e as Error, query });
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async scrapeDDGDIY(query: string): Promise<Array<{ link: string }>> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://html.duckduckgo.com/html?q=${encodeURIComponent(query)}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const html = await page.content();
            const results = DuckDuckGoSerpAnalyzer.parseSerp(html);
            return results.map((r: { url: string }) => ({ link: r.url }));
        } catch (e) {
            Logger.warn('[ScrapeDDGDIY] Failed', { error: e as Error, query });
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async scrapeBingDIY(query: string): Promise<Array<{ link: string }>> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it&cc=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll<HTMLAnchorElement>('.b_algo h2 a'));
                return items.slice(0, 5).map((a) => ({ link: a.href }));
            });
            return results;
        } catch (e) {
            Logger.warn('[ScrapeBingDIY] Failed', { error: e as Error, query });
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // NOTIFICATIONS
    // =========================================================================

    private notifySuccess(company: CompanyInput, result: DiscoveryResult): void {
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'FOUND', {
            url: result.url,
            method: result.method,
            wave: result.wave,
            confidence: result.confidence
        });

        Logger.info(`[Discovery] ✅ FOUND: ${company.company_name} -> ${result.url} (${result.wave}/${result.method}, ${(result.confidence * 100).toFixed(0)}%)`);
    }
}
