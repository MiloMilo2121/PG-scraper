import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickFinancialSearchResult, scoreFinancialSearchResult, SearchResultLike } from './search_result_selectors';

type FinancialSourceTrust = 'high' | 'medium' | 'low';
type FinancialEntityMatchStatus = 'matched' | 'semantic' | 'ambiguous';
type FinancialQueryKind = 'vat_document' | 'company_document' | 'directory' | 'registry' | 'company_financial';

export interface FinancialData {
    fatturato_current?: number;
    fatturato_previous?: number;
    utile_netto?: number;
    year?: number;
    source_url?: string;
    source_provider?: string;
    confidence?: number;
    source_trust?: FinancialSourceTrust;
    entity_match_status?: FinancialEntityMatchStatus;
    attempted_queries?: number;
    candidate_count?: number;
}

interface FinancialSearchCandidate {
    result: SearchResultLike;
    providers: Set<string>;
    queryKinds: Set<FinancialQueryKind>;
    hitCount: number;
    baseScore: number;
    score: number;
    revenue?: number;
    year?: number;
    sourceTrust?: FinancialSourceTrust;
    entityMatchStatus?: FinancialEntityMatchStatus;
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

    private buildFinancialQueryPlan(input: NormalizedInput): Array<{ query: string; kind: FinancialQueryKind }> {
        const queries = this.sanitizer.buildQueryVariants(input, 'bilancio', input.vat_code);
        const plan: Array<{ query: string; kind: FinancialQueryKind }> = [];
        const seen = new Set<string>();

        const primaryName = this.sanitizer.sanitizeForQuery(
            input.company_name_variants?.[0] || input.company_name || ''
        );
        const cleanCity = this.sanitizer.sanitizeForQuery(input.city || '');
        const cleanProvince = this.sanitizer.sanitizeForQuery(input.provincia || '');
        const locationQuery = [cleanCity, cleanProvince].filter(Boolean).join(' ');

        const push = (query: string | null | undefined, kind: FinancialQueryKind) => {
            if (!query) {
                return;
            }

            const normalized = query.replace(/\s+/g, ' ').trim();
            if (!normalized || seen.has(normalized)) {
                return;
            }

            seen.add(normalized);
            plan.push({ query: normalized, kind });
        };

        for (const query of queries) {
            let kind: FinancialQueryKind = 'company_financial';

            if (query.includes('site:fatturatoitalia.it')) {
                kind = 'directory';
            } else if (query.includes('site:registroimprese.it')) {
                kind = 'registry';
            } else if (query.includes('filetype:pdf')) {
                kind = input.vat_code ? 'vat_document' : 'company_document';
            }

            push(query, kind);
        }

        if (primaryName) {
            push(
                `"${primaryName}" ${locationQuery} (ricavi OR fatturato OR dipendenti OR EBITDA OR utile)`,
                'company_financial'
            );
            push(
                `site:registroimprese.it "${primaryName}" ${locationQuery} (bilancio OR fatturato OR dipendenti)`,
                'registry'
            );
        }

        return plan.slice(0, 6);
    }

