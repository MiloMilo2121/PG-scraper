import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { BrowserFactory } from '../browser/factory_v2';
import { GoogleSearchProvider, DDGSearchProvider, SerperSearchProvider } from './search_provider';
import { LLMValidator } from '../ai/llm_validator';
import { config } from '../../config';
import pLimit from 'p-limit';

/**
 * ☢️ NUCLEAR STRATEGY ☢️
 * Run 4: "Firepower" Mode.
 * Refactored for better type safety and scoring.
 */
export class NuclearStrategy {
    private browserFactory: BrowserFactory;

    // We limit parallel queries PER COMPANY to avoid totally banning our IP
    private queryLimit = pLimit(3);

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
    }

    /**
     * The Master Method: Orchestrates Smart AI Search
     */
    public async execute(company: CompanyInput): Promise<{ url: string | null; method: string; confidence: number }> {
        Logger.info(`☢️ [Nuclear] Launching SMART search for "${company.company_name}"...`);

        // 1. GENERATE QUERIES (Reduced set for AI - Quality over Quantity)
        const query = `"${company.company_name}" ${company.city || ''} sito ufficiale`;

        // 2. SEARCH (DDG first, then Serper)
        let serpResults: any[] = [];
        try {
            // Try DDG First
            const ddgProvider = new DDGSearchProvider();
            serpResults = await ddgProvider.search(query);

            // Fallback to Serper if DDG is empty
            if (serpResults.length === 0) {
                Logger.info(`[Nuclear] DDG empty. Escalating to Serper.dev...`);
                const serperProvider = new SerperSearchProvider();
                serpResults = await serperProvider.search(query);
            }
        } catch (e) {
            Logger.warn(`[Nuclear] Search failed: ${(e as Error).message}`);
            return { url: null, method: 'nuclear_failed', confidence: 0 };
        }


        if (serpResults.length === 0) {
            Logger.warn(`[Nuclear] Initial search yielded NO results. Switching to LEGACY PROTOCOL immediately.`);
            // Fall through to legacy...
        } else {
            // 3. SMART AI SELECTION (Only if we have results)
            Logger.info(`[Nuclear] Analyzing ${serpResults.length} SERP results with AI...`);
            try {
                const aiDecision = await LLMValidator.selectBestUrl(company, serpResults);

                if (aiDecision.bestUrl && aiDecision.confidence > 0.6) {
                    Logger.info(`[Nuclear] AI selected: ${aiDecision.bestUrl} (Conf: ${aiDecision.confidence})`);
                    return {
                        url: aiDecision.bestUrl,
                        method: 'nuclear_smart_ai',
                        confidence: aiDecision.confidence
                    };
                }
                Logger.info(`[Nuclear] AI unsure (Conf: ${aiDecision.confidence}). Falling back to heuristics.`);
            } catch (aiError: any) {
                Logger.warn(`[Nuclear] AI selection failed: ${aiError.message}. Falling back to heuristics.`);
            }
        }

        const queries = this.generateNuclearQueries(company);
        return this.executeLegacy(company, queries);
    }

    private async executeLegacy(company: CompanyInput, queries: string[]) {
        const candidates = new Map<string, number>();
        const searchTasks = queries.map(q => this.queryLimit(async () => {
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

            // 1. Try DDG (Fast, but often blocked)
            try {
                const provider = new DDGSearchProvider();
                let results = await provider.search(q);
                if (results.length > 0) return results.map((r: any) => r.url);
            } catch (e) { }

            // 2. Try Serper (API, reliable but needs key)
            if (process.env.SERPER_API_KEY) {
                try {
                    const provider = new SerperSearchProvider();
                    let results = await provider.search(q);
                    if (results.length > 0) return results.map((r: any) => r.url);
                } catch (e) { }
            }

            // 3. Try Google (Puppeteer + Scrape.do - Slow but robust)
            // Added as fallback for Rescue Mission
            try {
                const provider = new GoogleSearchProvider();
                let results = await provider.search(q);
                return results.map((r: any) => r.link); // Google provider uses 'link' not 'url'
            } catch (e) {
                return [];
            }
        }));

        const results = await Promise.all(searchTasks);
        const allUrls = results.flat().filter(u => u); // Filter undefined/null

        for (const url of allUrls) {
            const score = this.scoreCandidate(url, company);
            if (score > 0) candidates.set(url, (candidates.get(url) || 0) + score);
        }

        const sortedCandidates = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
        if (sortedCandidates.length === 0) return { url: null, method: 'nuclear_failed', confidence: 0 };
        const [bestUrl, bestScore] = sortedCandidates[0];
        const normalizedConfidence = Math.min(bestScore / 20, 0.95);

        return {
            url: bestUrl,
            method: 'nuclear_triangulation_legacy',
            confidence: normalizedConfidence
        };
    }


    /**
     * Generates 20+ distinct query permutations
     */
    private generateNuclearQueries(company: CompanyInput): string[] {
        const q: string[] = [];
        const name = company.company_name;
        // Law 306: Sanitize input
        const cleanName = name.replace(/\b(srl|snc|sas|spa)\b/gi, '').trim();
        const city = company.city || '';
        const province = company.province || (company as any).region || '';
        const vat = (company as any).piva || (company as any).vat || '';
        const phone = (company as any).phone || '';

        // Group 1: Standard Variations
        q.push(`"${cleanName}" ${city} sito ufficiale`);
        q.push(`"${cleanName}" ${province} website`);
        q.push(`${cleanName} ${city} contatti`);
        q.push(`${cleanName} ${city} "chi siamo"`);
        q.push(`"${name}" ${city}`);

        // Group 2: Advanced Operators
        q.push(`site:it "${cleanName}" ${city}`); // Force Italian TLD
        q.push(`intitle:"${cleanName}" ${city}`);

        // Group 3: Specific File Types / Data
        q.push(`"${cleanName}" "cookie policy"`); // Legal pages often indexed better
        q.push(`"${cleanName}" "privacy policy"`);

        // Group 4: Reverse Lookups
        if (vat) {
            q.push(`${vat} sito`);
            q.push(`"P.IVA ${vat}"`);
        }
        if (phone) {
            q.push(`"${phone}" sito`);
        }

        // Group 5: Social Triangulation
        q.push(`site:facebook.com "${cleanName}" ${city}`);
        q.push(`site:instagram.com "${cleanName}" ${city}`);
        q.push(`site:linkedin.com "${cleanName}" ${city}`);

        return q;
    }

    /**
     * Heuristic scoring of a URL based on company data
     */
    private scoreCandidate(url: string, company: CompanyInput): number {
        let score = 0;

        try {
            const urlObj = new URL(url);
            const lowerUrl = url.toLowerCase();
            const hostname = urlObj.hostname.toLowerCase();
            const cleanName = company.company_name.replace(/\b(srl|snc|sas|spa)\b/gi, '').trim().toLowerCase().replace(/\s+/g, '');

            // 1. Domain Name Match
            if (hostname.includes(cleanName)) score += 5;

            // 2. TLD Preference
            if (hostname.endsWith('.it')) score += 2;

            // 3. Negative Penalties (Directory sites)
            // Ideally should check against a known list of directory domains
            if (hostname.includes('paginegialle') || hostname.includes('facebook') || hostname.includes('instagram') || hostname.includes('linkedin')) {
                score -= 10;
            }

            // 4. Path analysis
            if (urlObj.pathname.includes('contatti') || urlObj.pathname.includes('contact')) score += 1;

        } catch (e) {
            // Invalid URL
            return 0;
        }

        return score;
    }
}
