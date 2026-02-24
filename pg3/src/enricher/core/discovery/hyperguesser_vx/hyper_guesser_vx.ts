/**
 * HYPER GUESSER VX 
 * The standalone "Nuclear Option" strategy.
 * Bypasses Search Engines, generates up to 250 domains, pings DNS in parallel,
 * ghost-fetches HTML, and triages via GLM-Flash in one explosive run.
 */

import { CompanyInput } from '../../../types';
import { Logger } from '../../../utils/logger';
import { DiscoveryResult } from './../unified_discovery_service';

import { HyperGuesserVXGenerator } from './generator';
import { HyperGuesserVXResolver } from './resolver';
import { HyperGuesserVXFetcher } from './fetcher';
import { HyperGuesserVXValidator } from './validator';

export class HyperGuesserVX {

    /**
     * Executes the HyperGuesser VX protocol.
     * Guaranteed to use exactly 0 queries from Google/Bing.
     */
    static async blast(company: CompanyInput): Promise<DiscoveryResult | null> {
        const startTime = Date.now();
        Logger.info(`💣 [HyperGuesserVX] LAUNCHING PROTOCOL FOR: ${company.company_name} 💣`);

        // Phase 1: Massive Generation
        const candidates = HyperGuesserVXGenerator.generate(company);
        if (!candidates.length) {
            Logger.warn(`[HyperGuesserVX] Generation failed to produce candidates.`);
            return null;
        }
        Logger.info(`[HyperGuesserVX] Generated ${candidates.length} aggressive permutations.`);

        // Phase 2: Parallel DNS Resolution (The Filter)
        const aliveDomains = await HyperGuesserVXResolver.resolveBatch(candidates);
        if (!aliveDomains.length) {
            Logger.info(`[HyperGuesserVX] All ${candidates.length} domains are DEAD.`);
            return null;
        }

        // Phase 3: Ghost Fetching (The Intel Gathering)
        // Extract just the domain strings for the fetcher
        const domainsToFetch = aliveDomains.map(d => d.domain);
        const fetchedTexts = await HyperGuesserVXFetcher.fetchBatch(domainsToFetch);

        if (!fetchedTexts.length) {
            Logger.warn(`[HyperGuesserVX] No meaningful text recovered from alive domains.`);
            return null;
        }

        // Phase 4: AI Triage (The Judgement)
        const triageResult = await HyperGuesserVXValidator.validateBatch(company, fetchedTexts);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (triageResult.selected_url && triageResult.confidence >= 0.70) {
            // Find the original title if we can match the URL
            const matchedCandidate = fetchedTexts.find(f => f.url === triageResult.selected_url);

            Logger.info(`🏆 [HyperGuesserVX] MISSION SUCCESS in ${duration}s -> ${triageResult.selected_url}`);

            return {
                url: triageResult.selected_url,
                status: 'FOUND_VALID',
                method: 'hyper_guesser_vx',
                confidence: triageResult.confidence,
                wave: 'VX_PROTOCOL',
                details: {
                    matchedConditions: ['hyperguesser_vx_ai_triage'],
                    title: matchedCandidate?.title || 'HyperGuesser VX Extraction',
                    confidence: triageResult.confidence,
                    reasons: [triageResult.reason]
                }
            };
        }

        Logger.info(`[HyperGuesserVX] Mission failed after ${duration}s. AI rejected ${fetchedTexts.length} texts.`);
        return null;
    }
}
