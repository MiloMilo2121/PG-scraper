import { InputNormalizer, NormalizedInput } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
import { LLMOracleGuard } from './LLMOracleGuard';
import { StopTheBleedingController } from './StopTheBleedingController';
import { BackpressureValve } from './BackpressureValve';
import { BilancioHunter } from './BilancioHunter';
import { LinkedInSniper } from './LinkedInSniper';
import { BrowserPool } from './BrowserPool';
import { CostRouter } from './CostRouter';
import { EnrichmentPostProcessor } from './EnrichmentPostProcessor';
import { PecHunter } from './PecHunter';
import { HunterClient } from '../enricher/utils/hunter_client';
import { InputWebsiteCandidate } from './InputWebsiteCandidate';
import { FatturatoItaliaHarvester } from '../enricher/core/directories/fatturato_italia';
import { PagineGialleHarvester } from '../enricher/core/directories/paginegialle';
import { HyperGuesserVX } from '../enricher/core/discovery/hyperguesser_vx/hyper_guesser_vx';
import { RdapValidator } from '../enricher/core/discovery/rdap_validator';
import { ContentFilter } from '../enricher/core/discovery/content_filter';
import { PostDiscoveryEnrichmentStage } from '../enricher/runtime/stages/post_discovery_enrichment_stage';
import { RuntimeStageOutcome, RuntimeStageStatus } from '../enricher/runtime/stages/stage_types';
import crypto from 'crypto';

export class MasterPipeline {
    private normalizer: InputNormalizer;
    private registry: ShadowRegistry;
    private gate: PreVerifyGate;
    private dedup: SerpDeduplicator;
    private oracleGuard: LLMOracleGuard;
    private bleedingCtrl: StopTheBleedingController;
    private valve: BackpressureValve;
    private bilancioHunter: BilancioHunter;
    private linkedinSniper: LinkedInSniper;
    private browserPool: BrowserPool;
    private costRouter: CostRouter;
    private postProcessor: EnrichmentPostProcessor;
    private pecHunter: PecHunter;
    private postDiscoveryEnrichment: PostDiscoveryEnrichmentStage;

    private static readonly PUBLIC_EMAIL_PROVIDERS = new Set([
        'gmail.com', 'yahoo.com', 'hotmail.com', 'libero.it', 'alice.it', 'tim.it', 'tiscali.it', 'virgilio.it', 'pec.it'
    ]);

    constructor(deps: {
        normalizer: InputNormalizer,
        registry: ShadowRegistry,
        gate: PreVerifyGate,
        dedup: SerpDeduplicator,
        oracleGuard: LLMOracleGuard,
        bleedingCtrl: StopTheBleedingController,
        valve: BackpressureValve,
        bilancioHunter: BilancioHunter,
        linkedinSniper: LinkedInSniper,
        browserPool: BrowserPool,
        costRouter: CostRouter,
        postProcessor: EnrichmentPostProcessor,
        pecHunter: PecHunter,
        hunterClient?: HunterClient,
    }) {
        this.normalizer = deps.normalizer;
        this.registry = deps.registry;
        this.gate = deps.gate;
        this.dedup = deps.dedup;
        this.oracleGuard = deps.oracleGuard;
        this.bleedingCtrl = deps.bleedingCtrl;
        this.valve = deps.valve;
        this.bilancioHunter = deps.bilancioHunter;
        this.linkedinSniper = deps.linkedinSniper;
        this.browserPool = deps.browserPool;
        this.costRouter = deps.costRouter;
        this.postProcessor = deps.postProcessor;
        this.pecHunter = deps.pecHunter;
        this.postDiscoveryEnrichment = new PostDiscoveryEnrichmentStage({
            bilancioHunter: deps.bilancioHunter,
            linkedinSniper: deps.linkedinSniper,
            postProcessor: deps.postProcessor,
            pecHunter: deps.pecHunter,
            hunterClient: deps.hunterClient,
        });
    }

