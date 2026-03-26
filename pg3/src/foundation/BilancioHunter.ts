import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickFinancialSearchResult, scoreFinancialSearchResult, SearchResultLike } from './search_result_selectors';

export interface FinancialData {
    fatturato_current?: number;
    fatturato_previous?: number;
    utile_netto?: number;
    year?: number;
    source_url?: string;
    source_provider?: string;
    confidence?: number;
}

export class BilancioHunter {
    private router: CostRouter;
    private sanitizer = new QuerySanitizer();

    constructor(router: CostRouter) {
        this.router = router;
    }

    private buildSelectionContext(input: NormalizedInput) {
        const companyTokens = (input.company_name_variants || [input.company_name])
            .flatMap((variant) => variant.toLowerCase().split(/\s+/))
            .map((token) => token.replace(/[^a-z0-9]/gi, ''))
            .filter((token) => token.length >= 3);

        return {
            companyTokens: [...new Set(companyTokens)],
            locationTokens: [input.city, input.provincia].filter(Boolean).map((token) => String(token).toLowerCase()),
            vat: input.vat_code,
        };
    }

    public async hunt(companyId: string, input: NormalizedInput): Promise<FinancialData | null> {
        const queries = this.sanitizer.buildQueryVariants(input, 'bilancio', input.vat_code);
        if (queries.length === 0) {
            return null;
        }

        const selectionContext = this.buildSelectionContext(input);
        const collected = new Map<string, SearchResultLike>();
        const providersSeen = new Set<string>();

        try {
            for (const query of queries) {
                const routeResult = await this.router.route<Array<{ url: string; title: string; snippet?: string }>>(
                    'SERP',
                    { query },
                    { companyId, maxTier: 2 }
                );
                providersSeen.add(routeResult.provider);
                for (const result of routeResult.data || []) {
                    if (result?.url && !collected.has(result.url)) {
                        collected.set(result.url, result);
                    }
                }
            }
        } catch {
            return null;
        }

        const bestResult = pickFinancialSearchResult([...collected.values()], selectionContext);
        if (!bestResult) {
            return null;
        }

        const bestScore = scoreFinancialSearchResult(bestResult, selectionContext);
        if (bestScore < 4) {
            return null;
        }

        // We only extract the URL footprint here. Actually downloading and parsing the PDF
        // via Vision API/LLM would happen in the MasterPipeline during Enrichment Phase if the
        // source_url is populated.

        // We can do a rudimentary regex check on the snippet if Google gave us a snippet with numbers
        let fatturato: number | undefined;
        let anno: number | undefined;

        const snippet = (bestResult.snippet || '').toLowerCase();

        // Very basic heuristic for snippets like "Fatturato 2023: € 1.500.000"
        const fattMatch = snippet.match(/fatturato.*?(?:[€]\s*|eur\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
        if (fattMatch) {
            fatturato = parseFloat(fattMatch[1].replace(/\./g, '').replace(/,/g, '.'));
        }

        const annoMatch = snippet.match(/(?:al\s+|bilancio\s+)?(20[1-2][0-9])/);
        if (annoMatch) {
            anno = parseInt(annoMatch[1], 10);
        }

        return {
            fatturato_current: fatturato,
            year: anno,
            source_url: bestResult.url,
            source_provider: [...providersSeen][0] || 'financial_serp',
            confidence: Math.max(0.45, Math.min(0.92, Number((0.45 + (bestScore / 20)).toFixed(2)))),
        };
    }
}
