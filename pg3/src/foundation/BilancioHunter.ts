import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickFinancialSearchResult } from './search_result_selectors';

export interface FinancialData {
    fatturato_current?: number;
    fatturato_previous?: number;
    utile_netto?: number;
    year?: number;
    source_url?: string;
}

export class BilancioHunter {
    private router: CostRouter;
    private sanitizer = new QuerySanitizer();

    constructor(router: CostRouter) {
        this.router = router;
    }

    public async hunt(companyId: string, input: NormalizedInput): Promise<FinancialData | null> {
        const query = this.sanitizer.buildCompanyQuery(input, {
            target: 'bilancio',
            fileType: 'filetype:pdf',
        });
        if (!query) {
            return null;
        }

        let bestResult: { url: string; title: string; snippet?: string } | null = null;
        try {
            const routeResult = await this.router.route<Array<{ url: string; title: string; snippet?: string }>>(
                'SERP',
                { query },
                { companyId, maxTier: 2 }
            );
            const selected = pickFinancialSearchResult(routeResult.data || []);
            if (selected?.url) {
                bestResult = {
                    url: selected.url,
                    title: selected.title || '',
                    snippet: selected.snippet,
                };
            }
        } catch {
            bestResult = null;
        }

        if (!bestResult) {
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
            source_url: bestResult.url
        };
    }
}