    public async processCompany(rawInput: Record<string, string>, companyIdx: number): Promise<any> {
        return this.valve.execute(async () => {
            const start = Date.now();
            const companyId = crypto.randomUUID();
            const layersAttempted: string[] = [];
            type CheckUrlOutcome = { matched: boolean; error?: string; timedOut: boolean };
            type CheckAttemptState = { expired: boolean; startedAt: number; timeoutMs: number };

            // Check Circuit Breaker
            const processedCompanies = Math.max(1, companyIdx + 1);
            const isBleeding = await this.bleedingCtrl.evaluateStatus(processedCompanies);

            // STAGE 0: Normalize Input
            const input = this.normalizer.normalize(rawInput);
            if (input.quality_score < 0.3) {
                const stageOutcomes = this.buildAbortedStageOutcomes('INPUT_QUALITY_TOO_LOW');
                return this.buildResult(
                    input,
                    'NOT_FOUND',
                    null,
                    '',
                    null,
                    null,
                    null,
                    false,
                    null,
                    null,
                    null,
                    stageOutcomes,
                    layersAttempted,
                    start,
                    'INPUT_QUALITY_TOO_LOW'
                );
            }

            // STAGE 1: ShadowRegistry Local Lookup
            layersAttempted.push('STAGE_1_SHADOW_REGISTRY');
            const regMatch = await this.registry.find(input);
            let piva = input.vat_code || regMatch?.piva;
            let discoveredUrl: string | null = null;
            let discoveryLayer = '';
            let inputWebsiteReasonCode: string | undefined;
            let phoneEntityReasonCode: string | undefined;

            // THE BEST LOSER TRACKER
            let bestLoser: { url: string; layer: string; score: number } | null = null;
            const checkedCandidateUrls = new Set<string>();
            const oracleSeedConfidenceByCanonical = new Map<string, { confidence: number; sources: Set<string> }>();
            const oracleSeedConfidenceByVariant = new Map<string, number>();
            const locationSignals = [input.city, input.provincia]
                .filter(Boolean)
                .map((value) => (value || '').toLowerCase());

            const remainingBudgetMs = (attemptState: CheckAttemptState, safetyBufferMs = 750): number =>
                Math.max(0, attemptState.timeoutMs - (Date.now() - attemptState.startedAt) - safetyBufferMs);

            const commitDiscovery = (attemptState: CheckAttemptState, url: string, layer: string): boolean => {
                if (attemptState.expired) {
                    return false;
                }

                discoveredUrl = url;
                discoveryLayer = layer;
                return true;
            };

            const normalizeOracleConfidence = (value: number): number =>
                Number(Math.max(0, Math.min(1, value)).toFixed(2));

            const recordOracleSeedCandidate = (rawCandidate: string | undefined, confidence: number, source: string): void => {
                const assessedCandidate = InputWebsiteCandidate.assess(rawCandidate);
                if (assessedCandidate.classification !== 'VALID') {
                    return;
                }

                const canonicalUrl = assessedCandidate.normalizedUrl || assessedCandidate.candidates[0];
                if (!canonicalUrl) {
                    return;
                }

                const normalizedConfidence = normalizeOracleConfidence(confidence);
                const existingCanonical = oracleSeedConfidenceByCanonical.get(canonicalUrl);
                if (existingCanonical) {
                    existingCanonical.confidence = Math.max(existingCanonical.confidence, normalizedConfidence);
                    existingCanonical.sources.add(source);
                } else {
                    oracleSeedConfidenceByCanonical.set(canonicalUrl, {
                        confidence: normalizedConfidence,
                        sources: new Set([source]),
                    });
                }

                for (const candidateUrl of assessedCandidate.candidates.slice(0, 6)) {
                    const existingConfidence = oracleSeedConfidenceByVariant.get(candidateUrl) ?? 0;
                    if (normalizedConfidence > existingConfidence) {
                        oracleSeedConfidenceByVariant.set(candidateUrl, normalizedConfidence);
                    }
                }
            };

            const estimateOracleSeedConfidence = (
                source: 'SERP_COMPANY' | 'SERP_PIVA_SNIPPET' | 'REGISTRY_EXTRACT',
                rank: number,
                title?: string,
                snippet?: string,
            ): number => {
                const haystack = `${title || ''} ${snippet || ''}`.toLowerCase();
                let score = source === 'SERP_PIVA_SNIPPET'
                    ? 0.42
                    : source === 'REGISTRY_EXTRACT'
                        ? 0.30
                        : 0.26;

                score -= rank * 0.04;

                if (/(contatti|chi siamo|azienda|about|privacy|partita iva|p\.?\s*iva|sito ufficiale)/i.test(haystack)) {
                    score += 0.05;
                }

                return normalizeOracleConfidence(score);
            };

            const getOracleSeedStats = (): { candidatesCount: number; highestConfidence: number } => {
                let highestConfidence = 0;
                for (const seed of oracleSeedConfidenceByCanonical.values()) {
                    highestConfidence = Math.max(highestConfidence, seed.confidence);
                }

                return {
                    candidatesCount: oracleSeedConfidenceByCanonical.size,
                    highestConfidence: normalizeOracleConfidence(highestConfidence),
                };
            };

            const getOracleCorroborationConfidence = (rawCandidate: string | undefined): number | null => {
                const assessedCandidate = InputWebsiteCandidate.assess(rawCandidate);
                if (assessedCandidate.classification !== 'VALID') {
                    return null;
                }

                let bestConfidence = 0;
                for (const candidateUrl of assessedCandidate.candidates.slice(0, 6)) {
                    bestConfidence = Math.max(bestConfidence, oracleSeedConfidenceByVariant.get(candidateUrl) ?? 0);
                }

                return bestConfidence > 0 ? normalizeOracleConfidence(bestConfidence) : null;
            };

            // In a perfect system, if Registry returns URL, we take it. 
            // Since ShadowRegistry only returns PIVA right now, we use that for later verification.

            // Helper for Ultimate Golden Match (now with semantic name matching)
            const companyNameForGate = input.company_name;
            const checkUrl = async (url: string, layerName: string, attemptState: CheckAttemptState): Promise<boolean> => {
                const isExtractableRegistry = ContentFilter.isExtractableRegistry(url);
                if (attemptState.expired || (!isExtractableRegistry && ContentFilter.isDirectoryOrSocial(url))) {
                    return false;
                }

                const gateStatus = await this.gate.check(url, piva, companyNameForGate);
                if (gateStatus === 'VERIFIED') {
                    return commitDiscovery(attemptState, url, layerName + '_PIVA_MATCH');
                } else if (gateStatus === 'VERIFIED_SEMANTIC') {
                    return commitDiscovery(attemptState, url, layerName + '_SEMANTIC');
                } else if (gateStatus === 'NEEDS_BROWSER') {
                    // The ultimate WAF bypass: Chromium loads it and we check HTML
                    let nav = await this.browserPool.navigateSafe(url);

                    // 🐍 OMEGA V9: If BrowserPool returned empty/blocked, escalate to Python Oracle (Crawl4AI)
                    const shouldTryOracle =
                        !attemptState.expired &&
                        (nav.status === 'BLOCKED' || nav.status === 'CF_CHALLENGE' || nav.status === 'TIMEOUT');
                    const oracleTimeoutMs = Math.min(15000, remainingBudgetMs(attemptState, 1000));

                    if (shouldTryOracle && oracleTimeoutMs >= 2500) {
                        try {
                            const { OracleClient } = require('../enricher/utils/oracle_client');
                            const oracleResult = await OracleClient.fetchHtmlStealth(url, oracleTimeoutMs);
                            if (!attemptState.expired && oracleResult.success && oracleResult.html && oracleResult.html.length > 500) {
                                console.log(`[MasterPipeline] 🐍 Oracle bypass succeeded for ${url}`);
                                nav = { status: 'OK' as const, html: oracleResult.html, finalUrl: url, blocked_resources: 0, duration_ms: 0, browser_id: 'oracle-crawl4ai' };
                            }
                        } catch (oracleErr: any) {
                            // Oracle offline or failed — silently continue with whatever nav we have
                            if (oracleErr.message !== 'PYTHON_ORACLE_OFFLINE') {
                                console.warn(`[MasterPipeline] Oracle fallback failed: ${oracleErr.message}`);
                            }
                        }
                    }

                    // 🌟 OMEGA V9.1: If Oracle failed/offline and we are still BLOCKED, fallback to Bright Data Web Unlocker API
                    const stillBlocked = nav.status === 'BLOCKED' || nav.status === 'CF_CHALLENGE' || nav.status === 'TIMEOUT';
                    if (stillBlocked && !attemptState.expired) {
                        const { ScraperClient } = require('../enricher/utils/scraper_client');
                        if (ScraperClient.isBrightDataEnabled()) {
                            console.log(`[MasterPipeline] 🛡️ Local bypasses failed. Escalating to Bright Data Web Unlocker API per ${url}...`);
                            try {
                                const bdResponse = await ScraperClient.fetchHtml(url, { mode: 'brightdata', timeoutMs: 30000 });
                                if (bdResponse.status >= 200 && bdResponse.status < 300 && bdResponse.data && bdResponse.data.length > 500) {
                                    console.log(`[MasterPipeline] 🌟 Bright Data Web Unlocker succeeded for ${url}`);
                                    nav = { status: 'OK' as const, html: bdResponse.data, finalUrl: bdResponse.finalUrl || url, blocked_resources: 0, duration_ms: 0, browser_id: 'brightdata-api' };
                                }
                            } catch (bdErr: any) {
                                console.warn(`[MasterPipeline] Bright Data Web Unlocker fallback failed: ${bdErr.message}`);
                            }
                        }
                    }
                    if (!attemptState.expired && nav.status === 'OK' && nav.html) {
                        
                        // 🌟 OMEGA V9.2: INLINE ENRICHMENT & PIVOT STRATEGY
                        if (isExtractableRegistry) {
                            console.log(`[MasterPipeline] 🕵️ Extracting opportunistic data from registry: ${url}`);
                            const { OpportunisticExtractor } = require('./OpportunisticExtractor');
                            const extracted = OpportunisticExtractor.extract(nav.html, url);
                            
                            if (extracted.financialData) {
                                console.log(`[MasterPipeline] 💰 Extracted inline financials: Fatturato ${extracted.financialData.fatturato_current}`);
                                (input as any).inline_financials = extracted.financialData;
                            }
                            
                            (input as any).inline_extra = {
                                pec: extracted.pec,
                                ateco: extracted.ateco,
                                dipendenti: extracted.dipendenti
                            };
                            
                            if (extracted.websiteUrl) {
                                console.log(`[MasterPipeline] 🔄 PIVOT! Registry points to: ${extracted.websiteUrl}`);
                                return await checkUrl(extracted.websiteUrl, layerName + '_PIVOT', attemptState);
                            }
                            
                            return false; // Registry is never the official website
                        }

                        // Try PIVA match first (for normal websites)
                        if (piva) {
                            const cleanPiva = piva.replace(/[^0-9]/g, '');
                            const bodyText = nav.html.replace(/[^0-9]/g, '');
                            if (bodyText.includes(cleanPiva)) {
                                return commitDiscovery(attemptState, url, layerName + '_WAF_PIVA');
                            } else {
                                // ASYNC DEEP-SCRAPING FALLBACK
                                // If PIVA is completely missing from Homepage, we spin up parallel workers to check legal pages.
                                const checkSubUrl = async (path: string): Promise<boolean> => {
                                    try {
                                        if (attemptState.expired) {
                                            return false;
                                        }
                                        const subUrl = url.replace(/\/$/, '') + path;
                                        const subNav = await this.browserPool.navigateSafe(subUrl);
                                        if (subNav.status === 'OK' && subNav.html && subNav.html.replace(/[^0-9]/g, '').includes(cleanPiva)) {
                                            console.log(`[MasterPipeline] 🕵️ P.IVA hidden on homepage, but FOUND on ${subUrl}`);
                                            return true;
                                        }
                                    } catch (e) {
                                        // Ignore sub-page errors
                                    }
                                    return false;
                                };

                                const deepResults = await Promise.all([
                                    checkSubUrl('/contatti'),
                                    checkSubUrl('/privacy')
                                ]);

                                if (deepResults.includes(true)) {
                                    return commitDiscovery(attemptState, url, layerName + '_WAF_PIVA_DEEP');
                                }
                            }
                        }
                        // Fallback: company name match in browser HTML
                        const htmlLower = nav.html.toLowerCase();
                        const strippedForBrowser = companyNameForGate
                            .toLowerCase()
                            .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|srl|snc|spa|sas|unipersonale|in liquidazione/gi, '')
                            .trim();
                        const allBrowserTokens = strippedForBrowser.split(/\s+/).filter(t => t.length >= 2);
                        // Use 4-char minimum unless company has very few tokens
                        const nameTokens = allBrowserTokens.length <= 2
                            ? allBrowserTokens.filter(t => t.length >= 3)
                            : allBrowserTokens.filter(t => t.length >= 4);
                        const matched = nameTokens.filter(t => htmlLower.includes(t));
                        // Also check <title> tag for stronger signal
                        const titleTagMatch = nav.html.match(/<title[^>]*>([^<]+)<\/title>/i);
                        const titleText = titleTagMatch ? titleTagMatch[1].toLowerCase() : '';
                        const titleMatched = nameTokens.filter(t => titleText.includes(t));
                        const bodyRatio = nameTokens.length > 0 ? matched.length / nameTokens.length : 0;
                        const titleRatio = nameTokens.length > 0 ? titleMatched.length / nameTokens.length : 0;
                        const hasLocationSignal = locationSignals.some((signal) => signal && htmlLower.includes(signal));

                        // Domain similarity check for Best Loser logic
                        let domainStr = '';
                        try { domainStr = new URL(url).hostname.replace('www.', '').split('.')[0].toLowerCase(); } catch { }
                        const compactName = strippedForBrowser.replace(/\s+/g, '');
                        const isHighDomainSim = compactName.length >= 4 && (domainStr.includes(compactName) || compactName.includes(domainStr));
                        const combinedScore = (bodyRatio * 0.6) + (titleRatio * 0.4);

                        // Only accept browser semantics when we also have a strong ownership anchor.
                        const hasOwnershipAnchor = isHighDomainSim || hasLocationSignal;
                        if (nameTokens.length > 0 && hasOwnershipAnchor && (bodyRatio >= 0.5 || (titleRatio >= 0.4 && bodyRatio >= 0.3))) {
                            if (!commitDiscovery(attemptState, url, layerName + '_WAF_SEMANTIC')) {
                                return false;
                            }
                            console.log(`[MasterPipeline] 🧠 Browser semantic match: body=${matched.join('+')}(${(bodyRatio * 100).toFixed(0)}%) title=${titleMatched.join('+')}(${(titleRatio * 100).toFixed(0)}%) for "${companyNameForGate}" on ${url}`);
                            return true;
                        } else if (nameTokens.length > 0 && isHighDomainSim && combinedScore > 0.1) {
                            if (!attemptState.expired && (!bestLoser || combinedScore > bestLoser.score)) {
                                bestLoser = { url, layer: layerName + '_BEST_LOSER', score: combinedScore };
                                console.log(`[MasterPipeline] 🥉 Potential BEST LOSER logged: ${url} (score ${combinedScore.toFixed(2)})`);
                            }
                        }
                    }
                }
                return false;
            };

            // Timeout wrapper: max 8 seconds per checkUrl attempt
            const checkUrlWithTimeout = async (
                url: string,
                layerName: string,
                options: { timeoutMs?: number } = {}
            ): Promise<CheckUrlOutcome> => {
                const timeoutMs = options.timeoutMs ?? 8000;
                const attemptState: CheckAttemptState = {
                    expired: false,
                    startedAt: Date.now(),
                    timeoutMs,
                };
                let timeoutHandle: NodeJS.Timeout | undefined;
                try {
                    console.log(`[MasterPipeline] ⚡ Checking: ${url} (${layerName}) for "${input.company_name}"`);
                    const result = await Promise.race([
                        checkUrl(url, layerName, attemptState),
                        new Promise<boolean>((_, reject) => {
                            timeoutHandle = setTimeout(() => {
                                attemptState.expired = true;
                                reject(new Error('CHECK_URL_TIMEOUT'));
                            }, timeoutMs);
                        })
                    ]);
                    if (result) {
                        console.log(`[MasterPipeline] ✅ FOUND: ${url} via ${discoveryLayer}`);
                    }
                    return { matched: result, timedOut: false };
                } catch (err: any) {
                    console.warn(`[MasterPipeline] ⏰ Timeout/Error checking ${url}: ${err.message}`);
                    return {
                        matched: false,
                        error: err.message,
                        timedOut: err.message === 'CHECK_URL_TIMEOUT'
                    };
                } finally {
                    attemptState.expired = true;
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                    }
                }
            };

            const checkCandidateVariants = async (
                rawCandidate: string | undefined,
                layerName: string,
                options: { timeoutMs?: number; maxCandidates?: number } = {}
            ): Promise<CheckUrlOutcome & { reasonCode?: string }> => {
                const assessedCandidate = InputWebsiteCandidate.assess(rawCandidate);
                if (assessedCandidate.classification !== 'VALID') {
                    return {
                        matched: false,
                        timedOut: false,
                        reasonCode: assessedCandidate.reasonCode,
                    };
                }

                let sawTimeout = false;
                let attempted = false;
                const candidateUrls = assessedCandidate.candidates.slice(0, options.maxCandidates ?? 6);

                for (const candidateUrl of candidateUrls) {
                    if (checkedCandidateUrls.has(candidateUrl)) {
                        continue;
                    }

                    checkedCandidateUrls.add(candidateUrl);
                    attempted = true;

                    const outcome = await checkUrlWithTimeout(candidateUrl, layerName, { timeoutMs: options.timeoutMs });
                    if (outcome.matched) {
                        return outcome;
                    }

                    sawTimeout = sawTimeout || outcome.timedOut;
                }

                return {
                    matched: false,
                    timedOut: attempted ? sawTimeout : false,
                    reasonCode: attempted ? undefined : 'CANDIDATE_ALREADY_CHECKED',
                };
            };

            // STAGE 1.5: Input Website Candidate
            if (!discoveredUrl && input.website) {
                layersAttempted.push('STAGE_1_5_INPUT_WEBSITE');

                const assessedWebsite = InputWebsiteCandidate.assess(input.website);
                if (assessedWebsite.classification !== 'VALID') {
                    inputWebsiteReasonCode = assessedWebsite.reasonCode;
                } else {
                    const outcome = await checkCandidateVariants(input.website, 'INPUT_WEBSITE', { timeoutMs: 15000 });
                    if (!discoveredUrl) {
                        inputWebsiteReasonCode = outcome.timedOut
                            ? 'INPUT_WEBSITE_TIMEOUT'
                            : 'INPUT_WEBSITE_NOT_VERIFIED';
                    }
                }
            }

            // STAGE 1.6: Exact Phone/Entity Candidate via PagineGialle
            if (!discoveredUrl && (input.phone || rawInput['pg_url'])) {
                layersAttempted.push('STAGE_1_6_PHONE_ENTITY');

                const harvest = await PagineGialleHarvester.harvestByPhone({
                    ...input,
                    pg_url: rawInput['pg_url'],
                } as any);

                if (harvest?.vat && !piva) {
                    const harvestedVat = harvest.vat.replace(/\D/g, '');
                    if (harvestedVat.length === 11) {
                        piva = harvestedVat;
                    }
                }

                if (harvest?.email && !input.email) {
                    const pgEmail = harvest.email.trim().toLowerCase();
                    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pgEmail)) {
                        input.email = pgEmail;
                        input.email_source = 'paginegialle';
                        const domain = pgEmail.split('@')[1] || '';
                        const isPec = domain.includes('pec') || domain.includes('legalmail') || domain.includes('cert');
                        if (domain && !isPec && !MasterPipeline.PUBLIC_EMAIL_PROVIDERS.has(domain)) {
                            input.email_domain = domain;
                        }
                    }
                }

