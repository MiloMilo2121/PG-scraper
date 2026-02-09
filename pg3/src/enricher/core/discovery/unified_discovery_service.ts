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
import { HTTPRequest, Page } from 'puppeteer';
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
import { CompanyMatcher } from './company_matcher';
import { DomainValidator } from '../../utils/domain_validator';
import { NuclearStrategy } from './nuclear_strategy';

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
    private fingerprinter: GeneticFingerprinter;
    private nuclearStrategy: NuclearStrategy;
    private verificationCache = new Map<string, any>();
    private readonly verificationCacheTtlMs = 15 * 60 * 1000;

    constructor(
        browserFactory?: BrowserFactory,
        rateLimiter?: RateLimiter
    ) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
        this.rateLimiter = rateLimiter || new MemoryRateLimiter();
        this.fingerprinter = GeneticFingerprinter.getInstance();
        this.nuclearStrategy = new NuclearStrategy();
    }

    // =========================================================================
    // 🌊 MAIN DISCOVERY ENTRY POINT
    // =========================================================================
    public async discover(company: CompanyInput, mode: DiscoveryMode = DiscoveryMode.DEEP_RUN2): Promise<DiscoveryResult> {
        Logger.info(`[Discovery] 🌊 Starting WAVE discovery for "${company.company_name}" (Mode: ${mode})`);
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { mode });
        const profile = MODE_PROFILES[mode] || MODE_PROFILES[DiscoveryMode.DEEP_RUN2];
        let bestInvalid: DiscoveryResult | null = null;

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
                if (preCheck && preCheck.confidence >= MIN_INVALID_CONFIDENCE) {
                    bestInvalid = {
                        url: company.website,
                        status: 'FOUND_INVALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck,
                    };
                }
            }

            // =====================================================================
            // 🌊 WAVE 1: THE SWARM (Parallel Execution)
            // =====================================================================
            Logger.info(`[Discovery] 🐝 WAVE 1: THE SWARM`);
            const wave1Threshold = this.applyThresholdDelta(THRESHOLDS.WAVE1_SWARM, profile.wave1ThresholdDelta);
            const wave1Result = await this.executeWave1Swarm(company, wave1Threshold, profile.wave1MaxCandidates);
            if (wave1Result) {
                if (wave1Result.status === 'FOUND_VALID') {
                    this.notifySuccess(company, wave1Result);
                    return wave1Result;
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
                        this.notifySuccess(company, wave2Result);
                        return wave2Result;
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
                        this.notifySuccess(company, wave3Result);
                        return wave3Result;
                    }
                    bestInvalid = this.pickBestInvalid(bestInvalid, wave3Result);
                }
            }

            if (profile.runNuclear) {
                Logger.info(`[Discovery] ☢️ WAVE 4: NUCLEAR`);
                const wave4Result = await this.executeWave4Nuclear(company, this.applyThresholdDelta(THRESHOLDS.WAVE3_JUDGE, -0.05));
                if (wave4Result) {
                    if (wave4Result.status === 'FOUND_VALID') {
                        this.notifySuccess(company, wave4Result);
                        return wave4Result;
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
                return bestInvalid;
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
    // (Adaptive: Switch to Bing/DDG if Proxy is Disabled)
    // =========================================================================
    private async executeWave1Swarm(company: CompanyInput, threshold: number, maxCandidates: number): Promise<DiscoveryResult | null> {
        const proxyDisabled = process.env.DISABLE_PROXY === 'true';
        const promises: Array<Promise<Candidate[] | null>> = [this.hyperGuesserAttack(company)];

        if (proxyDisabled) {
            Logger.info('[Wave1] 🛡️ Proxy Disabled: Skipping Google, using Bing + DuckDuckGo');
            // Add Bing & DDG to Wave 1
            promises.push(this.searchBing(company));
            promises.push(this.searchDDG(company));
        } else {
            // Standard Google Swarm
            promises.push(this.googleSearchByName(company));
            promises.push(this.googleSearchByAddress(company));
            promises.push(this.googleSearchByPhone(company));
            promises.push(this.searchBing(company)); // fallback candidates always useful
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
                    url: nuclear.url,
                    status: 'FOUND_VALID',
                    method: `nuclear:${nuclear.method}`,
                    confidence: verification.confidence,
                    wave: 'WAVE4_NUCLEAR',
                    details: verification,
                };
            }

            if (verification.confidence >= MIN_INVALID_CONFIDENCE) {
                return {
                    url: nuclear.url,
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
                    return {
                        url: candidate.url,
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
                url: best.url,
                status: 'FOUND_VALID',
                method: best.source,
                confidence: best.confidence,
                wave,
                details: best.details
            };
        }

        if (best.confidence >= MIN_INVALID_CONFIDENCE) {
            return {
                url: best.url,
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
            const withProtocol = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;
            const parsed = new URL(withProtocol);
            const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
            if (!hostname) return null;
            if (hostname.includes('google.') || hostname.includes('bing.com') || hostname.includes('duckduckgo.com')) {
                return null;
            }
            if (parsed.pathname.toLowerCase().endsWith('.pdf')) return null;
            return `https://${hostname}`;
        } catch {
            return null;
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

        const dnsProbe = await HoneyPotDetector.getInstance().checkDNS(normalizedUrl);
        if (!dnsProbe.safe) {
            const result = { confidence: 0, reason: dnsProbe.reason || 'DNS check failed' };
            this.setCachedVerification(cacheKey, result);
            return result;
        }

        let page;
        try {
            page = await this.browserFactory.newPage();

            // Block unnecessary resources
            await this.setupFastInterception(page);
            await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });

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

            // 🛡️ HONEYPOT CHECK
            const honeyPot = HoneyPotDetector.getInstance();
            const safety = honeyPot.analyzeContent(extraction.html);
            if (!safety.safe) {
                Logger.warn(`[DeepVerify] 🍯 Trap: ${normalizedUrl} -> ${safety.reason}`);
                const result = { confidence: 0, reason: safety.reason };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // Content validation
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) {
                // Report failure to genetic algorithm if blocked
                if (extraction.text.includes('Captcha') || extraction.text.includes('Access Denied')) {
                    const geneId = (page as any).__geneId;
                    if (geneId) this.fingerprinter.reportFailure(geneId);
                }
                const result = { confidence: 0, reason: filter.reason };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // Report success to genetic algorithm
            const geneId = (page as any).__geneId;
            if (geneId) this.fingerprinter.reportSuccess(geneId);

            let combinedText = extraction.text;
            let evaluation = CompanyMatcher.evaluate(company, currentUrl, combinedText, extraction.title);

            const candidateLinks = this.collectEvidenceLinks(extraction.links, currentUrl);
            if (evaluation.confidence < THRESHOLDS.WAVE2_NET && candidateLinks.length > 0) {
                for (const link of candidateLinks.slice(0, 2)) {
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
                    confidence: Math.max(0, evaluation.confidence - 0.08),
                    reason: `${evaluation.reason}, foreign language`,
                };
            }

            if (evaluation.confidence < THRESHOLDS.WAVE3_JUDGE && process.env.OPENAI_API_KEY) {
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
            Logger.warn('[DeepVerify] Verification failed', { error: e as Error, url: normalizedUrl, company_name: company.company_name });
            return null;
        } finally {
            if (page) {
                page.removeAllListeners('request');
                await this.browserFactory.closePage(page);
            }
        }
    }

    private async deepVerifyWithAI(url: string, company: CompanyInput): Promise<any | null> {
        if (!process.env.OPENAI_API_KEY) return null;
        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl || ContentFilter.isDirectoryOrSocial(normalizedUrl)) return null;

        let page;
        try {
            page = await this.browserFactory.newPage();
            await this.setupFastInterception(page);

            await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

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
        const requestHandler = (req: HTTPRequest) => {
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
            const baseHost = new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase();
            const keywords = ['contatt', 'chi siamo', 'about', 'dove siamo', 'impressum', 'privacy', 'cookie'];
            const selected = new Set<string>();

            for (const link of links) {
                const normalized = this.normalizeUrl(link.href);
                if (!normalized) continue;
                const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
                if (host !== baseHost) continue;

                const text = (link.text || '').toLowerCase();
                if (keywords.some((keyword) => text.includes(keyword))) {
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
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await this.acceptGoogleConsentIfPresent(page);
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
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
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
                return items.slice(0, 10).map((a) => ({ link: a.href }));
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
