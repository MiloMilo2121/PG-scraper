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
import { FatturatoItaliaHarvester } from '../enricher/core/directories/fatturato_italia';
import { HyperGuesserVX } from '../enricher/core/discovery/hyperguesser_vx/hyper_guesser_vx';
import { RdapValidator } from '../enricher/core/discovery/rdap_validator';
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
    }

    public async processCompany(rawInput: Record<string, string>, companyIdx: number): Promise<any> {
        return this.valve.execute(async () => {
            const start = Date.now();
            const companyId = crypto.randomUUID();
            const layersAttempted: string[] = [];

            // Check Circuit Breaker
            const isBleeding = await this.bleedingCtrl.evaluateStatus(companyIdx);

            // STAGE 0: Normalize Input
            const input = this.normalizer.normalize(rawInput);
            if (input.quality_score < 0.3) {
                return this.buildResult(input, 'NOT_FOUND', null, '', null, null, null, null, null, layersAttempted, start);
            }

            // STAGE 1: ShadowRegistry Local Lookup
            layersAttempted.push('STAGE_1_SHADOW_REGISTRY');
            const regMatch = await this.registry.find(input);
            let piva = regMatch?.piva;
            let discoveredUrl: string | null = null;
            let discoveryLayer = '';

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
                            const { OracleClient } = require('../../enricher/utils/oracle_client');
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
            const checkUrlWithTimeout = async (url: string, layerName: string): Promise<boolean> => {
                try {
                    console.log(`[MasterPipeline] ⚡ Checking: ${url} (${layerName}) for "${input.company_name}"`);
                    const result = await Promise.race([
                        checkUrl(url, layerName),
                        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('CHECK_URL_TIMEOUT')), 8000))
                    ]);
                    if (result) {
                        console.log(`[MasterPipeline] ✅ FOUND: ${url} via ${discoveryLayer}`);
                    }
                    return result;
                } catch (err: any) {
                    console.warn(`[MasterPipeline] ⏰ Timeout/Error checking ${url}: ${err.message}`);
                    return false;
                }
            };

            // STAGE 2: Email Domain Candidate
            layersAttempted.push('STAGE_2_EMAIL_DOMAIN');
            if (input.email_domain) {
                const candidateUrl = `https://www.${input.email_domain}`;
                await checkUrlWithTimeout(candidateUrl, 'EMAIL_DOMAIN');
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
                            const found = await checkUrlWithTimeout(cand.url, 'SERP_PIVA_SNIPPET');
                            if (found) break;
                        }
                    }
                }

                // Only check top 3 candidates to avoid timeout cascade
                if (!discoveredUrl) {
                    const topCandidates = serpRes.results.slice(0, 3);
                    for (const cand of topCandidates) {
                        const found = await checkUrlWithTimeout(cand.url, 'SERP_COMPANY');
                        if (found) break;
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
                                const found = await checkUrlWithTimeout(candidateUrl, 'REGISTRY_EXTRACT');
                                if (found) break;
                            }
                            // Also check if the registry page itself can be fetched for website info
                            // by looking at the title for domain clues
                            const titleDomainMatch = regResult.title.match(/([a-z0-9][-a-z0-9]+\.(?:it|com|eu|net|org))/i);
                            if (titleDomainMatch && !regResult.domain.includes(titleDomainMatch[1])) {
                                const candidateUrl = `https://www.${titleDomainMatch[1]}`;
                                const found = await checkUrlWithTimeout(candidateUrl, 'REGISTRY_TITLE');
                                if (found) break;
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

            // ENRICHMENT PHASE (Parallel via Valve)
            let financial = null;
            let decisionMaker = null;
            let employees = null;
            let pec = null;
            let email = null;

            if (discoveredUrl) {
                // If we found it, spawn enrichments safely through priority queue
                const [finRes, dmRes, empRes, fattRes, contactsRes] = await Promise.all([
                    this.bilancioHunter.hunt(companyId, input).catch(() => null),
                    this.linkedinSniper.snipe(companyId, input).catch(() => null),
                    this.postProcessor.estimateEmployees(companyId, input, discoveredUrl).catch(() => null),
                    FatturatoItaliaHarvester.harvest(input as any).catch(() => null),
                    this.pecHunter.hunt(companyId, input, discoveredUrl).catch(() => null)
                ]);

                // Merge financial sources (FatturatoItalia takes precedence for Revenue/Employees if found)
                financial = { ...finRes };
                if (fattRes) {
                    if (fattRes.revenue) {
                        financial.fatturato_current = parseFloat(fattRes.revenue.replace(/[^0-9]/g, ''));
                        financial.year = parseInt(fattRes.revenueYear || '2023', 10);
                        financial.source_url = fattRes.url;
                    }
                    if (fattRes.employees && (!employees || employees === 'N/A')) {
                        employees = fattRes.employees;
                    }
                }

                decisionMaker = dmRes;
                pec = contactsRes?.pec || null;
                email = contactsRes?.email || null;
            }

            const status = discoveredUrl ? 'FOUND_COMPLETE' : 'NOT_FOUND';

            return this.buildResult(input, status, discoveredUrl, discoveryLayer, financial, decisionMaker, employees, pec, email, layersAttempted, start);
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
        pec: any,
        email: any,
        layers: string[],
        start: number
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
            pec: pec || undefined,
            email: email || undefined,
            employees: employees || undefined,
            financial: fin || undefined,
            decision_maker: dm || undefined,
            meta: {
                duration_ms: Date.now() - start,
                layers_attempted: layers,
                timestamp: new Date().toISOString()
            },
            status
        };
    }
}