                if (harvest?.officialWebsite) {
                    const assessedWebsite = InputWebsiteCandidate.assess(harvest.officialWebsite);

                    if (assessedWebsite.classification !== 'VALID') {
                        phoneEntityReasonCode =
                            MasterPipeline.toPhoneEntityReasonCode(assessedWebsite.reasonCode) ||
                            'PHONE_ENTITY_OFFICIAL_WEBSITE_REJECTED';
                    } else {
                        const outcome = await checkCandidateVariants(harvest.officialWebsite, 'PG_PHONE', { timeoutMs: 15000 });
                        if (!discoveredUrl && (harvest.matchedBy === 'phone' || harvest.pgUrl || rawInput['pg_url'])) {
                            discoveredUrl = assessedWebsite.normalizedUrl || harvest.officialWebsite;
                            discoveryLayer = 'PG_PHONE_SOURCE_TRUST';
                        } else if (!discoveredUrl) {
                            phoneEntityReasonCode = outcome.timedOut
                                ? 'PHONE_ENTITY_TIMEOUT'
                                : 'PHONE_ENTITY_NOT_VERIFIED';
                        }
                    }
                } else if (harvest?.pgUrl) {
                    phoneEntityReasonCode = 'PHONE_ENTITY_DIRECTORY_ONLY';
                }
            }

            // STAGE 2: Email Domain Candidate
            if (!discoveredUrl) {
                layersAttempted.push('STAGE_2_EMAIL_DOMAIN');
                if (input.email_domain) {
                    await checkCandidateVariants(input.email_domain, 'EMAIL_DOMAIN', {
                        timeoutMs: 12000,
                        maxCandidates: 6,
                    });
                }
            }

            // STAGE 3: Hyper Guesser VX (Massive Generation + DNS Ping + AI Triage)
            if (!discoveredUrl) {
                layersAttempted.push('STAGE_3_HYPER_GUESSER_VX');

                try {
                    const vxResult = await HyperGuesserVX.blast({
                        company_name: input.company_name,
                        city: input.city,
                        province: input.provincia || '',
                        category: (rawInput as any).category || ''
                    });

                    if (vxResult && vxResult.status === 'FOUND_VALID' && vxResult.url) {
                        // The VX protocol already performs deep AI triage, we accept its output
                        discoveredUrl = vxResult.url;
                        discoveryLayer = 'HYPER_GUESSER_VX';
                        console.log(`[MasterPipeline] ✅ FOUND via VX Protocol: ${discoveredUrl}`);
                    }
                } catch (err: any) {
                    console.warn(`[MasterPipeline] ⚠️ HyperGuesserVX error: ${err.message}`);
                }
            }

            // STAGE 4: SERP Company Search
            if (!discoveredUrl) {
                layersAttempted.push('STAGE_4_SERP_COMPANY');
                const serpRes = await this.dedup.search(companyId, input, 'company', { maxTier: isBleeding ? 2 : undefined, piva });

                console.log(`[MasterPipeline] 🔎 SERP returned ${serpRes.results.length} candidates for "${input.company_name}" (providers: ${serpRes.providers_used.join(',')})`);

                // PRE-FILTER: Extract P.IVA from SERP snippets to boost verification
                // Many SERP results contain "P.IVA 01234567890" in the snippet text
                if (piva) {
                    const cleanPiva = piva.replace(/[^0-9]/g, '');
                    for (const cand of serpRes.results) {
                        const snippetDigits = (cand.snippet + ' ' + cand.title).replace(/[^0-9]/g, ' ');
                        if (snippetDigits.includes(cleanPiva)) {
                            console.log(`[MasterPipeline] 🎯 P.IVA found in SERP snippet for ${cand.url} — fast-tracking verification`);
                            const outcome = await checkCandidateVariants(cand.url, 'SERP_PIVA_SNIPPET', {
                                timeoutMs: 12000,
                                maxCandidates: 5,
                            });
                            if (!outcome.matched) {
                                recordOracleSeedCandidate(
                                    cand.url,
                                    estimateOracleSeedConfidence('SERP_PIVA_SNIPPET', 0, cand.title, cand.snippet),
                                    'SERP_PIVA_SNIPPET',
                                );
                            }
                            if (outcome.matched) break;
                        }
                    }
                }

                // Check a slightly wider top set now that results are ranked and deduped more aggressively.
                if (!discoveredUrl) {
                    const topCandidates = serpRes.results.slice(0, 5);
                    for (const [index, cand] of topCandidates.entries()) {
                        const outcome = await checkCandidateVariants(cand.url, 'SERP_COMPANY', {
                            timeoutMs: 12000,
                            maxCandidates: 5,
                        });
                        if (!outcome.matched) {
                            recordOracleSeedCandidate(
                                cand.url,
                                estimateOracleSeedConfidence('SERP_COMPANY', index, cand.title, cand.snippet),
                                'SERP_COMPANY',
                            );
                        }
                        if (outcome.matched) break;
                    }
                }

                // STAGE 4B: RDAP WHOIS VERIFICATION ON UNVERIFIED TOP CANDIDATES
                if (!discoveredUrl && serpRes.results.length > 0) {
                    layersAttempted.push('STAGE_4B_RDAP_VALIDATION');
                    const rdapCompany = { ...input, piva: piva || input.vat_code } as any;
                    for (const cand of serpRes.results.slice(0, 3)) {
                        const assessedCandidate = InputWebsiteCandidate.assess(cand.url);
                        const rdapTargets = assessedCandidate.classification === 'VALID'
                            ? assessedCandidate.candidates.slice(0, 3)
                            : [cand.url];

                        for (const rdapTarget of rdapTargets) {
                            const rdapScore = await RdapValidator.checkDomainOwnership(rdapTarget, rdapCompany);
                            if (rdapScore >= 0.8) {
                                discoveredUrl = rdapTarget;
                                discoveryLayer = 'SERP_RDAP_BINGO';
                                console.log(`[MasterPipeline] 🎯 RDAP WHOIS BINGO! Found exact identity in domain registry for: ${discoveredUrl}`);
                                break;
                            }
                        }

                        if (discoveredUrl) {
                            break;
                        }
                    }
                }

                // STAGE 5: SERP Registry Search
                if (!discoveredUrl && !isBleeding) {
                    layersAttempted.push('STAGE_5_SERP_REGISTRY');
                    const regSerpRes = await this.dedup.search(companyId, input, 'registry', { maxTier: 2 });
                    if (regSerpRes.results.length > 0) {
                        for (const [index, regResult] of regSerpRes.results.slice(0, 3).entries()) {
                            const extractedCandidates = MasterPipeline.extractWebsiteCandidatesFromText(
                                `${regResult.title || ''} ${regResult.snippet || ''}`
                            );

                            for (const extractedCandidate of extractedCandidates) {
                                const outcome = await checkCandidateVariants(extractedCandidate, 'REGISTRY_EXTRACT', {
                                    timeoutMs: 12000,
                                    maxCandidates: 5,
                                });
                                if (!outcome.matched) {
                                    recordOracleSeedCandidate(
                                        extractedCandidate,
                                        estimateOracleSeedConfidence('REGISTRY_EXTRACT', index, regResult.title, regResult.snippet),
                                        'REGISTRY_EXTRACT',
                                    );
                                }
                                if (outcome.matched) break;
                            }

                            if (discoveredUrl) {
                                break;
                            }
                        }
                    }
                }
            }

            // ===== BEST LOSER RESCUE =====
            if (!discoveredUrl && bestLoser) {
                const loser = bestLoser as { url: string; layer: string; score: number };

                // 🌐 Try RDAP validation before fully accepting a weak loser
                const rdapScore = await RdapValidator.checkDomainOwnership(loser.url, {
                    ...input,
                    piva: piva || input.vat_code,
                } as any);
                if (rdapScore >= 0.8) {
                    discoveredUrl = loser.url;
                    discoveryLayer = loser.layer + '_RDAP_BINGO';
                    console.log(`[MasterPipeline] 🎯 BEST LOSER VERIFIED VIA RDAP WHOIS: ${discoveredUrl}`);
                } else if (loser.score > 0.15) {
                    discoveredUrl = loser.url;
                    discoveryLayer = loser.layer;
                    console.log(`[MasterPipeline] 🦅 RESCUING BEST LOSER candidate for "${input.company_name}": ${discoveredUrl} (score: ${loser.score.toFixed(2)})`);
                }
            }

            // ===== STAGE 6: LLM ORACLE VERIFICATION =====
            // If SERP found candidates but regex PIVA/Semantic matching failed,
            // ask an LLM to semantically verify the best URL candidate.
            if (!discoveredUrl && !isBleeding) {
                const oracleSeedStats = getOracleSeedStats();
                const guardResult = await this.oracleGuard.evaluate(companyId, {
                    candidates_count: oracleSeedStats.candidatesCount,
                    highest_confidence: oracleSeedStats.highestConfidence,
                    has_piva: !!piva,
                    has_rs: !!input.company_name,
                    has_address: !!(input.city || input.address),
                    has_phone: !!(rawInput['phone'] || input.phone),
                    bleeding_mode: isBleeding
                });

                if (guardResult === 'ORACLE_APPROVED') {
                    layersAttempted.push('STAGE_6_LLM_ORACLE');
                    try {
                        // Ask CostRouter to use LLM (Tier 3-8) to search for this company
                        const searchQuery = [
                            input.company_name,
                            input.city || '',
                            piva ? `P.IVA ${piva}` : '',
                            'sito web ufficiale',
                        ].filter(Boolean).join(' ');
                        const llmResult = await this.costRouter.route<Array<{ title: string; url: string; snippet: string }>>(
                            'SERP',
                            { query: searchQuery },
                            { companyId, maxTier: 8 }
                        );

                        if (llmResult.data && Array.isArray(llmResult.data) && llmResult.data.length > 0) {
                            console.log(`[LLM_ORACLE] Provider ${llmResult.provider} returned ${llmResult.data.length} candidates for "${input.company_name}"`);
                            for (const llmCand of llmResult.data) {
                                if (llmCand.url) {
                                    const corroboratedConfidence = getOracleCorroborationConfidence(llmCand.url);
                                    if (corroboratedConfidence === null) {
                                        console.log(`[LLM_ORACLE] Skipping non-corroborated candidate: ${llmCand.url}`);
                                        continue;
                                    }

                                    const found = await checkCandidateVariants(llmCand.url, 'LLM_ORACLE', {
                                        timeoutMs: 12000,
                                        maxCandidates: 5,
                                    });
                                    if (found.matched) break;

                                    // Only accept semantic Oracle candidates when they corroborate an already-observed
                                    // deterministic seed; provider tier alone is not enough evidence.
                                    if (!discoveredUrl && corroboratedConfidence >= 0.28) {
                                        const assessedCandidate = InputWebsiteCandidate.assess(llmCand.url);
                                        if (assessedCandidate.classification === 'VALID') {
                                            discoveredUrl = assessedCandidate.normalizedUrl || llmCand.url;
                                            discoveryLayer = 'LLM_ORACLE_SEMANTIC';
                                            console.log(`[LLM_ORACLE] Corroborated semantic accept: ${discoveredUrl} for "${input.company_name}" (provider: ${llmResult.provider}, seed_confidence: ${corroboratedConfidence})`);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (err: any) {
                        console.warn(`[LLM_ORACLE] Failed for ${input.company_name}: ${err.message}`);
                    }
                }
            }

            const enrichment = await this.postDiscoveryEnrichment.run(companyId, input, discoveredUrl);
            const financial = enrichment.financial;
            const decisionMaker = enrichment.decisionMaker;
            const employees = enrichment.employees;
            const isEstimatedEmployees = enrichment.isEstimatedEmployees;
            const pec = enrichment.pec;
            const email = enrichment.email;

            if (enrichment.vat && !piva) {
                piva = enrichment.vat;
            }

            const hasEnrichmentSignals = Boolean(
                piva
                || financial?.fatturato_current
                || financial?.fatturato_previous
                || financial?.utile_netto
                || employees
                || pec
                || email
                || decisionMaker?.name
            );
            const status = discoveredUrl
                ? 'FOUND_COMPLETE'
                : hasEnrichmentSignals
                    ? 'ENRICHMENT_ONLY_NO_WEBSITE'
                    : 'NOT_FOUND';
            const didAttemptSerp = layersAttempted.includes('STAGE_4_SERP_COMPANY') || layersAttempted.includes('STAGE_5_SERP_REGISTRY') || layersAttempted.includes('STAGE_6_LLM_ORACLE');
            const laneReasonCode = phoneEntityReasonCode || inputWebsiteReasonCode;

            const reasonCode = discoveredUrl
                ? 'FOUND_COMPLETE'
                : hasEnrichmentSignals
                    ? 'ENRICHMENT_ONLY_NO_WEBSITE'
                : laneReasonCode
                    ? laneReasonCode
                    : didAttemptSerp
                        ? (isBleeding ? 'DISCOVERY_EXHAUSTED_BLEEDING_MODE' : 'DISCOVERY_EXHAUSTED')
                        : (isBleeding ? 'DISCOVERY_EXHAUSTED_BLEEDING_MODE' : 'DISCOVERY_EXHAUSTED');
            const stageOutcomes = {
                website_discovery: this.buildWebsiteDiscoveryOutcome(discoveredUrl, discoveryLayer, reasonCode),
                ...enrichment.stageOutcomes,
            };

            return this.buildResult(
                input,
                status,
                discoveredUrl,
                discoveryLayer,
                financial,
                decisionMaker,
                employees,
                isEstimatedEmployees,
                piva,
                pec,
                email,
                stageOutcomes,
                layersAttempted,
                start,
                reasonCode
            );
        }, 1); // Priority 1 (Core Pipeline)
    }

    private buildResult(
        input: NormalizedInput,
        status: string,
        url: string | null,
        discoveryLayer: string,
        fin: any,
        dm: any,
        employees: any,
        isEstimatedEmployees: boolean,
        vat: string | null | undefined,
        pec: any,
        email: any,
        stageOutcomes: Record<string, RuntimeStageOutcome>,
        layers: string[],
        start: number,
        reasonCode: string
    ) {
        // Dynamic confidence based on discovery method
        let confidence = 0.95; // PIVA match default
        if (discoveryLayer.includes('SEMANTIC')) confidence = 0.80;
        if (discoveryLayer.includes('LLM_ORACLE_SEMANTIC')) confidence = 0.75;

        return {
            input: {
                company_name: input.company_name,
                city: input.city,
                normalized_name: input.company_name_variants[0] || input.company_name,
            },
            website: url ? {
                url,
                confidence,
                discovery_layer: discoveryLayer || layers[layers.length - 1]
            } : undefined,
            vat: vat || undefined,
            pec: pec || undefined,
            email: email || undefined,
            employees: employees || undefined,
            is_estimated_employees: employees ? isEstimatedEmployees : undefined,
            financial: fin || undefined,
            decision_maker: dm || undefined,
            meta: {
                duration_ms: Date.now() - start,
                layers_attempted: layers,
                stage_outcomes: stageOutcomes,
                timestamp: new Date().toISOString()
            },
            reason_code: reasonCode,
            status
        };
    }

    private buildWebsiteDiscoveryOutcome(
        discoveredUrl: string | null,
        discoveryLayer: string,
        reasonCode: string,
        status: RuntimeStageStatus = discoveredUrl ? 'success' : 'not_found'
    ): RuntimeStageOutcome {
        return {
            stage: 'website_discovery',
            status,
            duration_ms: 0,
            detail: discoveredUrl ? discoveryLayer : reasonCode,
            reason_code: discoveredUrl ? 'WEBSITE_FOUND' : reasonCode,
            confidence: discoveredUrl ? (discoveryLayer.includes('LLM_ORACLE_SEMANTIC') ? 0.75 : discoveryLayer.includes('SEMANTIC') ? 0.8 : 0.95) : 0,
            source_url: discoveredUrl || undefined,
            evidence_count: discoveredUrl ? 1 : 0,
            entity_match_status: discoveredUrl ? (discoveryLayer.includes('SEMANTIC') ? 'semantic' : 'matched') : 'unknown',
        };
    }

    private buildAbortedStageOutcomes(reasonCode: string): Record<string, RuntimeStageOutcome> {
        return {
            website_discovery: this.buildWebsiteDiscoveryOutcome(null, '', reasonCode, 'skipped'),
            financial: this.buildSkippedStageOutcome('financial', reasonCode),
            decision_maker: this.buildSkippedStageOutcome('decision_maker', reasonCode),
            employee_estimation: this.buildSkippedStageOutcome('employee_estimation', reasonCode),
            contacts: this.buildSkippedStageOutcome('contacts', reasonCode),
        };
    }

    private buildSkippedStageOutcome(stage: string, detail: string): RuntimeStageOutcome {
        return {
            stage,
            status: 'skipped',
            duration_ms: 0,
            detail,
            reason_code: detail,
        };
    }

    private static toPhoneEntityReasonCode(reasonCode?: string): string | undefined {
        if (!reasonCode) {
            return undefined;
        }

        if (reasonCode.startsWith('INPUT_WEBSITE_')) {
            return reasonCode.replace(/^INPUT_WEBSITE_/, 'PHONE_ENTITY_');
        }

        return `PHONE_ENTITY_${reasonCode}`;
    }

    private static extractWebsiteCandidatesFromText(text: string): string[] {
        const candidates: string[] = [];
        const seen = new Set<string>();
        const rawText = text || '';

        const pushCandidate = (value?: string) => {
            if (!value) {
                return;
            }

            const cleanedValue = value
                .trim()
                .replace(/^www\./i, '')
                .replace(/[),;:]+$/g, '');

            const assessedCandidate = InputWebsiteCandidate.assess(cleanedValue);
            if (assessedCandidate.classification !== 'VALID' || !assessedCandidate.normalizedUrl) {
                return;
            }

            if (seen.has(assessedCandidate.normalizedUrl)) {
                return;
            }

            seen.add(assessedCandidate.normalizedUrl);
            candidates.push(assessedCandidate.normalizedUrl);
        };

        const emailRegex = /\b[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})\b/gi;
        for (const match of rawText.matchAll(emailRegex)) {
            pushCandidate(match[1]);
        }

        const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/gi;
        for (const match of rawText.matchAll(domainRegex)) {
            pushCandidate(match[1]);
        }

        return candidates;
    }
}
