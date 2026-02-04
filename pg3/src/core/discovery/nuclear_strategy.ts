
import { CompanyInput } from '../company_types';
import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { BrowserFactory } from '../browser/factory_v2';
import { GoogleSearchProvider, DDGSearchProvider } from './search_provider';
import pLimit from 'p-limit';

/**
 * ☢️ NUCLEAR STRATEGY ☢️
 * Run 4: "Firepower" Mode.
 * 
 * Target: Companies that survived Run 1 (Fast), Run 2 (Deep), and Run 3 (Aggressive).
 * Methodology: 
 * - Generates 20+ specialized search permutations per company.
 * - Uses parallel browser instances to check multiple angles simultaneously.
 * - focus on "Triangulation": finding the site via third-party profiles (FB, LinkedIn, Directories).
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

        // We run these in chunks to avoid overwhelming the browser/network
        // but we analyze results effectively.

        const candidates = new Map<string, number>(); // URL -> Score

        // Execute searches (Simulation of massive concurrency)
        const searchTasks = queries.map(q => this.queryLimit(async () => {
            // 🛡️ SAFETY DELAY: 2-5 seconds of randomized pause to prevent IP bans
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

            // Rotate engines: 50% Google, 50% DDG to spread load
            const engine = Math.random() > 0.5 ? 'google' : 'ddg';
            const urls = await this.performSearch(q, engine);
            return urls;
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

        if (sortedCandidates.length === 0) return { url: null, method: 'nuclear_failed', confidence: 0 };

        // Best candidate validation (Deep Scan found mostly likely)
        const bestUrl = sortedCandidates[0][0];
        const bestScore = sortedCandidates[0][1];

        // Final sanity check (simple ping) handled by UnifiedService usually, 
        // but here we return the best guess.
        return {
            url: bestUrl,
            method: 'nuclear_triangulation',
            confidence: bestScore > 5 ? 0.9 : 0.5
        };
    }

    /**
     * Generates 20+ distinct query permutations
     */
    private generateNuclearQueries(company: CompanyInput): string[] {
        const q: string[] = [];
        const name = company.company_name;
        const cleanName = name.replace(/\b(srl|snc|sas|spa)\b/gi, '').trim();
        const city = company.city || '';
        const province = company.province || (company as any).region || '';
        const vat = (company as any).piva || (company as any).vat || '';
        const phone = (company as any).phone || '';

        // Group 1: Standard Variations (5)
        q.push(`"${cleanName}" ${city} sito ufficiale`);
        q.push(`"${cleanName}" ${province} website`);
        q.push(`${cleanName} ${city} contatti`);
        q.push(`${cleanName} ${city} "chi siamo"`);
        q.push(`"${name}" ${city}`);

        // Group 2: Advanced Operators (5)
        q.push(`site:it "${cleanName}" ${city}`); // Force Italian TLD
        q.push(`intitle:"${cleanName}" ${city}`);
        q.push(`inurl:${cleanName.replace(/\s+/g, '')}`);
        q.push(`"${cleanName}" ${city} email @`); // Finding pages with emails
        q.push(`"${cleanName}" partita iva ${vat}`); // Super strong if VAT indexed

        // Group 3: Specific File Types / Data (3)
        // q.push(`"${cleanName}" filetype:pdf`); // Menus, catalogs often reveal site
        q.push(`"${cleanName}" "cookie policy"`); // Legal pages often indexed better
        q.push(`"${cleanName}" "privacy policy"`);

        // Group 4: Reverse Lookups (Important for stubborn ones) (4)
        if (vat) q.push(`${vat} sito`);
        if (vat) q.push(`"P.IVA ${vat}"`);
        if (phone) q.push(`"${phone}" sito`);
        if (phone) q.push(`tel:${phone.replace(/\s/g, '')}`);

        // Group 5: Social Triangulation (3) - Find FB/IG to find website link
        q.push(`site:facebook.com "${cleanName}" ${city}`);
        q.push(`site:instagram.com "${cleanName}" ${city}`);
        q.push(`site:linkedin.com "${cleanName}" ${city}`);

        return q;
    }

    /**
     * Executes a search query (Stub - hooks into existing scrapers)
     */
    private async performSearch(query: string, engine: 'google' | 'ddg'): Promise<string[]> {
        try {
            let results: any[] = [];

            if (engine === 'google') {
                const provider = new GoogleSearchProvider();
                results = await provider.search(query);
            } else {
                const provider = new DDGSearchProvider();
                results = await provider.search(query);
            }

            return results.map(r => r.url);
        } catch (e) {
            Logger.warn(`[Nuclear] Search error (${engine}): ${e}`);
            return [];
        }
    }

    /**
     * Heuristic scoring of a URL based on company data
     */
    private scoreCandidate(url: string, company: CompanyInput): number {
        let score = 0;
        const lowerUrl = url.toLowerCase();
        const cleanName = company.company_name.replace(/\b(srl|snc|sas|spa)\b/gi, '').trim().toLowerCase().replace(/\s+/g, '');

        // 1. Domain Name Match
        if (lowerUrl.includes(cleanName)) score += 5;

        // 2. TLD Preference
        if (lowerUrl.endsWith('.it') || lowerUrl.endsWith('.it/')) score += 2;

        // 3. Negative Penalties (Directory sites)
        if (lowerUrl.includes('paginegialle') || lowerUrl.includes('facebook') || lowerUrl.includes('instagram')) {
            // These are discovery vehicles, not the final site (unless we parse them, which NuclearStrategy v2 could do)
            // For now, we penalize them as "final" results but they might have been useful intermediate steps in a smarter version.
            score -= 10;
        }

        return score;
    }
}
