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
import { InputWebsiteCandidate } from './InputWebsiteCandidate';
import { FatturatoItaliaHarvester } from '../enricher/core/directories/fatturato_italia';
import { PagineGialleHarvester } from '../enricher/core/directories/paginegialle';
import { HyperGuesserVX } from '../enricher/core/discovery/hyperguesser_vx/hyper_guesser_vx';
import { RdapValidator } from '../enricher/core/discovery/rdap_validator';
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
        pecHunter: PecHunter
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
        });
    }

    public async processCompany(rawInput: Record<string, string>, companyIdx: number): Promise<any> {
        return this.valve.execute(async () => {
            const start = Date.now();
            const companyId = crypto.randomUUID();
            const layersAttempted: string[] = [];
            type CheckUrlOutcome = { matched: boolean; error?: string; timedOut: boolean };

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

            // In a perfect system, if Registry returns URL, we take it. 
            // Since ShadowRegistry only returns PIVA right now, we use that for later verification.

            // Helper for Ultimate Golden Match (now with semantic name matching)
            const companyNameForGate = input.company_name;
            const checkUrl = async (url: string, layerName: string): Promise<boolean> => {
                const gateStatus = await this.gate.check(url, piva, companyNameForGate);
                if (gateStatus === 'VERIFIED') {
                    discoveredUrl = url;
                    discoveryLayer = layerName + '_PIVA_MATCH';
                    return true;
                } else if (gateStatus === 'VERIFIED_SEMANTIC') {
                    discoveredUrl = url;
                    discoveryLayer = layerName + '_SEMANTIC';
                    return true;
                } else if (gateStatus === 'NEEDS_BROWSER') {
                    // The ultimate WAF bypass: Chromium loads it and we check HTML
                    let nav = await this.browserPool.navigateSafe(url);

                    // 🐍 OMEGA V9: If BrowserPool returned empty/blocked, escalate to Python Oracle (Crawl4AI)
                    if (nav.status !== 'OK' || !nav.html || nav.html.length < 500) {
                        try {
                            const { OracleClient } = require('../enricher/utils/oracle_client');
                            const oracleResult = await OracleClient.fetchHtmlStealth(url, 45000);
                            if (oracleResult.success && oracleResult.html && oracleResult.html.length > 500) {
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
                    if (nav.status === 'OK' && nav.html) {
                        // Try PIVA match first
                        if (piva) {
                            const cleanPiva = piva.replace(/[^0-9]/g, '');
                            const bodyText = nav.html.replace(/[^0-9]/g, '');
                            if (bodyText.includes(cleanPiva)) {
                                discoveredUrl = url;
                                discoveryLayer = layerName + '_WAF_PIVA';
                                return true;
                            } else {
                                // ASYNC DEEP-SCRAPING FALLBACK
                                // If PIVA is completely missing from Homepage, we spin up parallel workers to check legal pages.
                                const checkSubUrl = async (path: string): Promise<boolean> => {
                                    try {
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
                                    discoveredUrl = url;
                                    discoveryLayer = layerName + '_WAF_PIVA_DEEP';
                                    return true;
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

                        // Domain similarity check for Best Loser logic
                        let domainStr = '';
                        try { domainStr = new URL(url).hostname.replace('www.', '').split('.')[0].toLowerCase(); } catch { }
                        const compactName = strippedForBrowser.replace(/\s+/g, '');
                        const isHighDomainSim = compactName.length >= 4 && (domainStr.includes(compactName) || compactName.includes(domainStr));
                        const combinedScore = (bodyRatio * 0.6) + (titleRatio * 0.4);

                        // Accept if body match >= 0.5 OR title match >= 0.4 with some body overlap
                        if (nameTokens.length > 0 && (bodyRatio >= 0.5 || (titleRatio >= 0.4 && bodyRatio >= 0.3))) {
                            discoveredUrl = url;
                            discoveryLayer = layerName + '_WAF_SEMANTIC';
                            console.log(`[MasterPipeline] 🧠 Browser semantic match: body=${matched.join('+')}(${(bodyRatio * 100).toFixed(0)}%) title=${titleMatched.join('+')}(${(titleRatio * 100).toFixed(0)}%) for "${companyNameForGate}" on ${url}`);
                            return true;
                        } else if (nameTokens.length > 0 && isHighDomainSim && combinedScore > 0.1) {
                            if (!bestLoser || combinedScore > bestLoser.score) {
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
                try {
                    console.log(`[MasterPipeline] ⚡ Checking: ${url} (${layerName}) for "${input.company_name}"`);
                    const result = await Promise.race([
                        checkUrl(url, layerName),
                        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('CHECK_URL_TIMEOUT')), timeoutMs))
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
                }
            };

            // STAGE 1.5: Input Website Candidate
            if (!discoveredUrl && input.website) {
                layersAttempted.push('STAGE_1_5_INPUT_WEBSITE');

                const assessedWebsite = InputWebsiteCandidate.assess(input.website);
                if (assessedWebsite.classification !== 'VALID') {
                    inputWebsiteReasonCode = assessedWebsite.reasonCode;
                } else {
                    let sawTimeout = false;
                    for (const candidateUrl of assessedWebsite.candidates) {
                        const outcome = await checkUrlWithTimeout(candidateUrl, 'INPUT_WEBSITE', { timeoutMs: 15000 });
                        if (outcome.matched) {
                            break;
                        }
                        sawTimeout = sawTimeout || outcome.timedOut;
                    }

                    if (!discoveredUrl) {
                        inputWebsiteReasonCode = sawTimeout
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

                if (harvest?.officialWebsite) {
                    const assessedWebsite = InputWebsiteCandidate.assess(harvest.officialWebsite);

                    if (assessedWebsite.classification !== 'VALID') {
                        phoneEntityReasonCode =
                            MasterPipeline.toPhoneEntityReasonCode(assessedWebsite.reasonCode) ||
                            'PHONE_ENTITY_OFFICIAL_WEBSITE_REJECTED';
                    } else {
                        let sawTimeout = false;
                        for (const candidateUrl of assessedWebsite.candidates) {
                            const outcome = await checkUrlWithTimeout(candidateUrl, 'PG_PHONE', { timeoutMs: 15000 });
                            if (outcome.matched) {
                                break;
                            }
                            sawTimeout = sawTimeout || outcome.timedOut;
                        }

                        if (!discoveredUrl) {
                            phoneEntityReasonCode = sawTimeout
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
                    const candidateUrl = `https://www.${input.email_domain}`;
                    await checkUrlWithTimeout(candidateUrl, 'EMAIL_DOMAIN');
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
                            const outcome = await checkUrlWithTimeout(cand.url, 'SERP_PIVA_SNIPPET');
                            if (outcome.matched) break;
                        }
                    }
                }

                // Only check top 3 candidates to avoid timeout cascade
                if (!discoveredUrl) {
                    const topCandidates = serpRes.results.slice(0, 3);
                    for (const cand of topCandidates) {
                        const outcome = await checkUrlWithTimeout(cand.url, 'SERP_COMPANY');
                        if (outcome.matched) break;
                    }
                }

                // STAGE 4B: RDAP WHOIS VERIFICATION ON UNVERIFIED TOP CANDIDATES
                if (!discoveredUrl && serpRes.results.length > 0) {
                    layersAttempted.push('STAGE_4B_RDAP_VALIDATION');
                    for (const cand of serpRes.results.slice(0, 2)) {
                        const rdapScore = await RdapValidator.checkDomainOwnership(cand.url, input as any);
                        if (rdapScore >= 0.8) {
                            discoveredUrl = cand.url;
                            discoveryLayer = 'SERP_RDAP_BINGO';
                            console.log(`[MasterPipeline] 🎯 RDAP WHOIS BINGO! Found exact identity in domain registry for: ${discoveredUrl}`);
                            break;
                        }
                    }
                }

                // STAGE 5: SERP Registry Search
                if (!discoveredUrl && !isBleeding) {
                    layersAttempted.push('STAGE_5_SERP_REGISTRY');
                    const regSerpRes = await this.dedup.search(companyId, input, 'registry', { maxTier: 2 });
                    if (regSerpRes.results.length > 0) {
                        // Extract website URLs from registry page snippets
                        // Registry pages (registroimprese.it, informazione-aziende.it) often contain
                        // the company's official website in their listings
                        for (const regResult of regSerpRes.results.slice(0, 3)) {
                            // Try to extract a website URL from the snippet
                            const urlMatch = regResult.snippet.match(/(?:sito|web|website|www)[:\s]*(?:https?:\/\/)?([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+)/i);
                            if (urlMatch) {
                                const extractedDomain = urlMatch[1].replace(/^www\./i, '');
                                const candidateUrl = `https://www.${extractedDomain}`;
                                const outcome = await checkUrlWithTimeout(candidateUrl, 'REGISTRY_EXTRACT', { timeoutMs: 12000 });
                                if (outcome.matched) break;
                            }
                            // Also check if the registry page itself can be fetched for website info
                            // by looking at the title for domain clues
                            const titleDomainMatch = regResult.title.match(/([a-z0-9][-a-z0-9]+\.(?:it|com|eu|net|org))/i);
                            if (titleDomainMatch && !regResult.domain.includes(titleDomainMatch[1])) {
                                const candidateUrl = `https://www.${titleDomainMatch[1]}`;
                                const outcome = await checkUrlWithTimeout(candidateUrl, 'REGISTRY_TITLE', { timeoutMs: 12000 });
                                if (outcome.matched) break;
                            }
                        }
                    }
                }
            }

            // ===== BEST LOSER RESCUE =====
            if (!discoveredUrl && bestLoser) {
                const loser = bestLoser as { url: string; layer: string; score: number };

                // 🌐 Try RDAP validation before fully accepting a weak loser
                const rdapScore = await RdapValidator.checkDomainOwnership(loser.url, input as any);
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
                const guardResult = await this.oracleGuard.evaluate(companyId, {
                    candidates_count: 0,  // 0 = deterministic layers found nothing
                    highest_confidence: 0,
                    has_piva: !!piva,
                    has_rs: true,
                    has_address: !!input.city,
                    has_phone: !!rawInput['phone'],
                    bleeding_mode: isBleeding
                });

                if (guardResult === 'ORACLE_APPROVED') {
                    layersAttempted.push('STAGE_6_LLM_ORACLE');
                    try {
                        // Ask CostRouter to use LLM (Tier 3-8) to search for this company
                        const searchQuery = `${input.company_name} ${input.city || ''} sito web ufficiale`;
                        const llmResult = await this.costRouter.route<Array<{ title: string; url: string; snippet: string }>>(
                            'SERP',
                            { query: searchQuery },
                            { companyId, maxTier: 8 }
                        );

                        if (llmResult.data && Array.isArray(llmResult.data) && llmResult.data.length > 0) {
                            console.log(`[LLM_ORACLE] Provider ${llmResult.provider} returned ${llmResult.data.length} candidates for "${input.company_name}"`);
                            for (const llmCand of llmResult.data) {
                                if (llmCand.url) {
                                    // Try the Gate verification on LLM-suggested URLs
                                    const found = await checkUrl(llmCand.url, 'LLM_ORACLE');
                                    if (found) break;
                                    // If Gate fails but we trust the LLM (Tier 3+), accept with lower confidence
                                    if (!discoveredUrl && llmResult.tier >= 3) {
                                        discoveredUrl = llmCand.url;
                                        discoveryLayer = 'LLM_ORACLE_SEMANTIC';
                                        console.log(`[LLM_ORACLE] Semantic accept: ${llmCand.url} for "${input.company_name}" (provider: ${llmResult.provider})`);
                                        break;
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

            const status = discoveredUrl ? 'FOUND_COMPLETE' : 'NOT_FOUND';
            const didAttemptSerp = layersAttempted.includes('STAGE_4_SERP_COMPANY') || layersAttempted.includes('STAGE_5_SERP_REGISTRY') || layersAttempted.includes('STAGE_6_LLM_ORACLE');
            const laneReasonCode = phoneEntityReasonCode || inputWebsiteReasonCode;

            const reasonCode = discoveredUrl
                ? 'FOUND_COMPLETE'
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
}
