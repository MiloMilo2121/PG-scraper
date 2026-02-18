/**
 * 🌊 UNIFIED DISCOVERY SERVICE v3 (RESTORED & ENHANCED)
 * OMEGA PROTOCOL - MULTI-LAYER DISCOVERY ENGINE
 *
 * Layer 1: Identity & Surgical Search (Zero Cost)
 * Layer 2: Semantic Prediction (LLM Oracle)
 * Layer 3: The Swarm (HyperGuesser + QueryBuilder + Google/Bing/DDG/Jina)
 * Layer 4: The Judge (AI Verification)
 *
 * RESTORATION UPDATE:
 * - Re-integrated Jina Search (High Precision)
 * - Re-integrated Bing & DuckDuckGo (Failover)
 * - Re-integrated AI Employee Estimation
 * - Re-integrated Mode Profiles for Granular Thresholds
 */

import pLimit from 'p-limit';
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { RateLimiter, MemoryRateLimiter } from '../rate_limiter';
import { ContentFilter } from './content_filter';
import { HyperGuesser } from './hyper_guesser_v2';
import { SerperSearchProvider, DDGSearchProvider } from './search_provider';
import { LLMValidator } from '../ai/llm_validator';
import { AntigravityClient } from '../../observability/antigravity_client';
import { config } from '../../config';
import { CompanyMatcher } from './company_matcher';
import { DomainValidator } from '../../utils/domain_validator';
import { NuclearStrategy } from './nuclear_strategy';
import { IdentityResolver, IdentityResult } from './identity_resolver';
import { SurgicalSearch } from './surgical_search';
import { PagineGialleHarvester } from '../directories/paginegialle';
import { ScraperClient } from '../../utils/scraper_client';
import { LLMOracle } from './llm_oracle';
import { QueryBuilder, GoldenQuery } from './query_builder';
import { AgentRunner } from '../agent/agent_runner';

// ============================================================================
// INTERFACES & CONFIG
// ============================================================================

export enum DiscoveryMode {
    FAST_RUN1 = 'FAST_RUN1',
    DEEP_RUN2 = 'DEEP_RUN2',
    AGGRESSIVE_RUN3 = 'AGGRESSIVE_RUN3',
    NUCLEAR_RUN4 = 'NUCLEAR_RUN4'
}

export interface DiscoveryResult {
    url: string | null;
    status: 'FOUND_VALID' | 'FOUND_INVALID' | 'NOT_FOUND' | 'ERROR';
    method: string;
    confidence: number;
    wave: string;
    details: any;
}

// Granular Control Profile
type ModeProfile = {
    wave1ThresholdDelta: number;
    // wave2ThresholdDelta: number; // Simplified: Use same delta for now
    wave1MaxCandidates: number;
    // wave2MaxCandidates: number;
    // wave3GuessStart: number;
    // wave3GuessEnd: number;
    runNuclear: boolean;
};

const MODE_PROFILES: Record<DiscoveryMode, ModeProfile> = {
    [DiscoveryMode.FAST_RUN1]: {
        wave1ThresholdDelta: 0.05,
        wave1MaxCandidates: 8,
        runNuclear: false,
    },
    [DiscoveryMode.DEEP_RUN2]: {
        wave1ThresholdDelta: 0,
        wave1MaxCandidates: 15,
        runNuclear: false,
    },
    [DiscoveryMode.AGGRESSIVE_RUN3]: {
        wave1ThresholdDelta: -0.05,
        wave1MaxCandidates: 20,
        runNuclear: false, // Nuclear is separate mode now
    },
    [DiscoveryMode.NUCLEAR_RUN4]: {
        wave1ThresholdDelta: -0.08,
        wave1MaxCandidates: 30,
        runNuclear: true,
    },
};

const THRESHOLDS = {
    WAVE1_SWARM: config.discovery.thresholds.wave1, // Baseline: 0.75
    WAVE3_JUDGE: config.discovery.thresholds.wave3, // Baseline: 0.85
    MINIMUM_VALID: config.discovery.thresholds.minValid // Baseline: 0.60
};

type Candidate = {
    url: string;
    source: string;
    confidence: number;
};

// ============================================================================
// UNIFIED DISCOVERY SERVICE v3 (ENHANCED)
// ============================================================================

