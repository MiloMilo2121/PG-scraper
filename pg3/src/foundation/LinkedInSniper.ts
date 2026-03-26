import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickLinkedInProfileResult, scoreLinkedInProfileResult, SearchResultLike } from './search_result_selectors';

export interface DecisionMaker {
    name?: string;
    role?: string;
    linkedin_url?: string;
    source?: string;
    confidence: number;
}

export class LinkedInSniper {
    private router: CostRouter;
    private sanitizer = new QuerySanitizer();

    constructor(router: CostRouter) {
        this.router = router;
    }

    private buildSelectionContext(input: NormalizedInput, discoveredUrl?: string | null) {
        const companyTokens = (input.company_name_variants || [input.company_name])
            .flatMap((variant) => variant.toLowerCase().split(/\s+/))
            .map((token) => token.replace(/[^a-z0-9]/gi, ''))
            .filter((token) => token.length >= 3);

        const locationTokens = [input.city, input.provincia]
            .filter(Boolean)
            .map((token) => String(token).toLowerCase());

        const domainTokens = new Set<string>();
        for (const candidate of [input.website, discoveredUrl, input.email_domain ? `https://${input.email_domain}` : undefined]) {
            if (!candidate) {
                continue;
            }

            try {
                const hostname = new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
                domainTokens.add(hostname);
                const root = hostname.split('.').slice(0, -1).join('.');
                if (root) {
                    domainTokens.add(root);
                }
            } catch {
                // ignore malformed candidate
            }
        }

        return {
            companyTokens: [...new Set(companyTokens)],
            locationTokens,
            domainTokens: [...domainTokens],
            roleTokens: ['titolare', 'founder', 'ceo', 'owner', 'amministratore', 'presidente', 'managing director'],
        };
    }

    private extractDecisionMaker(result: SearchResultLike, confidence: number, source: string): DecisionMaker | null {
        const title = result.title || '';
        const snippet = result.snippet || '';
        const parts = title.split(/[|\-–]/).map((p) => p.trim()).filter(Boolean);
        let name = parts[0] || '';
        let role = parts.find((part, index) => index > 0 && /titolare|founder|ceo|owner|amministratore|presidente|director|manager/i.test(part));

        if (!role) {
            const snippetRole = snippet.match(/(titolare|founder|ceo|owner|amministratore(?: delegato)?|presidente|managing director|branch manager)/i);
            role = snippetRole?.[1];
        }

        if (name.toLowerCase().includes('linkedin')) name = '';
        if (name.length > 60 || !/\s/.test(name)) {
            const snippetName = snippet.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
            if (snippetName) {
                name = snippetName[1];
            }
        }

        if (!name || name.length > 80) {
            return null;
        }

        if (role && role.length > 60) {
            role = role.substring(0, 60).trim();
        }

        return {
            name,
            role,
            linkedin_url: result.url,
            source,
            confidence,
        };
    }

    public async snipe(companyId: string, input: NormalizedInput, discoveredUrl?: string | null): Promise<DecisionMaker | null> {
        const queries = this.sanitizer.buildQueryVariants(input, 'linkedin');
        if (queries.length === 0) return null;

        const selectionContext = this.buildSelectionContext(input, discoveredUrl);
        const collected = new Map<string, SearchResultLike>();
        const providersSeen = new Set<string>();

        try {
            for (const query of queries) {
                const routeResult = await this.router.route<Array<{ url: string; title: string; snippet?: string }>>(
                    'SERP',
                    { query },
                    { companyId, maxTier: 1 }
                );
                providersSeen.add(routeResult.provider);
                for (const result of routeResult.data || []) {
                    if (result?.url && !collected.has(result.url)) {
                        collected.set(result.url, result);
                    }
                }
            }

            const rankedResults = [...collected.values()];
            const best = pickLinkedInProfileResult(rankedResults, selectionContext);
            if (!best) {
                return null;
            }

            const bestScore = scoreLinkedInProfileResult(best, selectionContext);
            const normalizedConfidence = Math.max(0.55, Math.min(0.96, Number((0.55 + (bestScore / 20)).toFixed(2))));
            if (bestScore < 9) {
                return null;
            }

            return this.extractDecisionMaker(best, normalizedConfidence, [...providersSeen][0] || 'linkedin_serp');
        } catch {
            return null;
        }
    }
}
