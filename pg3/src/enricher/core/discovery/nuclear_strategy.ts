import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { BrowserFactory } from '../browser/factory_v2';
import { GoogleSearchProvider, DDGSearchProvider } from './search_provider';
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
     * The Master Method: Orchestrates 20+ search methods for a single company
     */
    public async execute(company: CompanyInput): Promise<{ url: string | null; method: string; confidence: number }> {
        const queries = this.generateNuclearQueries(company);
        Logger.info(`☢️ [Nuclear] Launching ${queries.length} precision warheads for "${company.company_name}"...`);

        const candidates = new Map<string, number>(); // URL -> Score

        // Execute searches (Simulation of massive concurrency)
        const searchTasks = queries.map(q => this.queryLimit(async () => {
            // 🛡️ SAFETY DELAY: 2-5 seconds of randomized pause
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

            // Force DDG (Tor) as Google is blocked/exhausted
            // Future improvement: Dynamically switch based on success rate
            const engine = 'ddg';
            return await this.performSearch(q, engine);
        }));

        const results = await Promise.all(searchTasks);
        const allUrls = results.flat();

        // Scoring & Deduplication
        for (const url of allUrls) {
            const score = this.scoreCandidate(url, company);
            if (score > 0) {
                candidates.set(url, (candidates.get(url) || 0) + score);
            }
        }

        // Sort by score
        const sortedCandidates = [...candidates.entries()].sort((a, b) => b[1] - a[1]);

        if (sortedCandidates.length === 0) {
            return { url: null, method: 'nuclear_failed', confidence: 0 };
        }

        // Best candidate validation
        const [bestUrl, bestScore] = sortedCandidates[0];

        // Normalize confidence to 0-1 range
        // A score > 15 is extremely high confidence (multi-source confirmation)
        const normalizedConfidence = Math.min(bestScore / 20, 0.95);

        return {
            url: bestUrl,
            method: 'nuclear_triangulation',
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

    private async performSearch(query: string, engine: 'google' | 'ddg'): Promise<string[]> {
        try {
            let results: any[] = [];
            const provider = engine === 'google' ? new GoogleSearchProvider() : new DDGSearchProvider();
            results = await provider.search(query);
            return results.map(r => r.url);
        } catch (e) {
            Logger.warn(`[Nuclear] Search error (${engine}): ${(e as Error).message}`);
            return [];
        }
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
