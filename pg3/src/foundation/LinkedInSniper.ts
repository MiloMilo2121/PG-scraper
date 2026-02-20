import { SerpDeduplicator } from './SerpDeduplicator';
import { NormalizedInput } from './InputNormalizer';
import { BackpressureValve } from './BackpressureValve';

export interface DecisionMaker {
    name?: string;
    role?: string;
    linkedin_url?: string;
    confidence: number;
}

export class LinkedInSniper {
    private dedup: SerpDeduplicator;
    private valve: BackpressureValve;

    constructor(dedup: SerpDeduplicator, valve: BackpressureValve) {
        this.dedup = dedup;
        this.valve = valve;
    }

    public async snipe(companyId: string, input: NormalizedInput): Promise<DecisionMaker | null> {
        // Enqueue at Priority 2 so core discovery (P0/1) finishes first
        return this.valve.execute(async () => {
            const res = await this.dedup.search(companyId, input, 'linkedin');
            if (res.results.length === 0) return null;

            const best = res.results[0];
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
        }, 2); // Priority 2
    }
}
