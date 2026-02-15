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
import { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { RateLimiter, MemoryRateLimiter } from '../rate_limiter';
import { ContentFilter } from './content_filter';
import { HyperGuesser } from './hyper_guesser_v2';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { SerperSearchProvider, DDGSearchProvider } from './search_provider';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { LLMValidator } from '../ai/llm_validator';
import { AgentRunner } from '../agent/agent_runner';
import { AntigravityClient } from '../../observability/antigravity_client';
import { config } from '../../config';
import { CompanyMatcher } from './company_matcher';
import { DomainValidator } from '../../utils/domain_validator';
import { NuclearStrategy } from './nuclear_strategy';
import { IdentityResolver, IdentityResult } from './identity_resolver';
import { SurgicalSearch } from './surgical_search';
import { PagineGialleHarvester } from '../directories/paginegialle';
import { ScraperClient } from '../../utils/scraper_client';

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

const MIN_INVALID_CONFIDENCE = 0.35;

type Candidate = {
    url: string;
    source: string;
    confidence: number;
};

type ModeProfile = {
    wave1ThresholdDelta: number;
    wave2ThresholdDelta: number;
    wave1MaxCandidates: number;
    wave2MaxCandidates: number;
    wave3GuessStart: number;
    wave3GuessEnd: number;
    runWave2: boolean;
    runWave3: boolean;
    runNuclear: boolean;
};

const MODE_PROFILES: Record<DiscoveryMode, ModeProfile> = {
    [DiscoveryMode.FAST_RUN1]: {
        wave1ThresholdDelta: 0.05,
        wave2ThresholdDelta: 0.05,
        wave1MaxCandidates: 8,
        wave2MaxCandidates: 6,
        wave3GuessStart: 15,
        wave3GuessEnd: 22,
        runWave2: false,
        runWave3: false,
        runNuclear: false,
    },
    [DiscoveryMode.DEEP_RUN2]: {
        wave1ThresholdDelta: 0,
        wave2ThresholdDelta: 0,
        wave1MaxCandidates: 12,
        wave2MaxCandidates: 10,
        wave3GuessStart: 15,
        wave3GuessEnd: 30,
        runWave2: true,
        runWave3: true,
        runNuclear: false,
    },
    [DiscoveryMode.AGGRESSIVE_RUN3]: {
        wave1ThresholdDelta: -0.04,
        wave2ThresholdDelta: -0.05,
        wave1MaxCandidates: 15,
        wave2MaxCandidates: 14,
        wave3GuessStart: 10,
        wave3GuessEnd: 40,
        runWave2: true,
        runWave3: true,
        runNuclear: true,
    },
    [DiscoveryMode.NUCLEAR_RUN4]: {
        wave1ThresholdDelta: -0.07,
        wave2ThresholdDelta: -0.08,
        wave1MaxCandidates: 20,
        wave2MaxCandidates: 20,
        wave3GuessStart: 0,
        wave3GuessEnd: 55,
        runWave2: true,
        runWave3: true,
        runNuclear: true,
    },
};

// ============================================================================
// UNIFIED DISCOVERY SERVICE v2
// ============================================================================

export class UnifiedDiscoveryService {
    private browserFactory: BrowserFactory;
    private rateLimiter: RateLimiter;
    private validatorLimit = pLimit(5);
    private nuclearStrategy: NuclearStrategy;
    private identityResolver: IdentityResolver;
    private surgicalSearch: SurgicalSearch;
    private verificationCache = new Map<string, any>();
    private readonly verificationCacheTtlMs = 15 * 60 * 1000;

    constructor(
        browserFactory?: BrowserFactory,
        rateLimiter?: RateLimiter
    ) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
        this.rateLimiter = rateLimiter || new MemoryRateLimiter();
        this.nuclearStrategy = new NuclearStrategy();
        this.identityResolver = new IdentityResolver();
        this.surgicalSearch = new SurgicalSearch();
    }

    /**
     * 🔎 Verify a single candidate URL without running the full discovery waves.
     * Returns the same evidence payload produced by deep verification.
     */
    public async verifyUrl(url: string, company: CompanyInput): Promise<any | null> {
        return this.deepVerify(url, company);
    }

    // =========================================================================
    // 🌊 MAIN DISCOVERY ENTRY POINT
    // =========================================================================
    public async discover(company: CompanyInput, mode: DiscoveryMode = DiscoveryMode.DEEP_RUN2): Promise<DiscoveryResult> {
        Logger.info(`[Discovery] 🌊 Starting WAVE discovery for "${company.company_name}" (Mode: ${mode})`);
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { mode });
        const profile = MODE_PROFILES[mode] || MODE_PROFILES[DiscoveryMode.DEEP_RUN2];
        let bestInvalid: DiscoveryResult | null = null;
        let identity: IdentityResult | null = null;

        try {
            // =====================================================================
            // 💰 PHASE 0: IDENTITY RESOLUTION (Zero Cost - ALWAYS RUN FIRST)
            // =====================================================================
            Logger.info(`[Discovery] 🕵️ PHASE 0: IDENTITY RESOLUTION`);
            identity = await this.identityResolver.resolveIdentity(company);

            if (identity) {
                Logger.info(`[Discovery] ✅ Identity Resolved: ${identity.legal_name} (${identity.vat_number})`);
            } else {
                Logger.warn(`[Discovery] ⚠️ Identity resolution failed - Will proceed with limited info`);
            }

            // --- PRE-CHECK: Validate existing website if present ---
            if (company.website && company.website.length > 5 && !company.website.includes('paginegialle.it')) {
                Logger.info(`[Discovery] 🏁 Pre-validating existing website: ${company.website}`);
                const preCheck = await this.deepVerify(company.website, company);
                if (preCheck && preCheck.confidence >= THRESHOLDS.MINIMUM_VALID) {
                    const result: DiscoveryResult = {
                        url: preCheck.final_url || company.website,
                        status: 'FOUND_VALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck
                    };
                    const finalRes = this.attachIdentity(result, identity);
                    this.notifySuccess(company, finalRes);
                    return finalRes;
                }
                if (preCheck && preCheck.confidence >= MIN_INVALID_CONFIDENCE) {
                    bestInvalid = {
                        url: preCheck.final_url || company.website,
                        status: 'FOUND_INVALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck,
                    };
                }
            }

            // =====================================================================
            // 🎯 PHASE 1: SURGICAL SEARCH (Heavy Artillery)
            // =====================================================================
            if (identity) {
                Logger.info(`[Discovery] 🎯 PHASE 1: SURGICAL SEARCH`);
                const surgicalResult = await this.surgicalSearch.execute(identity, company);

                if (surgicalResult) {
                    const validResult: DiscoveryResult = {
                        url: surgicalResult.url,
                        status: 'FOUND_VALID',
                        method: surgicalResult.method,
                        confidence: surgicalResult.confidence,
                        wave: 'PHASE1_SURGICAL',
                        details: surgicalResult
                    };
                    const finalRes = this.attachIdentity(validResult, identity);
                    this.notifySuccess(company, finalRes);
                    return finalRes;
                }
            }

            // =====================================================================
            // 🌊 WAVE 1: THE SWARM (Parallel Execution) (FALLBACK)
            // =====================================================================
            Logger.info(`[Discovery] 🐝 WAVE 1: THE SWARM`);
            const wave1Threshold = this.applyThresholdDelta(THRESHOLDS.WAVE1_SWARM, profile.wave1ThresholdDelta);
            let wave1Result = await this.executeWave1Swarm(company, wave1Threshold, profile.wave1MaxCandidates);
            if (wave1Result) {
                if (wave1Result.status === 'FOUND_VALID' && wave1Result.url) {
                    Logger.info(`[Discovery] ✅ FOUND: ${company.company_name} -> ${wave1Result.url}`);

                    // 🧠 AI EMPLOYEE RECOVERY
                    // If we found the site, but Identity (FatturatoItalia) didn't give us employees, ask AI.
                    if (identity && !identity.financials?.employees) {
                        const aiEmployees = await this.identityResolver.estimateEmployeesFromWebsite(company, wave1Result.url);
                        if (aiEmployees) {
                            if (!identity.financials) identity.financials = {};
                            identity.financials.employees = `${aiEmployees} (AI Est.)`;
                            // Update identity attached to result
                            wave1Result = this.attachIdentity(wave1Result, identity);
                        }
                    }

                    const finalRes = this.attachIdentity(wave1Result, identity);
                    this.notifySuccess(company, finalRes);
                    return finalRes;
                }
                bestInvalid = this.pickBestInvalid(bestInvalid, wave1Result);
            }

            if (profile.runWave2) {
                // =====================================================================
                // 🌊 WAVE 2: THE NET (Bing + DuckDuckGo)
                // =====================================================================
                Logger.info(`[Discovery] 🕸️ WAVE 2: THE NET`);
                const wave2Threshold = this.applyThresholdDelta(THRESHOLDS.WAVE2_NET, profile.wave2ThresholdDelta);
                const wave2Result = await this.executeWave2Net(company, wave2Threshold, profile.wave2MaxCandidates);
                if (wave2Result) {
                    if (wave2Result.status === 'FOUND_VALID') {
                        const finalRes = this.attachIdentity(wave2Result, identity);
                        this.notifySuccess(company, finalRes);
                        return finalRes;
                    }
                    bestInvalid = this.pickBestInvalid(bestInvalid, wave2Result);
                }
            }

            if (profile.runWave3) {
                // =====================================================================
                // 🌊 WAVE 3: THE JUDGE (AI Validation)
                // =====================================================================
                Logger.info(`[Discovery] ⚖️ WAVE 3: THE JUDGE`);
                const wave3Result = await this.executeWave3Judge(
                    company,
                    this.applyThresholdDelta(THRESHOLDS.WAVE3_JUDGE, profile.wave2ThresholdDelta),
                    profile.wave3GuessStart,
                    profile.wave3GuessEnd
                );
                if (wave3Result) {
                    if (wave3Result.status === 'FOUND_VALID') {
                        const finalRes = this.attachIdentity(wave3Result, identity);
                        this.notifySuccess(company, finalRes);
                        return finalRes;
                    }
                    bestInvalid = this.pickBestInvalid(bestInvalid, wave3Result);
                }
            }

            if (profile.runNuclear) {
                Logger.info(`[Discovery] ☢️ WAVE 4: NUCLEAR`);
                const wave4Result = await this.executeWave4Nuclear(company, this.applyThresholdDelta(THRESHOLDS.WAVE3_JUDGE, -0.05));
                if (wave4Result) {
                    if (wave4Result.status === 'FOUND_VALID') {
                        const finalRes = this.attachIdentity(wave4Result, identity);
                        this.notifySuccess(company, finalRes);
                        return finalRes;
                    }
                    bestInvalid = this.pickBestInvalid(bestInvalid, wave4Result);
                }
            }

            if (bestInvalid) {
                Logger.warn(
                    `[Discovery] ⚠️ Best candidate invalid for ${company.company_name}: ${bestInvalid.url} (${bestInvalid.confidence.toFixed(2)})`
                );
                AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', {
                    reason: 'Best candidate below threshold',
                    candidate_url: bestInvalid.url,
                    confidence: bestInvalid.confidence,
                });
                return this.attachIdentity(bestInvalid, identity);
            }

            // All waves exhausted
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'All waves exhausted' });
            return this.attachIdentity({
                url: null,
                status: 'NOT_FOUND',
                method: 'waves_exhausted',
                confidence: 0,
                wave: 'ALL',
                details: {}
            }, identity);

        } catch (error) {
            Logger.error(`[Discovery] Error for ${company.company_name}:`, { error: error as Error });
            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { error: (error as Error).message });
            return this.attachIdentity({
                url: null,
                status: 'ERROR',
                method: 'exception',
                confidence: 0,
                wave: 'ERROR',
                details: { error: (error as Error).message }
            }, null); // Fix: Pass null instead of identity (which might be null/undefined)
        }
    }

    private attachIdentity(result: DiscoveryResult, identity: IdentityResult | null): DiscoveryResult {
        if (!identity) return result;
        return {
            ...result,
            details: {
                ...result.details,
                identity
            }
        };
    }

    // =========================================================================
    // 🐝 WAVE 1: THE SWARM
    // Parallel: HyperGuesser + Google Name + Google Address + Google Phone
    // (Adaptive: Switch to Bing/DDG if Proxy is Disabled)
    // =========================================================================
    private async executeWave1Swarm(company: CompanyInput, threshold: number, maxCandidates: number): Promise<DiscoveryResult | null> {
        const proxyDisabled = process.env.DISABLE_PROXY === 'true';
        const scrapeDoEnabled = ScraperClient.isScrapeDoEnabled();
        const canUseGoogle = !proxyDisabled || scrapeDoEnabled;
        const promises: Array<Promise<Candidate[] | null>> = [
            this.hyperGuesserAttack(company),
            this.pagineGiallePhoneAttack(company),
        ];

        if (canUseGoogle) {
            if (proxyDisabled && scrapeDoEnabled) {
                Logger.info('[Wave1] 🛡️ Proxy disabled, Scrape.do enabled: using Google via gateway + Bing');
            }
            // Standard Google Swarm (Puppeteer) or Scrape.do fallback (HTTP) when proxy is disabled.
            // 🧩 VAT MATCH: If we have a resolved VAT (from IdentityResolver), use it for a surgical strike
            if (company.vat_code || company.vat || company.piva) { // Use any available VAT field
                promises.push(this.googleSearchByVat(company));
            }
            promises.push(this.googleSearchByName(company));
            promises.push(this.googleSearchByAddress(company));
            promises.push(this.googleSearchByPhone(company));
            promises.push(this.searchBing(company)); // fallback candidates always useful
            // DDG is useful regardless; it might be blocked direct, but Scrape.do can often pass.
            promises.push(this.searchDDG(company));
        } else {
            Logger.info('[Wave1] 🛡️ Proxy disabled and Scrape.do missing: skipping Google, using Bing + DuckDuckGo');
            // Add Bing & DDG to Wave 1
            promises.push(this.searchBing(company));
            promises.push(this.searchDDG(company));

            // OPTIMIZATION: If Proxy is disabled, use Serper (Google API) as high-quality fallback
            if (process.env.SERPER_API_KEY) {
                Logger.info('[Wave1] 🚀 Proxy disabled & Serper Key found: Engaging Serper (Google API)');
                promises.push(this.serperAttack(company));
            }
        }

        // 🧠 JINA SEARCH: If enabled, add as high-priority search provider (no browser needed)

        // 🛠️ LLM GUARD FIX: Check multiple keys, not just OPENAI
        const hasLLMKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY || process.env.Z_AI_API_KEY;
        if (ScraperClient.isJinaEnabled() && hasLLMKey) {
            promises.push(this.searchJina(company));
        }

        // Launch all methods in parallel
        const results = await Promise.all(promises);

        // Collect all candidates
        const allCandidates: Candidate[] = [];

        results.forEach(res => {
            if (res) allCandidates.push(...res);
        });

        Logger.info(`[Wave1] 🐝 Collected ${allCandidates.length} candidates from Swarm`);

        // Validate candidates in parallel
        return await this.validateAndSelectBest(allCandidates, company, 'WAVE1_SWARM', threshold, maxCandidates);
    }

    private async serperAttack(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('google');
            const query = `${company.company_name} ${company.city || ''} sito ufficiale`;
            const provider = new SerperSearchProvider();
            const results = await provider.search(query);
            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 8).map(r => ({
                url: r.url,
                source: 'serper_google',
                confidence: 0.80
            }));
        } catch (e) {
            Logger.warn('[Wave1] Serper search failed', { error: e as Error });
            return null;
        }
    }

    // Wrappers for Bing/DDG to match signature
    private async searchBing(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('bing');
            const query = `${company.company_name} ${company.city || ''} sito ufficiale contatti`;
            const results = await this.scrapeBingDIY(query);
            this.rateLimiter.reportSuccess('bing');
            return results.slice(0, 8).map(r => ({ url: r.link, source: 'bing', confidence: 0.7 }));
        } catch (e) {
            this.rateLimiter.reportFailure('bing');
            Logger.warn('[Wave] Bing search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async searchDDG(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('duckduckgo');
            const query = `${company.company_name} ${company.city || ''} sito ufficiale contatti`;
            const results = await this.scrapeDDGDIY(query);
            this.rateLimiter.reportSuccess('duckduckgo');
            return results.slice(0, 8).map(r => ({ url: r.link, source: 'duckduckgo', confidence: 0.7 }));
        } catch (e) {
            this.rateLimiter.reportFailure('duckduckgo');
            Logger.warn('[Wave] DuckDuckGo search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async pagineGiallePhoneAttack(company: CompanyInput): Promise<Candidate[] | null> {
        if (!company.phone || company.phone.length < 6) return null;

        try {
            await this.rateLimiter.waitForSlot('paginegialle');
            const harvest = await PagineGialleHarvester.harvestByPhone(company);
            this.rateLimiter.reportSuccess('paginegialle');
            if (!harvest?.officialWebsite) return null;

            return [
                {
                    url: harvest.officialWebsite,
                    source: 'paginegialle_phone',
                    confidence: 0.9,
                },
            ];
        } catch (e) {
            this.rateLimiter.reportFailure('paginegialle');
            Logger.warn('[Wave] PagineGialle phone harvest failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    // =========================================================================
    // 🧠 JINA SEARCH PROVIDER (No browser, no proxy)
    // =========================================================================
    private async searchJina(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            const query = `${company.company_name} ${company.city || ''} sito ufficiale contatti`;
            const response = await ScraperClient.fetchJinaSearch(query);

            if (response.status !== 200) {
                const body = typeof response.data === 'string' ? response.data.slice(0, 500) : JSON.stringify(response.data).slice(0, 500);
                Logger.warn('[JinaSearch] Non-200 response', { status: response.status, body });
                return null;
            }

            const results = ScraperClient.parseJinaSearchResults(response.data);
            Logger.info(`[JinaSearch] Found ${results.length} results for "${company.company_name}"`);

            return results.slice(0, 10).map(r => ({
                url: r.url,
                source: 'jina_search',
                confidence: 0.78, // High confidence — Jina returns clean, relevant results
            }));
        } catch (e) {
            Logger.warn('[JinaSearch] Search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async hyperGuesserAttack(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            const guesses = HyperGuesser.generate(
                company.company_name,
                company.city || '',
                company.province || '',
                company.category || ''
            );

            // Take top guesses and keep only domains with valid DNS
            const topGuesses = guesses.slice(0, 30);
            Logger.info(`[HyperGuesser] Generated ${topGuesses.length} domain candidates`);

            const checks = await Promise.all(
                topGuesses.map(async (url) => {
                    const dnsOk = await DomainValidator.checkDNS(url);
                    return dnsOk ? url : null;
                })
            );

            const live = checks.filter((url): url is string => !!url);
            Logger.info(`[HyperGuesser] DNS-valid candidates: ${live.length}/${topGuesses.length}`);

            return live.map((url) => ({
                url,
                source: 'hyper_guesser',
                confidence: 0.74,
            }));
        } catch (e) {
            Logger.warn(`[HyperGuesser] Failed:`, { error: e as Error });
            return null;
        }
    }

    private async googleSearchByName(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('google');
            const query = `"${company.company_name}" ${company.city || ''} sito ufficiale -site:facebook.com -site:paginegialle.it`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 8).map(r => ({
                url: r.link,
                source: 'google_name',
                confidence: 0.76
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google name search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    private async googleSearchByAddress(company: CompanyInput): Promise<Candidate[] | null> {
        if (!company.address) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            // Task 04: Reverse Address Search with exact match
            const query = `"${company.address}" ${company.city || ''} "${company.company_name}"`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 5).map(r => ({
                url: r.link,
                source: 'google_address',
                confidence: 0.82 // Higher confidence for address match
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google address search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    /**
     * @deprecated Use PagineGialleHarvester for reverse phone lookup (more reliable).
     * Keeping this as a low-priority fallback.
     */
    private async googleSearchByPhone(company: CompanyInput): Promise<Candidate[] | null> {
        if (!company.phone || company.phone.length < 6) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            const queries = this.buildPhoneQueries(company);
            const resultBuckets = await Promise.all(queries.map((q) => this.scrapeGoogleDIY(q)));
            const results = resultBuckets.flat();

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 8).map(r => ({
                url: r.link,
                source: 'google_phone',
                confidence: 0.86 // High confidence for phone match
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google phone search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    /**
     * 🧩 VAT/P.IVA SEARCH
     * Searches specifically for the VAT number. Highly accurate if found.
     */
    private async googleSearchByVat(company: CompanyInput): Promise<Candidate[] | null> {
        const vat = company.vat_code || company.vat || company.piva;
        if (!vat || vat.length < 5) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            // Query: "01234567890" OR "P.IVA 01234567890"
            const query = `"${vat}" sito ufficiale`;
            const results = await this.scrapeGoogleDIY(query);

            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 5).map(r => ({
                url: r.link,
                source: 'google_vat',
                confidence: 0.92 // Very High confidence for VAT match
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[Wave1] Google VAT search failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    // =========================================================================
    // 🕸️ WAVE 2: THE NET (Bing + DuckDuckGo)
    // =========================================================================
    private async executeWave2Net(company: CompanyInput, threshold: number, maxCandidates: number): Promise<DiscoveryResult | null> {
        const allCandidates: Candidate[] = [];

        // Bing search
        try {
            await this.rateLimiter.waitForSlot('bing');
            const query = `${company.company_name} ${company.city || ''} sito ufficiale contatti`;
            const bingResults = await this.scrapeBingDIY(query);
            bingResults.slice(0, 8).forEach(r => {
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
            const query = `${company.company_name} ${company.city || ''} sito ufficiale contatti`;
            const ddgResults = await this.scrapeDDGDIY(query);
            ddgResults.slice(0, 8).forEach(r => {
                allCandidates.push({ url: r.link, source: 'duckduckgo', confidence: 0.65 });
            });
            this.rateLimiter.reportSuccess('duckduckgo');
        } catch (e) {
            this.rateLimiter.reportFailure('duckduckgo');
            Logger.warn('[Wave2] DuckDuckGo search failed', { error: e as Error, company_name: company.company_name });
        }

        // Additional targeted query for ambiguous brands
        try {
            await this.rateLimiter.waitForSlot('bing');
            const contactQuery = `"${company.company_name}" ${company.city || ''} "chi siamo" "contatti"`;
            const targeted = await this.scrapeBingDIY(contactQuery);
            targeted.slice(0, 6).forEach((r) => {
                allCandidates.push({ url: r.link, source: 'bing_targeted', confidence: 0.68 });
            });
            this.rateLimiter.reportSuccess('bing');
        } catch (e) {
            this.rateLimiter.reportFailure('bing');
            Logger.warn('[Wave2] Bing targeted search failed', { error: e as Error, company_name: company.company_name });
        }

        Logger.info(`[Wave2] 🕸️ Collected ${allCandidates.length} candidates from Net`);

        // DEDUPLICATION: Filter out candidates already found in Wave 1
        // (This is handled naturally by validateAndSelectBest -> seen set, but we can optimize network calls here if needed)
        // For now, we just proceed as existing logic is robust enough.

        Logger.info(`[Wave2] 🕸️ Collected ${allCandidates.length} candidates from Net`);

        return await this.validateAndSelectBest(allCandidates, company, 'WAVE2_NET', threshold, maxCandidates);
    }

    // =========================================================================
    // ⚖️ WAVE 3: THE JUDGE (AI-powered final validation)
    // =========================================================================
    private async executeWave3Judge(
        company: CompanyInput,
        threshold: number,
        guessStart: number,
        guessEnd: number
    ): Promise<DiscoveryResult | null> {
        // Collect any remaining unverified candidates and use AI for final validation
        Logger.info(`[Wave3] ⚖️ AI Judge - attempting low-confidence redemption`);

        // Try DNS-based domain guessing with AI validation
        const guesses = HyperGuesser.generate(
            company.company_name,
            company.city || '',
            company.province || '',
            company.category || ''
        );

        // Try remaining guesses (after candidates already evaluated in previous waves)
        const sliceStart = Math.max(0, guessStart);
        const sliceEnd = Math.min(guessEnd, guesses.length);

        for (const url of guesses.slice(sliceStart, sliceEnd)) {
            try {
                const dnsOk = await DomainValidator.checkDNS(url);
                if (!dnsOk) continue;

                const verification = await this.deepVerifyWithAI(url, company);
                if (verification && verification.confidence >= threshold) {
                    return {
                        url,
                        status: 'FOUND_VALID',
                        method: 'ai_judge',
                        confidence: verification.confidence,
                        wave: 'WAVE3_JUDGE',
                        details: verification
                    };
                }
                if (verification && verification.confidence >= MIN_INVALID_CONFIDENCE) {
                    return {
                        url,
                        status: 'FOUND_INVALID',
                        method: 'ai_judge',
                        confidence: verification.confidence,
                        wave: 'WAVE3_JUDGE',
                        details: verification,
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

    private async executeWave4Nuclear(company: CompanyInput, threshold: number): Promise<DiscoveryResult | null> {
        try {
            const nuclear = await this.nuclearStrategy.execute(company);
            if (!nuclear.url) return null;

            const verification = await this.deepVerify(nuclear.url, company);
            if (!verification) return null;

            if (verification.confidence >= threshold) {
                return {
                    url: verification.final_url || nuclear.url,
                    status: 'FOUND_VALID',
                    method: `nuclear:${nuclear.method}`,
                    confidence: verification.confidence,
                    wave: 'WAVE4_NUCLEAR',
                    details: verification,
                };
            }

            if (verification.confidence >= MIN_INVALID_CONFIDENCE) {
                return {
                    url: verification.final_url || nuclear.url,
                    status: 'FOUND_INVALID',
                    method: `nuclear:${nuclear.method}`,
                    confidence: verification.confidence,
                    wave: 'WAVE4_NUCLEAR',
                    details: verification,
                };
            }

            return null;
        } catch (e) {
            Logger.warn('[Wave4] Nuclear strategy failed', { error: e as Error, company_name: company.company_name });
            return null;
        }
    }

    // =========================================================================
    // VALIDATION HELPERS
    // =========================================================================

    private async validateAndSelectBest(
        candidates: Candidate[],
        company: CompanyInput,
        wave: string,
        threshold: number,
        maxCandidates: number
    ): Promise<DiscoveryResult | null> {
        if (candidates.length === 0) return null;

        // Normalize and deduplicate by canonical URL
        const seen = new Set<string>();
        const unique = candidates
            .map((candidate) => this.normalizeCandidate(candidate))
            .filter((candidate): candidate is Candidate => !!candidate)
            .filter((candidate) => {
                if (seen.has(candidate.url)) return false;
                seen.add(candidate.url);
                return true;
            });

        if (unique.length === 0) return null;

        unique.sort((a, b) => this.computeCandidatePriority(b, company) - this.computeCandidatePriority(a, company));
        const shortlist = unique.slice(0, Math.max(1, maxCandidates));

        Logger.info(`[${wave}] Validating ${shortlist.length}/${unique.length} candidates...`);

        // Parallel verification with concurrency limit
        const verifications = await Promise.all(
            shortlist.map(candidate =>
                this.validatorLimit(async () => {
                    const result = await this.deepVerify(candidate.url, company);
                    if (!result) return null;
                    const finalUrl = (result.final_url || candidate.url) as string;
                    return {
                        url: finalUrl,
                        source: candidate.source,
                        confidence: result.confidence,
                        details: result
                    };
                })
            )
        );

        const checked = verifications.filter((v): v is {
            url: string;
            source: string;
            confidence: number;
            details: any;
        } => !!v);
        if (checked.length === 0) return null;

        // Select best by confidence
        checked.sort((a, b) => b.confidence - a.confidence);
        const best = checked[0];

        if (best.confidence >= threshold) {
            return {
                url: best.details?.final_url || best.url,
                status: 'FOUND_VALID',
                method: best.source,
                confidence: best.confidence,
                wave,
                details: best.details
            };
        }

        if (best.confidence >= MIN_INVALID_CONFIDENCE) {
            return {
                url: best.details?.final_url || best.url,
                status: 'FOUND_INVALID',
                method: best.source,
                confidence: best.confidence,
                wave,
                details: best.details
            };
        }

        return null;
    }

    private normalizeCandidate(candidate: Candidate): Candidate | null {
        const normalizedUrl = this.normalizeUrl(candidate.url);
        if (!normalizedUrl || ContentFilter.isDirectoryOrSocial(normalizedUrl)) return null;
        return {
            ...candidate,
            url: normalizedUrl,
        };
    }

    private normalizeUrl(rawUrl: string): string | null {
        try {
            const hasProtocol = rawUrl.startsWith('http://') || rawUrl.startsWith('https://');
            const withProtocol = hasProtocol ? rawUrl : `https://${rawUrl}`;
            const parsed = new URL(withProtocol);
            const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
            if (!hostname) return null;
            if (hostname.includes('google.') || hostname.includes('bing.com') || hostname.includes('duckduckgo.com')) {
                return null;
            }
            if (parsed.pathname.toLowerCase().endsWith('.pdf')) return null;
            const protocol = parsed.protocol === 'http:' ? 'http' : 'https';
            return `${protocol}://${hostname}`;
        } catch {
            return null;
        }
    }

    private buildNavigationTargets(normalizedRootUrl: string): string[] {
        try {
            const parsed = new URL(normalizedRootUrl);
            const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
            const preferHttp = parsed.protocol === 'http:';

            const protocols = preferHttp ? ['http', 'https'] : ['https', 'http'];
            const hosts = [host, `www.${host}`];
            const targets: string[] = [];

            for (const protocol of protocols) {
                for (const h of hosts) {
                    targets.push(`${protocol}://${h}`);
                }
            }

            // De-dupe while preserving order.
            return [...new Set(targets)];
        } catch {
            return [normalizedRootUrl];
        }
    }

    private computeCandidatePriority(candidate: Candidate, company: CompanyInput): number {
        const domainCoverage = CompanyMatcher.evaluate(company, candidate.url, '', '').signals.domainCoverage;
        return candidate.confidence + domainCoverage * 0.25;
    }

    // =========================================================================
    // DEEP VERIFICATION
    // =========================================================================

    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url || ContentFilter.isDirectoryOrSocial(url)) return null;

        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl) return null;

        const cacheKey = this.buildVerificationCacheKey(normalizedUrl, company);
        const cached = this.getCachedVerification(cacheKey);
        if (cached) return cached;

        // const dnsProbe = await HoneyPotDetector.getInstance().checkDNS(normalizedUrl);
        // if (!dnsProbe.safe) {
        //     const result = { confidence: 0, reason: dnsProbe.reason || 'DNS check failed' };
        //     this.setCachedVerification(cacheKey, result);
        //     return result;
        // }

        let page;
        try {
            // 🧠 JINA-FIRST: If Jina is enabled, try browser-free verification first
            if (ScraperClient.isJinaEnabled()) {
                const jinaResult = await this.jinaVerify(normalizedUrl, company);
                if (jinaResult) {
                    this.setCachedVerification(cacheKey, jinaResult);
                    return jinaResult;
                }
                // Jina failed — fall through to browser if available
            }

            page = await this.browserFactory.newPage();

            // Block unnecessary resources
            await this.setupFastInterception(page);
            const navTargets = this.buildNavigationTargets(normalizedUrl);
            let navigated = false;
            let lastNavError: unknown = null;

            for (const target of navTargets) {
                try {
                    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
                    navigated = true;
                    break;
                } catch (e) {
                    lastNavError = e;
                }
            }

            if (!navigated) {
                // Browser navigation can fail on some sites due to chromium quirks; fallback to HTTP-only verification.
                const httpFallback = await this.httpVerify(normalizedUrl, company);
                if (httpFallback) {
                    this.setCachedVerification(cacheKey, httpFallback);
                    return httpFallback;
                }

                Logger.warn('[DeepVerify] Navigation failed', {
                    error: lastNavError as Error,
                    url: normalizedUrl,
                    company_name: company.company_name,
                });
                return null;
            }

            const currentUrl = this.normalizeUrl(page.url()) || normalizedUrl;
            if (ContentFilter.isDirectoryOrSocial(currentUrl)) {
                const result = { confidence: 0, reason: 'Redirected to directory/social' };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            const extraction = await this.extractPageEvidence(page);
            if (ContentFilter.isDirectoryLikeTitle(extraction.title)) {
                const result = { confidence: 0, reason: 'Directory-like title' };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // 🛡️ HONEYPOT CHECK - Deprecated for performance
            // const honeyPot = HoneyPotDetector.getInstance();
            // const safety = honeyPot.analyzeContent(extraction.html);
            // if (!safety.safe) {
            //     Logger.warn(`[DeepVerify] 🍯 Trap: ${normalizedUrl} -> ${safety.reason}`);
            //     const result = { confidence: 0, reason: safety.reason };
            //     this.setCachedVerification(cacheKey, result);
            //     return result;
            // }

            // Content validation
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) {
                // Report failure to genetic algorithm if blocked
                if (extraction.text.includes('Captcha') || extraction.text.includes('Access Denied')) {
                    const geneId = (page as any).__geneId;
                    // if (geneId) this.fingerprinter.reportFailure(geneId);
                }
                const result = { confidence: 0, reason: filter.reason };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // Report success to genetic algorithm
            const geneId = (page as any).__geneId;
            // if (geneId) this.fingerprinter.reportSuccess(geneId);

            let combinedText = extraction.text;
            let evaluation = CompanyMatcher.evaluate(company, currentUrl, combinedText, extraction.title);

            const candidateLinks = this.collectEvidenceLinks(extraction.links, currentUrl);
            if (evaluation.confidence < THRESHOLDS.WAVE2_NET && candidateLinks.length > 0) {
                for (const link of candidateLinks.slice(0, 4)) {
                    const extraText = await this.fetchSupplementalPageText(page, link);
                    if (extraText) {
                        combinedText += `\n${extraText}`;
                    }
                }
                evaluation = CompanyMatcher.evaluate(company, currentUrl, combinedText, extraction.title);
            }

            const appearsItalian = ContentFilter.isItalianLanguage(combinedText);
            if (!appearsItalian && evaluation.confidence < 0.9) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.max(0, evaluation.confidence - 0.03),
                    reason: `${evaluation.reason}, foreign language`,
                };
            }

            // TITLE BOOST: If the page <title> contains the company name, boost confidence
            const titleNameCoverage = CompanyMatcher.nameCoverage(company.company_name, extraction.title.toLowerCase());
            if (titleNameCoverage >= 0.6 && evaluation.confidence < 0.85) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.min(0.99, evaluation.confidence + 0.10),
                    reason: `${evaluation.reason}, title match boost`,
                };
            }

            if (evaluation.confidence < THRESHOLDS.WAVE3_JUDGE && (process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY || process.env.Z_AI_API_KEY)) {
                try {
                    const llm = await LLMValidator.validateCompany(company, combinedText);
                    if (llm.isValid && llm.confidence > evaluation.confidence) {
                        evaluation = {
                            confidence: llm.confidence,
                            reason: `${evaluation.reason}; ${llm.reason}`,
                            signals: evaluation.signals,
                            scrapedVat: evaluation.scrapedVat,
                            matchedPhone: evaluation.matchedPhone,
                        };
                    }
                } catch (llmError) {
                    Logger.warn('[DeepVerify] LLM fallback failed', { error: llmError as Error, company_name: company.company_name });
                }
            }

            // 🤖 AGENTIC FALLBACK (Phase 3)
            // If confidence is LOW (< 0.4) and no VAT/Phone matched, the site might be correct but complex or obfuscated.
            // Unleash the Agent to find the P.IVA.
            if (evaluation.confidence < 0.4 && evaluation.confidence > 0 && !evaluation.scrapedVat && !evaluation.matchedPhone) {
                Logger.info(`[DeepVerify] Low confidence (${evaluation.confidence.toFixed(2)}) for ${currentUrl}. Unleashing Agent...`);
                try {
                    const goal = `Find the VAT number (P.IVA) for "${company.company_name}" in "${company.city || 'Italy'}". Return ONLY the VAT code.`;
                    const agentResult = await AgentRunner.run(page, goal);

                    // Basic validation of agent result (it should look like a VAT number)
                    if (agentResult && (agentResult.includes('IT') || agentResult.match(/\d{11}/))) {
                        Logger.info(`[DeepVerify] 🤖 Agent salvaged session! Found: ${agentResult}`);
                        evaluation.scrapedVat = agentResult;
                        evaluation.confidence = 0.95; // Boost to high confidence if agent finds VAT
                        evaluation.reason += "; Agent verified P.IVA";
                    }
                } catch (agentError) {
                    Logger.warn('[DeepVerify] Agent fallback failed', { error: agentError as Error });
                }
            }

            const result = {
                confidence: evaluation.confidence,
                reason: evaluation.reason,
                level: evaluation.confidence >= 0.85 ? 'RULE_STRONG' : 'RULE_HEURISTIC',
                scraped_piva: evaluation.scrapedVat,
                matched_phone: evaluation.matchedPhone,
                signals: evaluation.signals,
                final_url: currentUrl,
            };
            this.setCachedVerification(cacheKey, result);
            return result;

        } catch (e) {
            // Last-resort: HTTP fallback (no browser). Helps with flaky chromium sessions.
            try {
                const httpFallback = await this.httpVerify(normalizedUrl, company);
                if (httpFallback) {
                    this.setCachedVerification(cacheKey, httpFallback);
                    return httpFallback;
                }
            } catch {
                // ignore
            }

            Logger.warn('[DeepVerify] Verification failed', { error: e as Error, url: normalizedUrl, company_name: company.company_name });
            return null;
        } finally {
            if (page) {
                page.removeAllListeners('request');
                await this.browserFactory.closePage(page);
            }
        }
    }

    // =========================================================================
    // 🧠 JINA READER VERIFICATION (No browser needed)
    // =========================================================================
    private async jinaVerify(normalizedUrl: string, company: CompanyInput): Promise<any | null> {
        try {
            const response = await ScraperClient.fetchJinaReader(normalizedUrl, { timeoutMs: 15000, maxRetries: 1 });

            if (response.status !== 200 || !response.data || response.data.length < 100) {
                Logger.warn('[JinaVerify] Insufficient content', { url: normalizedUrl, status: response.status, length: response.data?.length || 0 });
                return null;
            }

            const text = response.data;

            // Check for directory/social redirects in the markdown content
            if (ContentFilter.isDirectoryOrSocial(normalizedUrl)) {
                return { confidence: 0, reason: 'Directory/social URL', final_url: normalizedUrl };
            }

            const filter = ContentFilter.isValidContent(text);
            if (!filter.valid) {
                return { confidence: 0, reason: filter.reason, final_url: normalizedUrl };
            }

            // Extract a pseudo-title from the first line of markdown
            const firstLine = text.split('\n').find(l => l.trim().length > 0) || '';
            const title = firstLine.replace(/^#+\s*/, '').trim();

            if (ContentFilter.isDirectoryLikeTitle(title)) {
                return { confidence: 0, reason: 'Directory-like title', final_url: normalizedUrl };
            }

            let evaluation = CompanyMatcher.evaluate(company, normalizedUrl, text, title);

            const appearsItalian = ContentFilter.isItalianLanguage(text);
            if (!appearsItalian && evaluation.confidence < 0.9) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.max(0, evaluation.confidence - 0.03),
                    reason: `${evaluation.reason}, foreign language`,
                };
            }

            // LLM boost if confidence is borderline
            if (evaluation.confidence < THRESHOLDS.WAVE3_JUDGE && process.env.OPENAI_API_KEY) {
                try {
                    const llm = await LLMValidator.validateCompany(company, text);
                    if (llm.isValid && llm.confidence > evaluation.confidence) {
                        evaluation = {
                            confidence: llm.confidence,
                            reason: `${evaluation.reason}; ${llm.reason}`,
                            signals: evaluation.signals,
                            scrapedVat: evaluation.scrapedVat,
                            matchedPhone: evaluation.matchedPhone,
                        };
                    }
                } catch (llmError) {
                    Logger.warn('[JinaVerify] LLM fallback failed', { error: llmError as Error });
                }
            }

            Logger.info(`[JinaVerify] ✅ Verified ${normalizedUrl} -> confidence: ${evaluation.confidence.toFixed(2)}`);

            return {
                confidence: evaluation.confidence,
                reason: evaluation.reason,
                level: evaluation.confidence >= 0.85 ? 'RULE_STRONG' : 'RULE_HEURISTIC',
                scraped_piva: evaluation.scrapedVat,
                matched_phone: evaluation.matchedPhone,
                signals: evaluation.signals,
                final_url: normalizedUrl,
            };
        } catch (e) {
            Logger.warn('[JinaVerify] Failed, falling back to browser', { error: e as Error, url: normalizedUrl });
            return null;
        }
    }

    private async httpVerify(normalizedUrl: string, company: CompanyInput): Promise<any | null> {
        if (!normalizedUrl) return null;

        const navTargets = this.buildNavigationTargets(normalizedUrl);
        for (const target of navTargets) {
            try {
                const resp = await ScraperClient.fetchHtml(target, { mode: 'auto', timeoutMs: 12000, maxRetries: 1, render: false });
                if (resp.via === 'direct' && (resp.status < 200 || resp.status >= 400)) {
                    continue;
                }

                const html = typeof resp.data === 'string' ? resp.data : '';
                if (html.length < 200) {
                    continue;
                }

                const responseUrl = resp.finalUrl || target;
                const currentUrl = this.normalizeUrl(responseUrl) || this.normalizeUrl(target) || normalizedUrl;
                if (ContentFilter.isDirectoryOrSocial(currentUrl)) {
                    continue;
                }

                const $ = cheerio.load(html);
                const title = ($('title').first().text() || '').trim();
                if (ContentFilter.isDirectoryLikeTitle(title)) {
                    return { confidence: 0, reason: 'Directory-like title', final_url: currentUrl };
                }

                // const safety = HoneyPotDetector.getInstance().analyzeContent(html);
                // if (!safety.safe) {
                //     return { confidence: 0, reason: safety.reason, final_url: currentUrl };
                // }

                const text = ($('body').text() || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
                const filter = ContentFilter.isValidContent(text);
                if (!filter.valid) {
                    return { confidence: 0, reason: filter.reason, final_url: currentUrl };
                }

                let evaluation = CompanyMatcher.evaluate(company, currentUrl, text, title);
                const appearsItalian = ContentFilter.isItalianLanguage(text);
                if (!appearsItalian && evaluation.confidence < 0.9) {
                    evaluation = {
                        ...evaluation,
                        confidence: Math.max(0, evaluation.confidence - 0.03),
                        reason: `${evaluation.reason}, foreign language`,
                    };
                }

                return {
                    confidence: evaluation.confidence,
                    reason: evaluation.reason,
                    level: evaluation.confidence >= 0.85 ? 'RULE_STRONG' : 'RULE_HEURISTIC',
                    scraped_piva: evaluation.scrapedVat,
                    matched_phone: evaluation.matchedPhone,
                    signals: evaluation.signals,
                    final_url: currentUrl,
                };
            } catch {
                continue;
            }
        }

        return null;
    }

    private async deepVerifyWithAI(url: string, company: CompanyInput): Promise<any | null> {
        if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY && !process.env.KIMI_API_KEY && !process.env.Z_AI_API_KEY) return null;
        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl || ContentFilter.isDirectoryOrSocial(normalizedUrl)) return null;

        let page;
        try {
            page = await this.browserFactory.newPage();
            await this.setupFastInterception(page);

            const navTargets = this.buildNavigationTargets(normalizedUrl);
            for (const target of navTargets) {
                try {
                    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    break;
                } catch {
                    // try next
                }
            }

            const extraction = await this.extractPageEvidence(page);
            if (!extraction.text || extraction.text.length < 80) {
                return null;
            }

            // Use LLM for final validation
            const llmResult = await LLMValidator.validateCompany(company, extraction.text);
            if (llmResult.isValid) {
                return {
                    confidence: llmResult.confidence,
                    reason: llmResult.reason,
                    level: 'AI_Verified'
                };
            }

            return null;
        } catch (e) {
            Logger.warn('[DeepVerifyWithAI] Verification failed', { error: e as Error, url: normalizedUrl, company_name: company.company_name });
            return null;
        } finally {
            if (page) {
                page.removeAllListeners('request');
                await this.browserFactory.closePage(page);
            }
        }
    }

    private async setupFastInterception(page: Page): Promise<void> {
        await page.setRequestInterception(true);
        const requestHandler = (req: any) => {
            if (['image', 'media', 'font', 'stylesheet', 'other'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        };
        page.on('request', requestHandler);
    }

    private async extractPageEvidence(page: Page): Promise<{
        text: string;
        html: string;
        title: string;
        links: Array<{ href: string; text: string }>;
    }> {
        return page.evaluate(() => {
            const text = document.body?.innerText || '';
            const html = document.body?.innerHTML || '';
            const title = document.title || '';
            const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
                .slice(0, 220)
                .map((anchor) => ({
                    href: anchor.href || '',
                    text: anchor.textContent?.trim().toLowerCase() || '',
                }))
                .filter((link) => !!link.href);
            return { text, html, title, links };
        });
    }

    private collectEvidenceLinks(
        links: Array<{ href: string; text: string }>,
        baseUrl: string
    ): string[] {
        try {
            const stripWww = (host: string) => host.replace(/^www\./, '').toLowerCase();
            const baseHost = stripWww(new URL(baseUrl).hostname);

            const textKeywords = ['contatt', 'chi siamo', 'about', 'dove siamo', 'impressum', 'privacy', 'cookie'];
            const hrefKeywords = [
                'contatt',
                'contact',
                'chi-siamo',
                'chisiamo',
                'about',
                'azienda',
                'dove-siamo',
                'dovesiamo',
                'impressum',
                'privacy',
                'cookie',
                'note-legali',
                'legal',
            ];
            const selected = new Set<string>();

            for (const link of links) {
                let urlObj: URL;
                try {
                    urlObj = new URL(link.href);
                } catch {
                    continue;
                }

                const host = stripWww(urlObj.hostname);
                if (host !== baseHost) continue;

                const text = (link.text || '').toLowerCase();
                const hrefPath = `${urlObj.pathname}${urlObj.search}`.toLowerCase();
                if (textKeywords.some((keyword) => text.includes(keyword)) || hrefKeywords.some((keyword) => hrefPath.includes(keyword))) {
                    selected.add(link.href);
                }
            }

            return [...selected];
        } catch {
            return [];
        }
    }

    private async fetchSupplementalPageText(page: Page, url: string): Promise<string | null> {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
            const text = await page.evaluate(() => document.body?.innerText || '');
            return text.length > 0 ? text.slice(0, 12000) : null;
        } catch {
            return null;
        }
    }

    private buildPhoneQueries(company: CompanyInput): string[] {
        const queries: string[] = [];
        const rawPhone = company.phone || '';
        const normalized = CompanyMatcher.normalizePhone(rawPhone);
        if (!normalized || normalized.length < 7) return queries;

        queries.push(`"${rawPhone}" "${company.company_name}"`);
        queries.push(`"${normalized}" ${company.city || ''} sito`);
        if (normalized.startsWith('39') && normalized.length > 10) {
            const noPrefix = normalized.slice(2);
            queries.push(`"${noPrefix}" ${company.city || ''} "${company.company_name}"`);
        }
        return [...new Set(queries)];
    }

    private applyThresholdDelta(base: number, delta: number): number {
        const value = base + delta;
        return Math.max(0.3, Math.min(0.98, value));
    }

    private pickBestInvalid(existing: DiscoveryResult | null, candidate: DiscoveryResult): DiscoveryResult {
        if (!existing) return candidate;
        return candidate.confidence > existing.confidence ? candidate : existing;
    }

    private buildVerificationCacheKey(url: string, company: CompanyInput): string {
        const vat = (company.vat_code || company.piva || company.vat || '').replace(/\D/g, '');
        const phone = CompanyMatcher.normalizePhone(company.phone);
        const city = (company.city || '').toLowerCase().trim();
        const name = (company.company_name || '').toLowerCase().trim();
        return `${url}|${name}|${city}|${vat}|${phone}`;
    }

    private getCachedVerification(key: string): any | null {
        const record = this.verificationCache.get(key);
        if (!record) return null;
        if (Date.now() - record.cachedAt > this.verificationCacheTtlMs) {
            this.verificationCache.delete(key);
            return null;
        }
        return record.result;
    }

    private setCachedVerification(key: string, result: any): void {
        this.verificationCache.set(key, { result, cachedAt: Date.now() });
    }

    private async acceptGoogleConsentIfPresent(page: Page): Promise<void> {
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(
                document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
            ) as Array<HTMLElement | HTMLInputElement>;

            const consentRegex = /(accetta tutto|accetta|accept all|i agree|agree)/i;
            for (const button of buttons) {
                const text = button.textContent?.trim() || (button as HTMLInputElement).value?.trim() || '';
                if (text && consentRegex.test(text)) {
                    button.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) return;
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 1200)),
        ]);
    }

    // =========================================================================
    // SCRAPERS
    // =========================================================================

    private async scrapeGoogleDIY(query: string): Promise<Array<{ link: string }>> {
        const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;
        const proxyDisabled = process.env.DISABLE_PROXY === 'true';
        const scrapeDoEnabled = ScraperClient.isScrapeDoEnabled();

        if (scrapeDoEnabled) {
            try {
                // Use ScraperClient (Scrape.do API) - bypassing browser proxy issues
                const html = await ScraperClient.fetchText(url, { mode: 'scrape_do', render: true, super: true, timeoutMs: 25000, maxRetries: 2 });
                const lower = html.toLowerCase();
                if (lower.includes('unusual traffic') || lower.includes('traffico insolito') || lower.includes('/sorry/')) {
                    Logger.warn('[ScrapeGoogleDIY] Blocked by CAPTCHA/traffic gate', { query });
                    return [];
                }
                const results = await GoogleSerpAnalyzer.parseSerp(html);
                return results.map((r: { url: string }) => ({ link: r.url }));
            } catch (e) {
                Logger.warn('[ScrapeGoogleDIY] Failed (scrape.do/http)', { error: e as Error, query });
                // Fallback to browser if API fails? No, browser is broken. Return empty.
                return [];
            }
        }

        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await this.acceptGoogleConsentIfPresent(page);
            const html = await page.content();
            const lower = html.toLowerCase();
            if (lower.includes('unusual traffic') || lower.includes('traffico insolito') || lower.includes('/sorry/')) {
                Logger.warn('[ScrapeGoogleDIY] Blocked by CAPTCHA/traffic gate', { query });
                return [];
            }
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
        try {
            // Use the Tor-enabled provider
            const provider = new DDGSearchProvider();
            const results = await provider.search(query);
            return results.map(r => ({ link: r.url }));
        } catch (e) {
            Logger.warn('[ScrapeDDGDIY] Failed', { error: e as Error, query });
            return [];
        }
    }

    private async scrapeBingDIY(query: string): Promise<Array<{ link: string }>> {
        try {
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it&cc=it`;
            const resp = await ScraperClient.fetchHtml(url, { mode: 'auto', timeoutMs: 12000, maxRetries: 1 });
            const html = typeof resp.data === 'string' ? resp.data : '';
            if (resp.via === 'direct' && resp.status >= 400) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const $ = cheerio.load(html);
            const links: Array<{ link: string }> = [];
            $('.b_algo h2 a').each((_, el) => {
                const href = ($(el).attr('href') || '').trim();
                if (href.startsWith('http')) {
                    links.push({ link: href });
                }
            });
            return links.slice(0, 10);
        } catch (e) {
            Logger.warn('[ScrapeBingDIY] Failed', { error: e as Error, query });
            return [];
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
