import { SerpDeduplicator } from './SerpDeduplicator';
import { NormalizedInput } from './InputNormalizer';
import { BackpressureValve } from './BackpressureValve';
import { QuerySanitizer } from './QuerySanitizer';
import { SerperSearchProvider } from '../enricher/core/discovery/search_provider';

export interface DecisionMaker {
    name?: string;
    role?: string;
    linkedin_url?: string;
    confidence: number;
}

export class LinkedInSniper {
    private dedup: SerpDeduplicator;
    private valve: BackpressureValve;
    private sanitizer = new QuerySanitizer();

    constructor(dedup: SerpDeduplicator, valve: BackpressureValve) {
        this.dedup = dedup;
        this.valve = valve;
    }

    public async snipe(companyId: string, input: NormalizedInput): Promise<DecisionMaker | null> {
        const query = this.sanitizer.buildCompanyQuery(input, {
            target: 'linkedin',
            includeDomain: 'site:linkedin.com/in',
        });
        if (!query) return null;

        let results: Array<{ url: string; title: string }> = [];
        try {
            results = await new SerperSearchProvider().search(query);
        } catch {
            return null;
        }

        const best = results.find((result) => result.url?.includes('linkedin.com/in/'));
        if (!best) return null;
        const title = best.title || '';

        // "Marco Rossi - Titolare - Ferramenta Brescia Srl - LinkedIn" -> extract "Marco Rossi" and "Titolare"
        const parts = title.split(/[|\-–]/).map(p => p.trim());
        let name = parts[0];
        let role = parts.length > 1 ? parts[1] : undefined;

        if (name.toLowerCase().includes('linkedin')) name = '';
        if (name.length > 50) name = ''; // Probably a generic page, not a person

        // Quick sanity check on role string
        if (role && role.length > 40) {
            role = role.substring(0, 40) + '...';
        }

        if (!name) return null;

        return {
            name: name,
            role: role,
            linkedin_url: best.url,
            confidence: 0.85
        };
    }
}
