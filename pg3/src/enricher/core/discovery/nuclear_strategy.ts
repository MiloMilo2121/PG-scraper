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

        // 🛡️ GATING 1: Input Quality
        const quality = this.calculateInputQuality(company);
        if (quality < 30) {
            Logger.warn(`[Nuclear] Gating rejected: Input quality too low (${quality}%). Escalation denied.`);
            return { url: null, method: 'nuclear_rejected_low_quality', confidence: 0 };
        }

        // ☢️ GATING 2: Perplexity Feature Flag
        if (config.features.perplexityEnabled && process.env.PERPLEXITY_API_KEY) {
            Logger.info(`[Nuclear] Target authorized for Tier 8 Perplexity Oracle.`);
            try {
                const ppxUrl = await this.runPerplexity(company);
                if (ppxUrl) {
                    return { url: ppxUrl, method: 'perplexity_sonar', confidence: 0.90 };
                }
            } catch (e: any) {
                Logger.warn(`[Nuclear] Perplexity failed: ${e.message}`);
            }
        } else {
            Logger.warn(`[Nuclear] Perplexity disabled or API key missing. Proceeding to legacy nuclear...`);
        }

        // 3. LEGACY TRIANGULATION (if Perplexity is disabled or fails)
        const queries = this.generateNuclearQueries(company);
        return this.executeLegacy(company, queries);
    }

    /**
     * Tier 8: Absolutely final oracle attempt using Sonar Pro via Perplexity.
     */
    private async runPerplexity(company: CompanyInput): Promise<string | null> {
        const query = `Qual è il sito web ufficiale (www o https) dell'azienda italiana "${company.company_name}" situata a ${company.city || ''} (${company.province || ''}) che opera nel settore ${company.category || ''}? P.IVA: ${company.vat_code || 'Sconosciuta'}. Rispondi SOLO con l'URL senza nient'altro, e rispondi "NULL" se non ne sei assolutamente certo.`;

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar-pro',
                messages: [{ role: 'user', content: query }],
                temperature: 0.1,
                max_tokens: 50
            })
        });

        if (!response.ok) {
            throw new Error(`Perplexity API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim();

        if (content && content !== 'NULL' && content.includes('.')) {
            let url = content.toLowerCase();
            if (!url.startsWith('http')) {
                url = 'https://' + url;
            }
            Logger.info(`[Nuclear] 🎯 PERPLEXITY FOUND WEBSITE: ${url}`);
            return url;
        }

        return null;
    }

    /**
     * Calculates the "richness" of the input data to prevent
     * firing expensive LLM queries on empty/worthless PagineGialle stubs.
     */
    private calculateInputQuality(company: CompanyInput): number {
        let score = 0;
        if (company.company_name && company.company_name.trim().length > 3) score += 20;
        if (company.city) score += 15;
        if (company.province) score += 10;
        if (company.vat_code || (company as any).piva || (company as any).vat) score += 40;
        if (company.address) score += 10;
        if (company.phone) score += 5;
        return score;
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