    private normalizeCandidateKey(url: string): string {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
            const path = parsed.pathname.replace(/\/+$/, '').toLowerCase() || '/';
            return `${host}${path}`;
        } catch {
            return url.toLowerCase();
        }
    }

    private parseFinancialSnippet(result: SearchResultLike): Pick<FinancialData, 'fatturato_current' | 'year'> {
        const snippet = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();

        const parseAmount = (raw: string | undefined): number | undefined => {
            if (!raw) {
                return undefined;
            }

            const compact = raw.replace(/\s+/g, '');
            const millionMatch = compact.match(/(\d+(?:[.,]\d+)?)\s*(mln|milioni?)/i);
            if (millionMatch) {
                return Math.round(parseFloat(millionMatch[1].replace(',', '.')) * 1_000_000);
            }

            const cleaned = compact.replace(/[^\d.,]/g, '');
            if (!cleaned) {
                return undefined;
            }

            const lastDot = cleaned.lastIndexOf('.');
            const lastComma = cleaned.lastIndexOf(',');
            const decimalIndex = Math.max(lastDot, lastComma);
            const hasDecimal = decimalIndex > -1 && cleaned.length - decimalIndex <= 3;
            const normalized = hasDecimal
                ? `${cleaned.slice(0, decimalIndex).replace(/[.,]/g, '')}.${cleaned.slice(decimalIndex + 1)}`
                : cleaned.replace(/[.,]/g, '');
            const value = Number.parseFloat(normalized);

            return Number.isFinite(value) && value >= 1000 ? Math.round(value) : undefined;
        };

        const amountMatch =
            snippet.match(/(?:fatturato|ricavi|valore della produzione|volume d'affari)[^€\d]{0,20}(?:€|eur)?\s*([\d.,\s]+(?:mln|milioni?)?)/i)
            || snippet.match(/(?:€|eur)\s*([\d.,\s]+(?:mln|milioni?)?)/i);
        const yearMatch = snippet.match(/\b(20[1-3]\d)\b/);

        return {
            fatturato_current: parseAmount(amountMatch?.[1]),
            year: yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined,
        };
    }

    private countMatches(haystack: string, values: string[]): number {
        return values.filter((value) => value && haystack.includes(value.toLowerCase())).length;
    }

    private computeEntityMatchStatus(result: SearchResultLike, context: ReturnType<BilancioHunter['buildSelectionContext']>): FinancialEntityMatchStatus {
        const haystack = `${result.title || ''} ${result.snippet || ''} ${result.url || ''}`.toLowerCase();
        const companyMatches = this.countMatches(haystack, context.companyTokens);
        const locationMatches = this.countMatches(haystack, context.locationTokens);
        const vatMatched = Boolean(context.vat && haystack.replace(/\D/g, '').includes(context.vat.replace(/\D/g, '')));

        if (vatMatched || (companyMatches >= 2 && locationMatches >= 1)) {
            return 'matched';
        }
        if (companyMatches >= 1) {
            return 'semantic';
        }
        return 'ambiguous';
    }

    private computeSourceTrust(candidate: FinancialSearchCandidate, context: ReturnType<BilancioHunter['buildSelectionContext']>): FinancialSourceTrust {
        const url = candidate.result.url || '';
        const haystack = `${candidate.result.title || ''} ${candidate.result.snippet || ''} ${url}`.toLowerCase();
        const vatMatched = Boolean(context.vat && haystack.replace(/\D/g, '').includes(context.vat.replace(/\D/g, '')));
        const isDirectory = url.includes('fatturatoitalia.it');
        const isRegistry = url.includes('registroimprese.it') || url.includes('telemaco');
        const isPdf = /\.pdf(?:$|\?)/i.test(url);

        if ((isDirectory || isRegistry) && vatMatched) {
            return 'high';
        }
        if (candidate.hitCount >= 2 && candidate.entityMatchStatus === 'matched') {
            return 'high';
        }
        if ((isPdf || isDirectory || isRegistry) && candidate.entityMatchStatus !== 'ambiguous') {
            return 'medium';
        }
        return 'low';
    }

    private getQueryKindBonus(queryKinds: Set<FinancialQueryKind>): number {
        let bonus = 0;

        if (queryKinds.has('directory')) {
            bonus += 2.5;
        }
        if (queryKinds.has('registry')) {
            bonus += 2.2;
        }
        if (queryKinds.has('vat_document')) {
            bonus += 1.8;
        }
        if (queryKinds.has('company_document')) {
            bonus += 1.3;
        }
        if (queryKinds.has('company_financial')) {
            bonus += 0.9;
        }

        return bonus;
    }

    public async hunt(companyId: string, input: NormalizedInput): Promise<FinancialData | null> {
        const queryPlan = this.buildFinancialQueryPlan(input);
        if (queryPlan.length === 0) {
            return null;
        }

        const selectionContext = this.buildSelectionContext(input);
        const collected = new Map<string, FinancialSearchCandidate>();
        let attemptedQueries = 0;

        for (const { query, kind } of queryPlan) {
            attemptedQueries += 1;
            try {
                const routeResult = await this.router.route<Array<{ url: string; title: string; snippet?: string }>>(
                    'SERP',
                    { query },
                    { companyId, maxTier: 2 }
                );

                for (const result of routeResult.data || []) {
                    if (!result?.url) {
                        continue;
                    }

                    const key = this.normalizeCandidateKey(result.url);
                    const existing = collected.get(key);

                    if (existing) {
                        existing.hitCount += 1;
                        existing.providers.add(routeResult.provider);
                        existing.queryKinds.add(kind);
                        existing.baseScore = Math.max(existing.baseScore, scoreFinancialSearchResult(result, selectionContext));
                        if ((result.snippet?.length || 0) > (existing.result.snippet?.length || 0)) {
                            existing.result = result;
                        }
                    } else {
                        collected.set(key, {
                            result,
                            providers: new Set([routeResult.provider]),
                            queryKinds: new Set([kind]),
                            hitCount: 1,
                            baseScore: scoreFinancialSearchResult(result, selectionContext),
                            score: 0,
                        });
                    }
                }
            } catch {
                continue;
            }
        }

        if (collected.size === 0) {
            return null;
        }

        const rankedCandidates = [...collected.values()]
            .map((candidate) => {
                const parsed = this.parseFinancialSnippet(candidate.result);
                const entityMatchStatus = this.computeEntityMatchStatus(candidate.result, selectionContext);
                const score =
                    candidate.baseScore
                    + this.getQueryKindBonus(candidate.queryKinds)
                    + Math.max(0, candidate.hitCount - 1) * 1.2
                    + Math.max(0, candidate.providers.size - 1) * 0.4
                    + (parsed.fatturato_current ? 1.6 : 0)
                    + (parsed.year ? 0.4 : 0)
                    + (entityMatchStatus === 'matched' ? 1 : entityMatchStatus === 'semantic' ? 0.35 : -0.75);

                return {
                    ...candidate,
                    revenue: parsed.fatturato_current,
                    year: parsed.year,
                    score,
                    entityMatchStatus,
                };
            })
            .map((candidate) => ({
                ...candidate,
                sourceTrust: this.computeSourceTrust(candidate, selectionContext),
            }))
            .sort((a, b) => b.score - a.score);

        const bestCandidate = rankedCandidates[0] || null;
        const bestRankedBySelector = pickFinancialSearchResult(
            rankedCandidates.map((candidate) => candidate.result),
            selectionContext
        );
        const chosenCandidate = rankedCandidates.find((candidate) => candidate.result.url === bestRankedBySelector?.url) || bestCandidate;

        const bestNumericCandidate = rankedCandidates.find((candidate) => candidate.revenue || candidate.year);
        const shouldPromoteNumericCandidate = Boolean(
            bestNumericCandidate
            && chosenCandidate
            && !chosenCandidate.revenue
            && bestNumericCandidate.score >= chosenCandidate.score - 3.5
        );
        const finalCandidate = shouldPromoteNumericCandidate ? bestNumericCandidate : chosenCandidate;

        if (!finalCandidate) {
            return null;
        }

        const minimumScore = finalCandidate.sourceTrust === 'high' ? 4.2 : 5;
        if (finalCandidate.score < minimumScore) {
            return null;
        }

        const trustBase = finalCandidate.sourceTrust === 'high' ? 0.8 : finalCandidate.sourceTrust === 'medium' ? 0.66 : 0.52;
        const confidence = Math.max(
            trustBase,
            Math.min(0.94, Number((trustBase + (finalCandidate.score / 24)).toFixed(2)))
        );

        return {
            fatturato_current: finalCandidate.revenue,
            year: finalCandidate.year,
            source_url: finalCandidate.result.url,
            source_provider: [...finalCandidate.providers][0] || 'financial_serp',
            confidence,
            source_trust: finalCandidate.sourceTrust,
            entity_match_status: finalCandidate.entityMatchStatus,
            attempted_queries: attemptedQueries,
            candidate_count: rankedCandidates.length,
        };
    }
}
