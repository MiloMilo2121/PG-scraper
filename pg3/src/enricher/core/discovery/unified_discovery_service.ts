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
import * as cheerio from 'cheerio';
import { Page, HTTPRequest } from 'puppeteer';
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
import { HoneyPotDetector } from '../security/honeypot_detector';

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
    reason_code?: string;
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
        const stopTheBleeding = config.discovery.stopTheBleeding;
        const currentThreshold = this.applyThresholdDelta(THRESHOLDS.WAVE1_SWARM, profile.wave1ThresholdDelta);
        const effectiveThreshold = stopTheBleeding ? Math.max(currentThreshold, THRESHOLDS.MINIMUM_VALID) : currentThreshold;
        const effectiveMaxCandidates = stopTheBleeding ? Math.min(profile.wave1MaxCandidates, 8) : profile.wave1MaxCandidates;

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
            // 📧 LAYER 1.5: EMAIL DOMAIN REVERSE ENGINEERING (Absolute Precision)
            // =====================================================================
            Logger.info(`[Discovery] 📧 LAYER 1.5: EMAIL DOMAIN REVERSAL`);
            const emailReverseResult = await this.reverseEngineerEmailDomain(company, effectiveThreshold);
            if (emailReverseResult) {
                return this.finalize(company, emailReverseResult, identity);
            }

            // =====================================================================
            // 🏛️ LAYER 1.7: REGISTRY DORKING (High Iteration)
            // =====================================================================
            Logger.info(`[Discovery] 🏛️ LAYER 1.7: REGISTRY DORKING`);
            const registryResult = await this.dorkRegistries(company, effectiveThreshold);
            if (registryResult) {
                return this.finalize(company, registryResult, identity);
            }


            // =====================================================================
            // 🧠 LAYER 2: SEMANTIC WEB (LLM Oracle)
            // =====================================================================
            if (!stopTheBleeding) {
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
            } else {
                Logger.warn('[Discovery] Stop-the-bleeding mode active: skipping LLM oracle layer');
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
                effectiveThreshold,
                effectiveMaxCandidates
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
            if (!stopTheBleeding && profile.runNuclear) {
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
            } else if (stopTheBleeding) {
                Logger.warn('[Discovery] Stop-the-bleeding mode active: skipping nuclear layer');
            }

            // FINAL REPORT
            if (bestInvalid) {
                Logger.warn(`[Discovery] ⚠️ Best candidate invalid: ${bestInvalid.url} (${bestInvalid.confidence.toFixed(2)})`);
                AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'Low confidence' });
                return this.attachIdentity(this.withReasonCode(bestInvalid), identity);
            }

            AntigravityClient.getInstance().trackCompanyUpdate(company, 'FAILED', { reason: 'Waves exhausted' });
            return this.attachIdentity(this.withReasonCode({
                url: null,
                status: 'NOT_FOUND',
                method: 'waves_exhausted',
                confidence: 0,
                wave: 'ALL',
                details: {}
            }), identity);

        } catch (error: any) {
            Logger.error(`[Discovery] Error:`, { error });
            return this.attachIdentity(this.withReasonCode({
                url: null,
                status: 'ERROR',
                method: 'exception',
                confidence: 0,
                wave: 'ERROR',
                details: { error: error.message }
            }), identity);
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

        // 5. Bing & DDG Fallbacks
        const bingPromise = this.searchBing(company);
        const ddgPromise = this.searchDDG(company);

        // 6. VAT/P.IVA Search (High Precision)
        const vatPromise = this.googleSearchByVat(company);

        // Use allSettled to prevent one failing source from killing the entire swarm
        const settled = await Promise.allSettled([
            guesserPromise,
            searchPromise,
            pgPromise,
            jinaPromise,
            bingPromise,
            ddgPromise,
            vatPromise
        ]);

        const labels = ['HyperGuesser', 'Serper', 'PagineGialle', 'Jina', 'Bing', 'DDG', 'VAT'];
        const results: (Candidate[] | null)[] = settled.map((r, i) => {
            if (r.status === 'fulfilled') return r.value;
            Logger.warn(`[Swarm] ${labels[i]} strategy rejected: ${(r.reason as Error)?.message || r.reason}`);
            return null;
        });

        const [guesses, searchResults, pgResults, jinaResults, bingResults, ddgResults, vatResults] = results;

        if (vatResults) candidates.push(...vatResults); // VAT first (highest confidence)
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

            // Parking filter: parallel check of all DNS-valid domains (with timeout)
            const parkingChecks = await Promise.all(
                liveDomains.map(async (url) => {
                    const notParked = await DomainValidator.isNotParked(url, 6000);
                    return notParked ? url : null;
                })
            );
            const validDomains = parkingChecks.filter((url): url is string => !!url);
            Logger.info(`[HyperGuesser] After parking filter: ${validDomains.length}/${liveDomains.length}`);

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

        // Execute top 5 queries in parallel (more coverage with sector/location variants)
        const topQueries = queries.slice(0, 5);

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

    // Bing Search via ScraperClient (Fallback)
    private async searchBing(company: CompanyInput): Promise<Candidate[] | null> {
        try {
            await this.rateLimiter.waitForSlot('bing');

            const query = encodeURIComponent(`${company.company_name} ${company.city || ''} sito ufficiale`);
            const url = `https://www.bing.com/search?q=${query}`;
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do' });

            const links: string[] = [];
            const regex = /<li class="b_algo"><h2><a href="([^"]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                if (!match[1].startsWith('http')) continue;
                links.push(match[1]);
            }

            this.rateLimiter.reportSuccess('bing');
            return links.slice(0, 5).map(link => ({
                url: link,
                source: 'bing_diy',
                confidence: 0.65
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('bing');
            return null;
        }
    }

    // VAT/P.IVA Search via Serper (High precision)
    private async googleSearchByVat(company: CompanyInput): Promise<Candidate[] | null> {
        const vat = (company as any).vat_code || (company as any).vat || (company as any).piva;
        if (!vat || vat.length < 5) return null;

        try {
            await this.rateLimiter.waitForSlot('google');
            const provider = new SerperSearchProvider();
            const results = await provider.search(`"${vat}" sito ufficiale`);
            this.rateLimiter.reportSuccess('google');
            return results.slice(0, 5).map(r => ({
                url: r.url,
                source: 'google_vat',
                confidence: 0.92
            }));
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn('[VATSearch] Google VAT search failed', { error: e as Error, company_name: company.company_name });
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
        } catch (e: any) {
            Logger.warn('[PagineGiallePhone] Harvest failed', { error: e, company_name: company.company_name });
        }
        return null;
    }

    // =========================================================================
    // 📧 LAYER 1.5 / 1.7 NEW LOGIC
    // =========================================================================

    private async reverseEngineerEmailDomain(company: CompanyInput, threshold: number): Promise<DiscoveryResult | null> {
        const emails = [company.email, (company as any).pec].filter(e => e && e.includes('@'));
        const PUBLIC_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'pec.it', 'legalmail.it', 'arubapec.it'];

        for (const email of emails) {
            try {
                const domain = email!.split('@')[1].toLowerCase().trim();
                // If it's a generic public domain or a generic PEC provider, skip it.
                if (PUBLIC_DOMAINS.includes(domain) || domain.includes('.telecompost.it') || domain.includes('mypec.eu')) {
                    continue;
                }

                Logger.info(`[EmailReversal] Probing domain extracted from email: ${domain}`);

                const url = `http://${domain}`;
                const verification = await this.deepVerify(url, company);

                if (verification && verification.confidence >= threshold) {
                    return {
                        url: verification.final_url || url,
                        status: 'FOUND_VALID',
                        method: 'email_reversal',
                        confidence: verification.confidence,
                        wave: 'LAYER1_5_EMAIL',
                        details: verification
                    };
                }
            } catch (e) {
                Logger.warn(`[EmailReversal] Error probing email ${email}`);
            }
        }
        return null;
    }

    private async dorkRegistries(company: CompanyInput, threshold: number): Promise<DiscoveryResult | null> {
        try {
            await this.rateLimiter.waitForSlot('google');
            const provider = new SerperSearchProvider();

            // Search in trusted Italian directories that often list outbound links
            const cityPart = company.city ? ` "${company.city}"` : '';
            const query = `site:registroimprese.it OR site:informazione-aziende.it "${company.company_name}"${cityPart}`;
            const results = await provider.search(query);
            this.rateLimiter.reportSuccess('google');

            for (const r of results) {
                // Check if the snippet contains a viable URL string before even opening the page
                // e.g., "Sito Web: www.azienda.it"
                const urlRegex = /(?:sito|web)[:\s]*(www\.[a-z0-9-]+\.[a-z]{2,3}|[a-z0-9-]+\.it\/)/i;
                const textToScan = r.title; // Serper provides title (snippet might need fetching)
                const match = r.title.match(urlRegex);

                let extractedUrl = match ? match[1] : null;

                // If not in snippet, we fetch the registry page and parse it (Scrape_do)
                if (!extractedUrl) {
                    const html = await ScraperClient.fetchText(r.url, { mode: 'scrape_do' });
                    if (html) {
                        const docMatch = html.match(/(?:href=")(https?:\/\/(?:www\.)?[^"\/]+(?:\.it|\.com|\.eu|\.net|\.srl|\.org))"/g);
                        if (docMatch) {
                            // Filter out social links and the registry's own domain
                            const cleaned = docMatch
                                .map(m => m.replace('href="', '').replace('"', ''))
                                .filter(l => !l.includes('registroimprese.it') && !l.includes('informazione-aziende.it') && !l.includes('google') && !l.includes('linkedin') && !l.includes('facebook'));

                            if (cleaned.length > 0) {
                                extractedUrl = cleaned[0];
                            }
                        }
                    }
                }

                if (extractedUrl) {
                    Logger.info(`[RegistryDorking] Found embedded link ${extractedUrl} in ${r.url}`);
                    const verification = await this.deepVerify(extractedUrl, company);
                    if (verification && verification.confidence >= threshold) {
                        return {
                            url: verification.final_url || extractedUrl,
                            status: 'FOUND_VALID',
                            method: 'registry_dork',
                            confidence: verification.confidence,
                            wave: 'LAYER1_7_REGISTRY',
                            details: verification
                        };
                    }
                }
            }
        } catch (e) {
            this.rateLimiter.reportFailure('google');
            Logger.warn(`[RegistryDorking] Error`, { error: e as Error });
        }
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
            const reasonCode = this.reasonCodeForVerification(verification);

            return {
                url: c.url,
                status: verification.confidence >= threshold ? 'FOUND_VALID' : 'FOUND_INVALID',
                method: c.source,
                confidence: verification.confidence,
                wave,
                reason_code: reasonCode,
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
                    Logger.info(`[Finalize] 🤖 Enriched employee count: ${aiEmployees} `);
                }
            } catch (e: any) {
                Logger.warn('[Finalize] Employee estimation failed', { error: e });
            }
        }

        const final = this.attachIdentity(this.withReasonCode(result), identity);
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

    private mapExceptionToReasonCode(error: unknown): string {
        const message = `${(error as any)?.message || error || ''} `.toLowerCase();
        if (message.includes('timeout') || message.includes('timed out')) return 'ERROR_TIMEOUT_FETCH';
        if (message.includes('429') || message.includes('rate limit')) return 'ERROR_PROVIDER_RATE_LIMIT';
        if (message.includes('403') || message.includes('blocked') || message.includes('captcha')) return 'ERROR_BLOCKED_403';
        if (message.includes('busy')) return 'ERROR_DB_BUSY';
        if (message.includes('config') || message.includes('invalid')) return 'ERROR_CONFIG_INVALID';
        return 'ERROR_INTERNAL';
    }

    private reasonCodeForVerification(verification: any): string {
        if (verification?.reason_code) return verification.reason_code;

        const reason = `${verification?.reason || ''} `.toLowerCase();
        const confidence = Number(verification?.confidence || 0);

        if (verification?.scraped_piva) return 'OK_CONFIRMED_VAT_MATCH';
        if (verification?.matched_phone) return 'OK_CONFIRMED_PHONE_MATCH';
        if (verification?.schema_signals?.vatMatch || verification?.schema_signals?.urlMatch) return 'OK_CONFIRMED_SCHEMAORG_URL';
        if (reason.includes('directory') || reason.includes('social')) return 'REJECTED_DIRECTORY_OR_SOCIAL';
        if (reason.includes('browser verification disabled')) return 'ERROR_BROWSER_DISABLED';
        if (reason.includes('timeout') || reason.includes('navigation')) return 'ERROR_TIMEOUT_FETCH';
        if (reason.includes('403') || reason.includes('blocked') || reason.includes('captcha')) return 'ERROR_BLOCKED_403';
        if (reason.includes('rate')) return 'ERROR_PROVIDER_RATE_LIMIT';
        if (confidence >= THRESHOLDS.MINIMUM_VALID) return 'OK_LIKELY_NAME_CITY_MATCH';
        if (confidence > 0) return 'REJECTED_NO_MATCHING_SIGNALS';
        return 'NOT_FOUND_NO_CANDIDATES';
    }

    private withReasonCode(result: DiscoveryResult): DiscoveryResult {
        if (result.reason_code) return result;

        if (result.status === 'ERROR') {
            return { ...result, reason_code: this.mapExceptionToReasonCode(result.details?.error) };
        }
        if (result.status === 'NOT_FOUND') {
            return { ...result, reason_code: 'NOT_FOUND_NO_CANDIDATES' };
        }
        if (result.status === 'FOUND_INVALID') {
            const reason = `${result.details?.reason || ''} `.toLowerCase();
            if (reason.includes('directory') || reason.includes('social')) {
                return { ...result, reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL' };
            }
            return { ...result, reason_code: 'REJECTED_NO_MATCHING_SIGNALS' };
        }
        if (result.status === 'FOUND_VALID') {
            const method = `${result.method || ''} `.toLowerCase();
            if (method.includes('vat') || method.includes('golden')) {
                return { ...result, reason_code: 'OK_CONFIRMED_VAT_MATCH' };
            }
            return { ...result, reason_code: this.reasonCodeForVerification(result.details) };
        }
        return { ...result, reason_code: 'ERROR_INTERNAL' };
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
        const domainCov = CompanyMatcher.domainCoverage(company.company_name, candidate.url);
        return candidate.confidence + domainCov * 0.25;
    }

    private extractSchemaOrgSignals(html: string, company: CompanyInput, currentUrl: string): {
        vatMatch: boolean;
        phoneMatch: boolean;
        urlMatch: boolean;
        foundVat?: string;
        foundPhone?: string;
        foundUrl?: string;
    } {
        const targetVat = `${company.vat_code || (company as any).vat || (company as any).piva || ''}`.replace(/\D/g, '');
        const targetPhone = CompanyMatcher.normalizePhone(company.phone);
        let foundVat: string | undefined;
        let foundPhone: string | undefined;
        let foundUrl: string | undefined;

        try {
            const $ = cheerio.load(html);
            const scripts = $('script[type="application/ld+json"]').toArray();
            const currentHost = new URL(currentUrl).hostname.replace(/^www\./, '').toLowerCase();

            const pushNode = (bucket: any[], node: any) => {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node)) {
                    node.forEach((n) => pushNode(bucket, n));
                    return;
                }
                bucket.push(node);
                if (Array.isArray(node['@graph'])) {
                    node['@graph'].forEach((n: any) => pushNode(bucket, n));
                }
            };

            for (const script of scripts) {
                const raw = $(script).text().trim();
                if (!raw) continue;
                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    continue;
                }

                const nodes: any[] = [];
                pushNode(nodes, parsed);
                for (const node of nodes) {
                    const rawType = node?.['@type'];
                    const types = Array.isArray(rawType) ? rawType : [rawType];
                    const isBusinessNode = types.some((t) =>
                        typeof t === 'string' &&
                        (t.toLowerCase().includes('organization') ||
                            t.toLowerCase().includes('localbusiness') ||
                            t.toLowerCase().includes('corporation'))
                    );
                    if (!isBusinessNode) continue;

                    const nodeUrl = typeof node.url === 'string' ? node.url : '';
                    if (nodeUrl) {
                        try {
                            const host = new URL(nodeUrl).hostname.replace(/^www\./, '').toLowerCase();
                            if (host === currentHost) {
                                foundUrl = nodeUrl;
                            }
                        } catch {
                            // ignore malformed url
                        }
                    }

                    const rawPhone = Array.isArray(node.telephone) ? node.telephone[0] : node.telephone;
                    if (typeof rawPhone === 'string') {
                        const normalized = CompanyMatcher.normalizePhone(rawPhone);
                        if (normalized) foundPhone = normalized;
                    }

                    const vatCandidates: string[] = [];
                    if (typeof node.vatID === 'string') vatCandidates.push(node.vatID);
                    if (typeof node.taxID === 'string') vatCandidates.push(node.taxID);
                    const identifier = node.identifier;
                    if (typeof identifier === 'string') vatCandidates.push(identifier);
                    if (Array.isArray(identifier)) {
                        identifier.forEach((id) => {
                            if (typeof id === 'string') vatCandidates.push(id);
                            if (id && typeof id === 'object' && typeof id.value === 'string') vatCandidates.push(id.value);
                        });
                    }
                    if (identifier && typeof identifier === 'object' && typeof identifier.value === 'string') {
                        vatCandidates.push(identifier.value);
                    }

                    for (const candidateVat of vatCandidates) {
                        const digits = candidateVat.replace(/\D/g, '');
                        if (digits.length === 11) {
                            foundVat = digits;
                            break;
                        }
                    }
                }
            }
        } catch {
            // ignore schema parsing errors
        }

        const vatMatch = !!targetVat && !!foundVat && foundVat === targetVat;
        const phoneMatch = !!targetPhone && !!foundPhone && (
            targetPhone.endsWith(foundPhone) || foundPhone.endsWith(targetPhone)
        );
        const urlMatch = !!foundUrl;

        return { vatMatch, phoneMatch, urlMatch, foundVat, foundPhone, foundUrl };
    }

    // =========================================================================
    // DEEP VERIFICATION
    // =========================================================================

    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (!url) return null;
        if (ContentFilter.isDirectoryOrSocial(url)) {
            return {
                confidence: 0,
                reason: 'Directory/social URL',
                reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                final_url: url,
            };
        }

        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl) {
            return {
                confidence: 0,
                reason: 'Invalid URL',
                reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                final_url: url,
            };
        }

        const cacheKey = this.buildVerificationCacheKey(normalizedUrl, company);
        const cached = this.getCachedVerification(cacheKey);
        if (cached) return cached;

        const dnsProbe = await HoneyPotDetector.getInstance().checkDNS(normalizedUrl);
        if (!dnsProbe.safe) {
            const result = {
                confidence: 0,
                reason: dnsProbe.reason || 'DNS check failed',
                reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                final_url: normalizedUrl,
            };
            this.setCachedVerification(cacheKey, result);
            return result;
        }

        let page;
        let lowConfidenceJinaResult: any | null = null;
        try {
            // 🧠 JINA-FIRST: If Jina is enabled, try browser-free verification first
            if (ScraperClient.isJinaEnabled()) {
                const jinaResult = await this.jinaVerify(normalizedUrl, company);
                if (jinaResult) {
                    const isLowConfidence = jinaResult.confidence > 0 && jinaResult.confidence < 0.4;
                    const hasStrongSignal = !!jinaResult.scraped_piva || !!jinaResult.matched_phone;
                    if (!isLowConfidence || hasStrongSignal) {
                        this.setCachedVerification(cacheKey, jinaResult);
                        return jinaResult;
                    }
                    Logger.info('[DeepVerify] Jina result low-confidence, escalating to browser verification', {
                        url: normalizedUrl,
                        confidence: jinaResult.confidence,
                        company_name: company.company_name,
                    });
                    lowConfidenceJinaResult = jinaResult;
                }
                // Jina failed — fall through to browser if available
            }

            if (!config.discovery.enableBrowser) {
                const httpFallback = await this.httpVerify(normalizedUrl, company);
                if (httpFallback) {
                    this.setCachedVerification(cacheKey, httpFallback);
                    return httpFallback;
                }
                const disabledResult = {
                    confidence: 0,
                    reason: 'Browser verification disabled',
                    reason_code: 'ERROR_BROWSER_DISABLED',
                    final_url: normalizedUrl,
                };
                this.setCachedVerification(cacheKey, disabledResult);
                return disabledResult;
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
                const navFail = {
                    confidence: 0,
                    reason: 'Navigation failed',
                    reason_code: 'ERROR_TIMEOUT_FETCH',
                    final_url: normalizedUrl,
                };
                this.setCachedVerification(cacheKey, navFail);
                return navFail;
            }

            if (lowConfidenceJinaResult && !lowConfidenceJinaResult.scraped_piva && !lowConfidenceJinaResult.matched_phone) {
                const goal = `Find the VAT number (P.IVA) for "${company.company_name}" in "${company.city || 'Italy'}". Return ONLY the VAT code.`;
                try {
                    const agentResult = await AgentRunner.run(page, goal);
                    if (agentResult && (agentResult.includes('IT') || agentResult.match(/\d{11}/))) {
                        const currentUrl = this.normalizeUrl(page.url()) || normalizedUrl;
                        const result = {
                            confidence: 0.95,
                            reason: `${lowConfidenceJinaResult.reason}; Agent verified P.IVA`,
                            level: 'RULE_STRONG',
                            scraped_piva: agentResult,
                            matched_phone: lowConfidenceJinaResult.matched_phone,
                            signals: lowConfidenceJinaResult.signals,
                            reason_code: 'OK_CONFIRMED_VAT_MATCH',
                            final_url: currentUrl,
                        };
                        this.setCachedVerification(cacheKey, result);
                        return result;
                    }
                } catch (agentError) {
                    Logger.warn('[DeepVerify] Agent escalation from Jina low-confidence failed', {
                        error: agentError as Error,
                        url: normalizedUrl,
                        company_name: company.company_name,
                    });
                }
            }

            const currentUrl = this.normalizeUrl(page.url()) || normalizedUrl;
            if (ContentFilter.isDirectoryOrSocial(currentUrl)) {
                const result = {
                    confidence: 0,
                    reason: 'Redirected to directory/social',
                    reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                    final_url: currentUrl,
                };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            const extraction = await this.extractPageEvidence(page);
            if (ContentFilter.isDirectoryLikeTitle(extraction.title)) {
                const result = {
                    confidence: 0,
                    reason: 'Directory-like title',
                    reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                    final_url: currentUrl,
                };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // 🛡️ HONEYPOT CHECK
            const honeyPot = HoneyPotDetector.getInstance();
            const safety = honeyPot.analyzeContent(extraction.html);
            if (!safety.safe) {
                Logger.warn(`[DeepVerify] 🍯 Trap: ${normalizedUrl} -> ${safety.reason}`);
                const result = {
                    confidence: 0,
                    reason: safety.reason,
                    reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                    final_url: currentUrl,
                };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            // Content validation
            const filter = ContentFilter.isValidContent(extraction.text);
            if (!filter.valid) {
                const result = {
                    confidence: 0,
                    reason: filter.reason,
                    reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                    final_url: currentUrl,
                };
                this.setCachedVerification(cacheKey, result);
                return result;
            }

            let combinedText = extraction.text;
            let evaluation = CompanyMatcher.evaluate(company, currentUrl, combinedText, extraction.title);
            const schemaSignals = this.extractSchemaOrgSignals(extraction.html, company, currentUrl);
            if (schemaSignals.vatMatch) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.max(evaluation.confidence, 0.99),
                    scrapedVat: schemaSignals.foundVat || evaluation.scrapedVat,
                    reason: `${evaluation.reason}, schema.org vat match`,
                };
            } else if (schemaSignals.phoneMatch) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.min(0.99, evaluation.confidence + 0.1),
                    reason: `${evaluation.reason}, schema.org phone match`,
                };
            } else if (schemaSignals.urlMatch) {
                evaluation = {
                    ...evaluation,
                    confidence: Math.min(0.99, evaluation.confidence + 0.05),
                    reason: `${evaluation.reason}, schema.org url match`,
                };
            }

            const candidateLinks = this.collectEvidenceLinks(extraction.links, currentUrl);
            if (evaluation.confidence < THRESHOLDS.WAVE1_SWARM && candidateLinks.length > 0) {
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
                schema_signals: schemaSignals,
                reason_code: this.reasonCodeForVerification({
                    confidence: evaluation.confidence,
                    reason: evaluation.reason,
                    scraped_piva: evaluation.scrapedVat,
                    matched_phone: evaluation.matchedPhone,
                    schema_signals: schemaSignals,
                }),
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
            const failedResult = {
                confidence: 0,
                reason: (e as Error)?.message || 'Verification failed',
                reason_code: this.mapExceptionToReasonCode(e),
                final_url: normalizedUrl,
            };
            this.setCachedVerification(cacheKey, failedResult);
            return failedResult;
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
                return {
                    confidence: 0,
                    reason: 'Directory/social URL',
                    reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                    final_url: normalizedUrl,
                };
            }

            const filter = ContentFilter.isValidContent(text);
            if (!filter.valid) {
                return {
                    confidence: 0,
                    reason: filter.reason,
                    reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                    final_url: normalizedUrl,
                };
            }

            // Extract a pseudo-title from the first line of markdown
            const firstLine = text.split('\n').find(l => l.trim().length > 0) || '';
            const title = firstLine.replace(/^#+\s*/, '').trim();

            if (ContentFilter.isDirectoryLikeTitle(title)) {
                return {
                    confidence: 0,
                    reason: 'Directory-like title',
                    reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                    final_url: normalizedUrl,
                };
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

            // LLM boost if confidence is borderline (check all LLM provider keys, not just OpenAI)
            const hasAnyLLMKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY || process.env.Z_AI_API_KEY;
            if (evaluation.confidence < THRESHOLDS.WAVE3_JUDGE && hasAnyLLMKey) {
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
                reason_code: this.reasonCodeForVerification({
                    confidence: evaluation.confidence,
                    reason: evaluation.reason,
                    scraped_piva: evaluation.scrapedVat,
                    matched_phone: evaluation.matchedPhone,
                }),
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
                    return {
                        confidence: 0,
                        reason: 'Directory-like title',
                        reason_code: 'REJECTED_DIRECTORY_OR_SOCIAL',
                        final_url: currentUrl
                    };
                }

                const safety = HoneyPotDetector.getInstance().analyzeContent(html);
                if (!safety.safe) {
                    return {
                        confidence: 0,
                        reason: safety.reason,
                        reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                        final_url: currentUrl
                    };
                }

                const text = ($('body').text() || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
                const filter = ContentFilter.isValidContent(text);
                if (!filter.valid) {
                    return {
                        confidence: 0,
                        reason: filter.reason,
                        reason_code: 'REJECTED_NO_MATCHING_SIGNALS',
                        final_url: currentUrl
                    };
                }

                let evaluation = CompanyMatcher.evaluate(company, currentUrl, text, title);
                const schemaSignals = this.extractSchemaOrgSignals(html, company, currentUrl);
                if (schemaSignals.vatMatch) {
                    evaluation = {
                        ...evaluation,
                        confidence: Math.max(evaluation.confidence, 0.99),
                        scrapedVat: schemaSignals.foundVat || evaluation.scrapedVat,
                        reason: `${evaluation.reason}, schema.org vat match`,
                    };
                } else if (schemaSignals.phoneMatch) {
                    evaluation = {
                        ...evaluation,
                        confidence: Math.min(0.99, evaluation.confidence + 0.1),
                        reason: `${evaluation.reason}, schema.org phone match`,
                    };
                } else if (schemaSignals.urlMatch) {
                    evaluation = {
                        ...evaluation,
                        confidence: Math.min(0.99, evaluation.confidence + 0.05),
                        reason: `${evaluation.reason}, schema.org url match`,
                    };
                }
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
                    schema_signals: schemaSignals,
                    reason_code: this.reasonCodeForVerification({
                        confidence: evaluation.confidence,
                        reason: evaluation.reason,
                        scraped_piva: evaluation.scrapedVat,
                        matched_phone: evaluation.matchedPhone,
                        schema_signals: schemaSignals,
                    }),
                    final_url: currentUrl,
                };
            } catch {
                continue;
            }
        }

        return null;
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
            const html = document.documentElement?.outerHTML || document.body?.innerHTML || '';
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

    private buildVerificationCacheKey(url: string, company: CompanyInput): string {
        return `${url}|${company.company_name}|${company.vat_code || ''}`;
    }

    private getCachedVerification(key: string): any | null {
        const cached = this.verificationCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.verificationCacheTtlMs) {
            return cached.data;
        }
        return null;
    }

    private setCachedVerification(key: string, data: any): void {
        // Evict expired entries when approaching the size limit
        if (this.verificationCache.size >= this.verificationCacheMaxEntries) {
            const now = Date.now();
            for (const [k, v] of this.verificationCache) {
                if (now - v.timestamp > this.verificationCacheTtlMs) {
                    this.verificationCache.delete(k);
                }
            }
            // If still over limit, drop the oldest half (FIFO via Map insertion order)
            if (this.verificationCache.size >= this.verificationCacheMaxEntries) {
                const toDelete = Math.floor(this.verificationCache.size / 2);
                let deleted = 0;
                for (const k of this.verificationCache.keys()) {
                    if (deleted >= toDelete) break;
                    this.verificationCache.delete(k);
                    deleted++;
                }
            }
        }
        this.verificationCache.set(key, { data, timestamp: Date.now() });
    }

}
