import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickLinkedInProfileResult } from './search_result_selectors';

export interface DecisionMaker {
    name?: string;
    role?: string;
    linkedin_url?: string;
    confidence: number;
}

export class LinkedInSniper {
    private router: CostRouter;
    private sanitizer = new QuerySanitizer();

    constructor(router: CostRouter) {
        this.router = router;
    }

    public async snipe(companyId: string, input: NormalizedInput): Promise<DecisionMaker | null> {
        const query = this.sanitizer.buildCompanyQuery(input, {
            target: 'linkedin',
            includeDomain: 'site:linkedin.com/in',
        });
        if (!query) return null;

        try {
            const routeResult = await this.router.route<Array<{ url: string; title: string }>>(
                'SERP',
                { query },
                { companyId, maxTier: 1 }
            );
            const best = pickLinkedInProfileResult(routeResult.data || []);
            if (!best) {
                return null;
            }

            const title = best.title || '';
            const parts = title.split(/[|\-–]/).map((p) => p.trim());
            let name = parts[0];
            let role = parts.length > 1 ? parts[1] : undefined;

            if (name.toLowerCase().includes('linkedin')) name = '';
            if (name.length > 50) name = '';

            if (role && role.length > 40) {
                role = role.substring(0, 40) + '...';
            }

            if (!name) return null;

            return {
                name,
                role,
                linkedin_url: best.url,
                confidence: routeResult.provider === 'cache' ? 0.82 : 0.85,
            };
        } catch {
            return null;
        }
    }
}
