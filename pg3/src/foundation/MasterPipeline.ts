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
        browserPool: BrowserPool
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
                return this.buildResult(input, 'NOT_FOUND', null, null, null, layersAttempted, start);
            }

            // STAGE 1: ShadowRegistry Local Lookup
            layersAttempted.push('STAGE_1_SHADOW_REGISTRY');
            const regMatch = await this.registry.find(input);
            let piva = regMatch?.piva;
            let discoveredUrl: string | null = null;
            let discoveryLayer = '';

            // In a perfect system, if Registry returns URL, we take it. 
            // Since ShadowRegistry only returns PIVA right now, we use that for later verification.

            // Helper for Ultimate Golden Match
            const checkUrl = async (url: string, layerName: string): Promise<boolean> => {
                const gateStatus = await this.gate.check(url, piva);
                if (gateStatus === 'VERIFIED') {
                    discoveredUrl = url;
                    discoveryLayer = layerName;
                    return true;
                } else if (gateStatus === 'NEEDS_BROWSER' && piva) {
                    // The ultimate WAF bypass: Chromium loads it and we check HTML for PIVA
                    const nav = await this.browserPool.navigateSafe(url);
                    if (nav.status === 'OK' && nav.html) {
                        const cleanPiva = piva.replace(/[^0-9]/g, '');
                        const bodyText = nav.html.replace(/[^0-9]/g, '');
                        if (bodyText.includes(cleanPiva)) {
                            discoveredUrl = url;
                            discoveryLayer = layerName + '_WAF_BYPASS';
                            return true;
                        }
                    }
                }
                return false;
            };

            // STAGE 2: Email Domain Candidate
            layersAttempted.push('STAGE_2_EMAIL_DOMAIN');
            if (input.email_domain) {
                const candidateUrl = `https://www.${input.email_domain}`;
                await checkUrl(candidateUrl, 'EMAIL_DOMAIN');
            }

            // STAGE 3: Hyper Guesser (Direct Domain Probe)
            if (!discoveredUrl && input.company_name_variants.length > 0) {
                layersAttempted.push('STAGE_3_HYPER_GUESSER');
                const baseGuess = input.company_name_variants[0].replace(/[^a-z0-9]/g, '');
                if (baseGuess.length >= 3) {
                    const guessUrl = `https://www.${baseGuess}.it`;
                    await checkUrl(guessUrl, 'HYPER_GUESSER');
                }
            }

            // STAGE 4: SERP Company Search
            if (!discoveredUrl) {
                layersAttempted.push('STAGE_4_SERP_COMPANY');
                const serpRes = await this.dedup.search(companyId, input, 'company', { maxTier: isBleeding ? 1 : undefined });

                for (const cand of serpRes.results) {
                    const found = await checkUrl(cand.url, 'SERP_COMPANY');
                    if (found) break;
                }

                // STAGE 5: SERP Registry Search
                if (!discoveredUrl && !isBleeding) {
                    layersAttempted.push('STAGE_5_SERP_REGISTRY');
                    const regSerpRes = await this.dedup.search(companyId, input, 'registry', { maxTier: 1 });
                    if (regSerpRes.results.length > 0) {
                        // Fallback logic for registry extraction goes here
                    }
                }
            }

            // ENRICHMENT PHASE (Parallel via Valve)
            let financial = null;
            let decisionMaker = null;

            if (discoveredUrl) {
                // If we found it, spawn enrichments safely through priority queue
                const [finRes, dmRes] = await Promise.all([
                    this.bilancioHunter.hunt(companyId, input).catch(() => null),
                    this.linkedinSniper.snipe(companyId, input).catch(() => null)
                ]);
                financial = finRes;
                decisionMaker = dmRes;
            }

            const status = discoveredUrl ? 'FOUND_COMPLETE' : 'NOT_FOUND';

            return this.buildResult(input, status, discoveredUrl, financial, decisionMaker, layersAttempted, start);
        }, 1); // Priority 1 (Core Pipeline)
    }

    private buildResult(
        input: NormalizedInput,
        status: string,
        url: string | null,
        fin: any,
        dm: any,
        layers: string[],
        start: number
    ) {
        return {
            input: {
                company_name: input.company_name,
                city: input.city,
                normalized_name: input.company_name_variants[0] || input.company_name,
            },
            website: url ? { url, confidence: 0.95, discovery_layer: layers[layers.length - 1] } : undefined,
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