export class UnifiedDiscoveryService {
    private browserFactory: BrowserFactory;
    private rateLimiter: RateLimiter;
    private identityResolver: IdentityResolver;
    private surgicalSearch: SurgicalSearch;
    private nuclearStrategy: NuclearStrategy;
    private validatorLimit = pLimit(20);
    private verificationCache = new Map<string, any>();
    private readonly verificationCacheTtlMs = 15 * 60 * 1000;
    private readonly verificationCacheMaxEntries = config.discovery.verificationCacheMaxEntries;

    constructor(
        browserFactory?: BrowserFactory,
        rateLimiter?: RateLimiter
    ) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
        this.rateLimiter = rateLimiter || new MemoryRateLimiter();
        this.identityResolver = new IdentityResolver();
        this.surgicalSearch = new SurgicalSearch();
        this.nuclearStrategy = new NuclearStrategy();
    }

    /**
     * 🔎 Verify a single candidate URL.
     */
    public async verifyUrl(url: string, company: CompanyInput): Promise<any | null> {
        return this.deepVerify(url, company);
    }

    // =========================================================================
    // 🌊 MAIN DISCOVERY ENTRY POINT
    // =========================================================================
    public async discover(company: CompanyInput, mode: DiscoveryMode = DiscoveryMode.DEEP_RUN2): Promise<DiscoveryResult> {
        Logger.info(`[Discovery] 🌊 Starting OMEGA v3 discovery for "${company.company_name}" (Mode: ${mode})`);
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'SEARCHING', { mode });

        // Apply Mode Profile
        const profile = MODE_PROFILES[mode] || MODE_PROFILES[DiscoveryMode.DEEP_RUN2];
        const currentThreshold = this.applyThresholdDelta(THRESHOLDS.WAVE1_SWARM, profile.wave1ThresholdDelta);

        let bestInvalid: DiscoveryResult | null = null;
        let identity: IdentityResult | null = null;

        try {
            // =====================================================================
            // 💰 LAYER 1: IDENTITY RESOLUTION (Zero Cost)
            // =====================================================================
            Logger.info(`[Discovery] 🕵️ LAYER 1: IDENTITY RESOLUTION`);
            identity = await this.identityResolver.resolveIdentity(company);

            if (identity) {
                Logger.info(`[Discovery] ✅ Identity Resolved: ${identity.legal_name} (${identity.vat_number})`);
            } else {
                Logger.warn(`[Discovery] ⚠️ Identity resolution failed - proceeding with limited info`);
            }

            // PRE-CHECK: Validate existing website
            if (company.website && company.website.length > 5 && !company.website.includes('paginegialle.it')) {
                const preCheck = await this.deepVerify(company.website, company);

                // If existing website is valid, return immediately
                if (preCheck && preCheck.confidence >= THRESHOLDS.MINIMUM_VALID) {
                    return this.finalize(company, {
                        url: preCheck.final_url || company.website,
                        status: 'FOUND_VALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck
                    }, identity);
                }

                // Keep as fallback if invalid but decent
                if (preCheck && preCheck.confidence >= 0.35) {
                    bestInvalid = {
                        url: preCheck.final_url || company.website,
                        status: 'FOUND_INVALID',
                        method: 'pre_existing',
                        confidence: preCheck.confidence,
                        wave: 'PRE',
                        details: preCheck
                    };
                }
            }

            // SURGICAL SEARCH (if identity known)
            if (identity) {
                const surgicalResult = await this.surgicalSearch.execute(identity, company);
                if (surgicalResult) {
                    return this.finalize(company, {
                        url: surgicalResult.url,
                        status: 'FOUND_VALID',
                        method: surgicalResult.method,
                        confidence: surgicalResult.confidence,
                        wave: 'LAYER1_SURGICAL',
                        details: surgicalResult
                    }, identity);
                }
            }

            // =====================================================================
            // 🧠 LAYER 2: SEMANTIC WEB (LLM Oracle)
            // =====================================================================
            Logger.info(`[Discovery] 🧠 LAYER 2: LLM ORACLE`);
            const oracleUrl = await LLMOracle.predictWebsite(company);
            if (oracleUrl) {
                const oracleVerification = await this.deepVerify(oracleUrl, company);
                if (oracleVerification && oracleVerification.confidence >= 0.85) {
                    return this.finalize(company, {
                        url: oracleVerification.final_url || oracleUrl,
                        status: 'FOUND_VALID',
                        method: 'llm_oracle',
                        confidence: oracleVerification.confidence,
                        wave: 'LAYER2_ORACLE',
                        details: oracleVerification
                    }, identity);
                }
            }

            // =====================================================================
            // 🐝 LAYER 3: THE SWARM (Parallel Execution) + JINA/BING/DDG
            // =====================================================================
            Logger.info(`[Discovery] 🐝 LAYER 3: THE SWARM (Google + Bing + DDG + Jina + HyperGuesser)`);

            // Execute parallel strategies (RESTORED sources)
            const swarmCandidates = await this.executeSwarm(company, identity);

            // Validate Top Candidates with dynamic threshold
            const validResult = await this.validateAndSelectBest(
                swarmCandidates,
                company,
                'LAYER3_SWARM',
                currentThreshold,
                profile.wave1MaxCandidates
            );

            if (validResult && validResult.status === 'FOUND_VALID') {
                return this.finalize(company, validResult, identity);
            }

            if (validResult) {
                // Keep track of best invalid if better than previous
                if (!bestInvalid || validResult.confidence > bestInvalid.confidence) {
                    bestInvalid = validResult;
                }
            }

            // =====================================================================
            // ⚖️ LAYER 4: THE JUDGE (Nuclear Fallback)
            // =====================================================================
            if (profile.runNuclear) {
                Logger.info(`[Discovery] ⚖️ LAYER 4: NUCLEAR FALLBACK`);
                try {
                    const nuclear = await this.nuclearStrategy.execute(company);
                    if (nuclear && nuclear.url) {
                        const ver = await this.deepVerify(nuclear.url, company);
                        if (ver && ver.confidence >= THRESHOLDS.MINIMUM_VALID) {
                            return this.finalize(company, {
                                url: ver.final_url || nuclear.url,
                                status: 'FOUND_VALID',
                                method: 'nuclear',
                                confidence: ver.confidence,
                                wave: 'LAYER4_NUCLEAR',
                                details: ver
                            }, identity);
                        }
                    }
                } catch (e: any) {
                    Logger.warn('[Wave4] Nuclear strategy failed', { error: e, company_name: company.company_name });
                }
            }

            // FINAL REPORT
            if (bestInvalid) {
                Logger.warn(`[Discovery] ⚠️ Best candidate invalid: ${bestInvalid.url} (${bestInvalid.confidence.toFixed(2)})`);
                AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'Low confidence' });
                return this.attachIdentity(bestInvalid, identity);
            }

            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'Waves exhausted' });
            return this.attachIdentity({
                url: null,
                status: 'NOT_FOUND',
                method: 'waves_exhausted',
                confidence: 0,
                wave: 'ALL',
                details: {}
            }, identity);

        } catch (error: any) {
            Logger.error(`[Discovery] Error:`, { error });
            return this.attachIdentity({
                url: null,
                status: 'ERROR',
                method: 'exception',
                confidence: 0,
                wave: 'ERROR',
                details: { error: error.message }
            }, identity);
        }
    }

    // =========================================================================
    // 🐝 SWARM EXECUTION
    // =========================================================================
    private async executeSwarm(company: CompanyInput, identity: IdentityResult | null): Promise<Candidate[]> {
        const candidates: Candidate[] = [];

        // 1. HyperGuesser (DNS & Parking Filtered)
        const guesserPromise = this.hyperGuesserAttack(company);

        // 2. Google/Serper (Golden Queries)
        const searchPromise = this.searchAttack(company);

        // 3. PagineGialle Phone (High Precision)
        const pgPromise = this.pagineGiallePhoneAttack(company);

        // 4. Jina Semantic Search (RESTORED)
        const jinaPromise = this.searchJina(company);

        // 5. Bing & DDG Fallbacks (RESTORED) - Running always for robustness in V3?
        // Let's run them to ensure we don't miss anything, relying on deduplication.
        const bingPromise = this.searchBing(company);
        const ddgPromise = this.searchDDG(company);

        const [guesses, searchResults, pgResults, jinaResults, bingResults, ddgResults] = await Promise.all([
            guesserPromise,
            searchPromise,
            pgPromise,
            jinaPromise,
            bingPromise,
            ddgPromise
        ]);

        if (guesses) candidates.push(...guesses);
        if (searchResults) candidates.push(...searchResults);
        if (pgResults) candidates.push(...pgResults);
        if (jinaResults) candidates.push(...jinaResults);
        if (bingResults) candidates.push(...bingResults);
        if (ddgResults) candidates.push(...ddgResults);

        return this.deduplicate(candidates);
    }

    private async hyperGuesserAttack(company: CompanyInput): Promise<Candidate[]> {
        try {
            const domains = HyperGuesser.generate(
                company.company_name,
                company.city || '',
                company.province || '',
                company.category || ''
            );

            // Limited bulk check to avoid massive DNS traffic
            const topDomains = domains.slice(0, 40);
            Logger.debug(`[HyperGuesser] Generated ${topDomains.length} candidates. Checking DNS...`);

            // BULK DNS CHECK
            const liveDomains = await DomainValidator.bulkCheckDNS(topDomains, 200);

            // PARKING PAGE FILTER (Check top 15 survivors)
            const validDomains: string[] = [];
            for (const domain of liveDomains.slice(0, 15)) {
                const notParked = await DomainValidator.isNotParked(domain);
                if (notParked) validDomains.push(domain);
            }

            return validDomains.map(url => ({
                url,
                source: 'hyper_guesser',
                confidence: 0.70
            }));
        } catch (e: any) {
            Logger.warn('[HyperGuesser] Failed', { error: e });
            return [];
        }
    }

    private async searchAttack(company: CompanyInput): Promise<Candidate[]> {
        const candidates: Candidate[] = [];
        const queries = QueryBuilder.buildGoldenQueries(company);

        // Execute top 3 queries parallely
        const topQueries = queries.slice(0, 3);

        const results = await Promise.all(topQueries.map(q => this.executeQuery(q)));

        results.flat().forEach(c => candidates.push(c));
        return candidates;
    }

    private async executeQuery(q: GoldenQuery): Promise<Candidate[]> {
        try {
            await this.rateLimiter.waitForSlot('google');

            const provider = new SerperSearchProvider();
            const results = await provider.search(q.query);

            this.rateLimiter.reportSuccess('google');

            return results.slice(0, 5).map(r => ({
                url: r.url,
                source: `search_${q.type}`,
                confidence: 0.60 + (q.expectedPrecision * 0.2)
            }));
        } catch (e: any) {
            this.rateLimiter.reportFailure('google');
            Logger.warn(`[Search] Query failed: ${q.query}`, { error: e });
            return [];
        }
    }

    // RESTORED: Jina Search
    private async searchJina(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            // Basic Jina Search check (lightweight)
            if (!ScraperClient.isJinaEnabled()) return null;

            const query = `${company.company_name} ${company.city || ''} sito ufficiale`;
            const response = await ScraperClient.fetchJinaSearch(query);

            if (response.status !== 200 || !response.data) return null;

            // Clean results
            const results = ScraperClient.parseJinaSearchResults(response.data);
            Logger.info(`[Jina] Found ${results.length} results`);

            return results.slice(0, 6).map(r => ({
                url: r.url,
                source: 'jina_search',
                confidence: 0.78 // High quality source
            }));
        } catch (e: any) {
            Logger.warn('[Jina] Search failed', { error: e });
            return null;
        }
    }

    // RESTORED: Bing Search (Fallback)
    private async searchBing(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('bing');
            // Using ScraperClient to fetch Bing HTML directly (using Scrape.do usually)
            // Or simple fetch if we had a proper provider. 
            // In V2 we had scrapeBingDIY, here we lack it.
            // Let's rely on ScraperClient basic fetch for now, OR better, skip if no reliable provider.
            // WAIT - In V2 verifyUrl code I see: `this.scrapeBingDIY(query)`.
            // I will implement a simplified `scrapeBingDIY` using ScraperClient here.

            const query = encodeURIComponent(`${company.company_name} ${company.city || ''} sito ufficiale`);
            const url = `https://www.bing.com/search?q=${query}`;
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do' }); // Low block rate

            // Simple regex to extract links from Bing
            // <li class="b_algo"><h2><a href="...">
            const links: string[] = [];
            const regex = /<li class="b_algo"><h2><a href="([^"]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                if (!match[1].startsWith('http')) continue;
                links.push(match[1]);
            }

            return links.slice(0, 5).map(link => ({
                url: link,
                source: 'bing_diy',
                confidence: 0.65
            }));
        } catch (e) {
            // Bing often fails/blocks, low log
            return null;
        }
    }

    // RESTORED: DDG Search (Fallback)
    private async searchDDG(company: CompanyInput): Promise<Candidate[] | null> {
        // DDG via TorProvider/DDGProvider available in SearchProvider?
        // The V2 used `scrapeDDGDIY`.
        // We can check if `DDGSearchProvider` is working.
        try {
            // const provider = new DDGSearchProvider(); // Requires Tor connection check
            // Skip Tor complexity for this clean version, rely on Google/Serper/Jina primarily.
            // If user really wants DDG fallback we can add it, but it often slows things down via Tor.
            // Instead, simple Scrape.do request to DDG HTML

            await this.rateLimiter.waitForSlot('duckduckgo');
            const query = encodeURIComponent(`${company.company_name} ${company.city || ''} sito`);
            const url = `https://html.duckduckgo.com/html/?q=${query}`;
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do' });

            const links: string[] = [];
            const regex = /class="result__a" href="([^"]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                // DDG uses relative links or redirects, need to check
                // Usually format is result__a href="//duckduckgo.com/l/?uddg=..."
                let link = match[1];
                if (link.includes('uddg=')) {
                    const decoded = decodeURIComponent(link.split('uddg=')[1].split('&')[0]);
                    links.push(decoded);
                }
            }

            return links.slice(0, 5).map(link => ({
                url: link,
                source: 'ddg_diy',
                confidence: 0.60
            }));

        } catch (e) {
            return null;
        }
    }

    private async pagineGiallePhoneAttack(company: CompanyInput): Promise<Candidate[] | null> {
        if (!company.phone || company.phone.length < 6) return null;
        try {
            const harvest = await PagineGialleHarvester.harvestByPhone(company);
            if (harvest?.officialWebsite) {
                return [{ url: harvest.officialWebsite, source: 'pg_phone', confidence: 0.9 }];
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // =========================================================================
    // 🔍 VERIFICATION LOGIC
    // =========================================================================

    private async validateAndSelectBest(candidates: Candidate[], company: CompanyInput, wave: string, threshold: number, max: number): Promise<DiscoveryResult | null> {
        // Sort by raw confidence/source priority
        const unique = this.deduplicate(candidates).slice(0, max);

        if (unique.length === 0) return null;

        Logger.info(`[Validation] Validating ${unique.length} candidates from ${wave}...`);

        // Verify in parallel batches
        const checks = unique.map(c => this.validatorLimit(async () => {
            const verification = await this.deepVerify(c.url, company);
            if (!verification) return null;

            return {
                url: c.url,
                status: verification.confidence >= threshold ? 'FOUND_VALID' : 'FOUND_INVALID',
                method: c.source,
                confidence: verification.confidence,
                wave,
                details: verification
            } as DiscoveryResult;
        }));

        const results = (await Promise.all(checks)).filter(r => r !== null) as DiscoveryResult[];

        // Find best
        results.sort((a, b) => b.confidence - a.confidence);

        if (results.length > 0) {
            const best = results[0];
            if (best.confidence >= threshold) return best;
            return best;
        }

        return null;
    }

    // DEEP VERIFY IMPLEMENTATION
    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url || ContentFilter.isDirectoryOrSocial(url)) return null;

        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl) return null;

        const cacheKey = this.buildVerificationCacheKey(normalizedUrl, company);
        const cached = this.getCachedVerification(cacheKey);
        if (cached) return cached;

        let page = null;
        try {
            // Jina Verify First
            if (ScraperClient.isJinaEnabled()) {
                const jinaResult = await this.jinaVerify(normalizedUrl, company);
                if (jinaResult) {
                    this.setCachedVerification(cacheKey, jinaResult);
                    return jinaResult;
                }
            }

            page = await this.browserFactory.newPage();
            // Block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

            const content = await page.content();
            const title = await page.title();
            const text = await page.evaluate(() => document.body.innerText);
            const finalUrl = page.url();
            const canonicalFinalUrl = this.normalizeUrl(finalUrl) || finalUrl;

            // Basic content filter
            const filter = ContentFilter.isValidContent(text);
            if (!filter.valid) {
                const res = { confidence: 0, reason: filter.reason, final_url: canonicalFinalUrl };
                this.setCachedVerification(cacheKey, res);
                return res;
            }

            let match = CompanyMatcher.evaluate(company, finalUrl, text, title) as any;
            match.final_url = canonicalFinalUrl;

            // Agentic fallback for low confidence but relevant content
            if (match.confidence < 0.4 && match.confidence > 0.1 && (process.env.OPENAI_API_KEY)) {
                try {
                    const goal = `Find the VAT number (P.IVA) for "${company.company_name}" in "${company.city || 'Italy'}". Return ONLY the VAT code.`;
                    // Simplified agent run
                    const agentResult = await AgentRunner.run(page, goal);
                    if (agentResult && (agentResult.includes('IT') || agentResult.match(/\d{11}/))) {
                        match.scrapedVat = agentResult;
                        match.confidence = 0.95;
                        match.reason += "; Agent verified P.IVA";
                    }
                } catch (e) { }
            }

            this.setCachedVerification(cacheKey, match);
            return match;

        } catch (e: any) {
            Logger.warn(`[DeepVerify] Verification failed for ${url}:`, { error: e });
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    // =========================================================================
    // 🛠️ UTILS
    // =========================================================================
    private attachIdentity(result: DiscoveryResult, identity: IdentityResult | null): DiscoveryResult {
        if (!identity) return result;
        return { ...result, details: { ...result.details, identity } };
    }

    // RESTORED: AI Employee Estimation using IdentityResolver
    private async finalize(company: CompanyInput, result: DiscoveryResult, identity: IdentityResult | null): Promise<DiscoveryResult> {

        // If we found a site, but don't have employee count, let's try to estimate it from the site
        if (result.status === 'FOUND_VALID' && result.url && identity && !identity.financials?.employees) {
            try {
                const aiEmployees = await this.identityResolver.estimateEmployeesFromWebsite(company, result.url);
                if (aiEmployees) {
                    if (!identity.financials) identity.financials = {};
                    identity.financials.employees = `${aiEmployees} (AI Est.)`;
                    Logger.info(`[Finalize] 🤖 Enriched employee count: ${aiEmployees}`);
                }
            } catch (e: any) {
                Logger.warn('[Finalize] Employee estimation failed', { error: e });
            }
        }

        const final = this.attachIdentity(result, identity);
        this.notifySuccess(company, final);
        return final;
    }

    private notifySuccess(company: CompanyInput, result: DiscoveryResult) {
        AntigravityClient.getInstance().trackCompanyUpdate(company, 'ENRICHED', {
            url: result.url,
            confidence: result.confidence,
            method: result.method
        });
        Logger.info(`[Discovery] 🏆 SUCCESS: ${company.company_name} -> ${result.url} (${result.confidence})`);
    }

    private deduplicate(candidates: Candidate[]): Candidate[] {
        const seen = new Set<string>();
        return candidates.filter(c => {
            const domain = c.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            if (seen.has(domain)) return false;
            seen.add(domain);
            return true;
        });
    }

    private applyThresholdDelta(base: number, delta: number): number {
        return Math.min(0.99, Math.max(0.1, base + delta));
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

    private buildVerificationCacheKey(url: string, company: CompanyInput): string {
        return `${url}|${company.company_name}|${company.vat_code || ''}`;
    }

    private getCachedVerification(key: string): any | null {
        const cached = this.verificationCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.verificationCacheTtlMs) {
            return cached.data;
        }
        if (cached) {
            this.verificationCache.delete(key);
        }
        return null;
    }

    private setCachedVerification(key: string, data: any) {
        if (this.verificationCache.size >= this.verificationCacheMaxEntries) {
            const oldestKey = this.verificationCache.keys().next().value;
            if (oldestKey) {
                this.verificationCache.delete(oldestKey);
            }
        }
        this.verificationCache.set(key, { data, timestamp: Date.now() });
    }

    private async jinaVerify(url: string, company: CompanyInput): Promise<any | null> {
        try {
            const response = await ScraperClient.fetchJinaReader(url);
            if (response.status === 200 && response.data) {
                const text = response.data;
                const match = CompanyMatcher.evaluate(company, url, text, '') as any;
                match.final_url = this.normalizeUrl(url) || url;
                return match;
            }
        } catch (e) {
            // Ignore jina errors
        }
        return null;
    }
}
