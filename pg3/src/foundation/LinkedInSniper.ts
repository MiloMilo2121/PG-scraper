import { NormalizedInput } from './InputNormalizer';
import { QuerySanitizer } from './QuerySanitizer';
import { CostRouter } from './CostRouter';
import { pickLinkedInProfileResult, scoreLinkedInProfileResult, SearchResultLike } from './search_result_selectors';

type DecisionMakerEntityMatchStatus = 'matched' | 'semantic' | 'ambiguous' | 'unknown';

export interface DecisionMaker {
    name?: string;
    role?: string;
    linkedin_url?: string;
    source?: string;
    source_kind?: 'linkedin_profile' | 'company_site';
    confidence: number;
    attempted_count?: number;
    evidence_count?: number;
    entity_match_status?: DecisionMakerEntityMatchStatus;
    supporting_urls?: string[];
    providers?: string[];
}

export interface DecisionMakerSnipeResult {
    decisionMaker: DecisionMaker | null;
    attempted_count: number;
    evidence_count: number;
    entity_match_status: DecisionMakerEntityMatchStatus;
    providers: string[];
    detail: string;
}

interface SearchPlanEntry {
    query: string;
    kind: 'linkedin' | 'website_people' | 'general_people';
}

interface CollectedResult {
    result: SearchResultLike;
    providers: Set<string>;
    kinds: Set<SearchPlanEntry['kind']>;
    occurrences: number;
}

interface RankedDecisionMakerCandidate {
    decisionMaker: DecisionMaker;
    score: number;
    entityMatchStatus: DecisionMakerEntityMatchStatus;
}

export class LinkedInSniper {
    private router: CostRouter;
    private sanitizer = new QuerySanitizer();
    private static readonly rolePattern = /(titolare|founder|co-founder|ceo|owner|amministratore(?:\s+delegato)?|presidente|managing director|branch manager|responsabile(?:\s+agenzia)?|socio)/i;
    private static readonly roleKeywords = ['titolare', 'founder', 'co-founder', 'ceo', 'owner', 'amministratore', 'presidente', 'managing director', 'branch manager', 'responsabile agenzia', 'socio'];
    private static readonly websitePeoplePaths = ['chi-siamo', 'chi_siamo', 'team', 'staff', 'agenzia', 'about', 'azienda', 'profilo'];
    private static readonly noisyPeopleTerms = ['recruiter', 'talent acquisition', 'student', 'intern', 'hr manager', 'consulente'];

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

    private buildSearchPlan(input: NormalizedInput, discoveredUrl?: string | null): SearchPlanEntry[] {
        const plan: SearchPlanEntry[] = [];
        const seen = new Set<string>();
        const linkedinQueries = this.sanitizer.buildQueryVariants(input, 'linkedin');
        const primaryName = this.sanitizer.sanitizeForQuery(input.company_name_variants?.[0] || input.company_name);
        const locationQuery = [input.city, input.provincia].filter(Boolean).join(' ').trim();
        const roleClause = '(Titolare OR Founder OR CEO OR Owner OR Amministratore OR Presidente)';

        const pushPlan = (query: string | null | undefined, kind: SearchPlanEntry['kind']) => {
            const normalized = query?.trim().replace(/\s+/g, ' ');
            if (!normalized || seen.has(normalized)) {
                return;
            }

            seen.add(normalized);
            plan.push({ query: normalized, kind });
        };

        for (const query of linkedinQueries) {
            pushPlan(query, 'linkedin');
        }

        const websiteHost = this.extractHost(discoveredUrl || input.website);
        const websiteRoot = this.toRegistrableDomain(websiteHost);
        const websiteBrand = this.extractWebsiteBrandToken(discoveredUrl || input.website);

        if (websiteHost && primaryName) {
            pushPlan(`site:${websiteHost} "${primaryName}" ${locationQuery} ${roleClause}`, 'website_people');
            pushPlan(`site:${websiteHost} ("chi siamo" OR team OR staff OR agenzia OR about) ${roleClause}`, 'website_people');
        }

        if (websiteRoot && primaryName) {
            pushPlan(`site:linkedin.com/in "${primaryName}" ${locationQuery} "${websiteRoot}"`, 'linkedin');
            pushPlan(`"${primaryName}" ${locationQuery} ${roleClause} "${websiteRoot}"`, 'general_people');
        }

        if (websiteBrand) {
            pushPlan(`site:linkedin.com/in "${websiteBrand}" ${locationQuery} ${roleClause}`, 'linkedin');
            pushPlan(`"${websiteBrand}" ${locationQuery} ${roleClause}`, 'general_people');
        }

        if (primaryName) {
            pushPlan(`"${primaryName}" ${locationQuery} ${roleClause}`, 'general_people');
            pushPlan(`"${primaryName}" ${locationQuery} ("chi siamo" OR team OR staff OR agenzia)`, 'general_people');
        }

        return plan.slice(0, 8);
    }

    private extractHost(candidate?: string | null): string | null {
        if (!candidate) {
            return null;
        }

        try {
            return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            return null;
        }
    }

    private toRegistrableDomain(hostname?: string | null): string | null {
        if (!hostname) {
            return null;
        }

        const parts = hostname.split('.').filter(Boolean);
        if (parts.length < 2) {
            return hostname;
        }

        return parts.slice(-2).join('.');
    }

    private extractWebsiteBrandToken(candidate?: string | null): string | null {
        const host = this.extractHost(candidate);
        if (!host) {
            return null;
        }

        const root = this.toRegistrableDomain(host) || host;
        const base = root.split('.')[0] || '';
        const tokens = base
            .split(/[-_]/)
            .map((token) => token.trim().toLowerCase())
            .filter((token) => token.length >= 4 && !/^(www|gruppo|holding|immobiliare)$/.test(token));

        return tokens[0] || (base.length >= 4 ? base : null);
    }

    private countTokenMatches(haystack: string, tokens: string[] = []): number {
        return tokens.filter((token) => token && haystack.includes(token.toLowerCase())).length;
    }

    private normalizeRole(text?: string): string | undefined {
        if (!text) {
            return undefined;
        }

        const match = text.match(LinkedInSniper.rolePattern);
        if (!match?.[1]) {
            return undefined;
        }

        return match[1].replace(/\s+/g, ' ').trim();
    }

    private isLikelyPersonName(name: string, companyTokens: string[]): boolean {
        const normalized = name.trim().replace(/\s+/g, ' ');
        if (!normalized || normalized.length < 5 || normalized.length > 80) {
            return false;
        }

        const words = normalized.split(' ').filter(Boolean);
        if (words.length < 2 || words.length > 4) {
            return false;
        }

        const blockedTerms = new Set([
            ...companyTokens,
            'linkedin',
            'immobiliare',
            'agenzia',
            'gruppo',
            'srl',
            'spa',
            'snc',
            'sas',
            'contatti',
            'staff',
            'team',
        ]);

        const alphaWords = words.filter((word) => /[A-Za-zÀ-ÿ]/.test(word));
        if (alphaWords.length !== words.length) {
            return false;
        }

        const capitalizedWords = words.filter((word) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+$/u.test(word));
        if (capitalizedWords.length < 2) {
            return false;
        }

        return !words.some((word) => blockedTerms.has(word.toLowerCase()));
    }

    private extractNameFromLinkedInUrl(url?: string): string | null {
        if (!url) {
            return null;
        }

        try {
            const parsed = new URL(url);
            const slug = parsed.pathname.split('/').filter(Boolean)[1] || '';
            const cleaned = slug
                .replace(/-\d+$/, '')
                .split('-')
                .map((token) => token.trim())
                .filter((token) => token.length >= 2 && !/^[0-9]+$/.test(token))
                .slice(0, 3)
                .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
                .join(' ');

            return cleaned || null;
        } catch {
            return null;
        }
    }

    private extractNameFromText(text: string, companyTokens: string[]): string | null {
        const patterns = [
            /(?:titolare|founder|co-founder|ceo|owner|amministratore(?:\s+delegato)?|presidente|responsabile(?:\s+agenzia)?|socio)\s*[:\-–|,]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+){1,2})/u,
            /([A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+){1,2})\s*[-–|,]\s*(?:titolare|founder|co-founder|ceo|owner|amministratore(?:\s+delegato)?|presidente|responsabile(?:\s+agenzia)?|socio)/u,
            /\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+){1,2})\b/u,
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            const candidate = match?.[1]?.trim();
            if (candidate && this.isLikelyPersonName(candidate, companyTokens)) {
                return candidate;
            }
        }

        return null;
    }

    private inferEntityMatchStatus(score: number): DecisionMakerEntityMatchStatus {
        if (score >= 14) {
            return 'matched';
        }
        if (score >= 10) {
            return 'semantic';
        }
        if (score >= 7) {
            return 'ambiguous';
        }
        return 'unknown';
    }

    private collectResult(
        collected: Map<string, CollectedResult>,
        result: SearchResultLike,
        provider: string,
        kind: SearchPlanEntry['kind'],
    ) {
        if (!result?.url) {
            return;
        }

        const existing = collected.get(result.url);
        if (existing) {
            existing.occurrences += 1;
            existing.providers.add(provider);
            existing.kinds.add(kind);
            if (!existing.result.snippet && result.snippet) {
                existing.result.snippet = result.snippet;
            }
            if (!existing.result.title && result.title) {
                existing.result.title = result.title;
            }
            return;
        }

        collected.set(result.url, {
            result: { ...result },
            providers: new Set([provider]),
            kinds: new Set([kind]),
            occurrences: 1,
        });
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
            source_kind: 'linkedin_profile',
            confidence,
        };
    }

    private rankLinkedInCandidate(
        collected: CollectedResult,
        selectionContext: ReturnType<LinkedInSniper['buildSelectionContext']>,
    ): RankedDecisionMakerCandidate | null {
        const best = pickLinkedInProfileResult([collected.result], selectionContext);
        if (!best) {
            return null;
        }

        const baseScore = scoreLinkedInProfileResult(best, selectionContext);
        let score = baseScore + Math.min(2, (collected.occurrences - 1) * 0.75);
        if (collected.kinds.has('linkedin')) {
            score += 1;
        }
        if (collected.kinds.has('general_people')) {
            score += 0.5;
        }

        const entityMatchStatus = this.inferEntityMatchStatus(score);
        if (score < 9) {
            return null;
        }

        const normalizedConfidence = Math.max(0.58, Math.min(0.97, Number((0.54 + (score / 20)).toFixed(2))));
        const extracted = this.extractDecisionMaker(best, normalizedConfidence, [...collected.providers][0] || 'linkedin_serp');
        if (!extracted) {
            return null;
        }

        const fallbackName = this.extractNameFromLinkedInUrl(best.url);
        if (!extracted.name && fallbackName) {
            extracted.name = fallbackName;
        }
        if (!extracted.name || !this.isLikelyPersonName(extracted.name, selectionContext.companyTokens)) {
            return null;
        }

        extracted.attempted_count = undefined;
        extracted.evidence_count = collected.occurrences;
        extracted.entity_match_status = entityMatchStatus;
        extracted.supporting_urls = [best.url || ''].filter(Boolean);
        extracted.providers = [...collected.providers];

        return {
            decisionMaker: extracted,
            score,
            entityMatchStatus,
        };
    }

    private rankWebsiteCandidate(
        collected: CollectedResult,
        selectionContext: ReturnType<LinkedInSniper['buildSelectionContext']>,
        rootDomain?: string | null,
    ): RankedDecisionMakerCandidate | null {
        const url = collected.result.url || '';
        const hostname = this.extractHost(url);
        if (!hostname) {
            return null;
        }

        const registrableDomain = this.toRegistrableDomain(hostname);
        if (rootDomain && registrableDomain !== rootDomain && hostname !== rootDomain) {
            return null;
        }

        const haystack = `${collected.result.title || ''} ${collected.result.snippet || ''}`.trim();
        const haystackLower = haystack.toLowerCase();
        const role = this.normalizeRole(haystack);
        const companyMatches = this.countTokenMatches(haystackLower, selectionContext.companyTokens);
        const locationMatches = this.countTokenMatches(haystackLower, selectionContext.locationTokens);
        const domainMatches = this.countTokenMatches(haystackLower, selectionContext.domainTokens);
        const roleMatches = role ? 1 : this.countTokenMatches(haystackLower, selectionContext.roleTokens);
        const pathBoost = LinkedInSniper.websitePeoplePaths.some((token) => url.toLowerCase().includes(`/${token}`)) ? 2 : 0;

        if (companyMatches === 0 && roleMatches === 0) {
            return null;
        }

        const name = this.extractNameFromText(haystack, selectionContext.companyTokens);
        if (!name) {
            return null;
        }

        let score = 3;
        score += companyMatches * 2.25;
        score += locationMatches * 1.25;
        score += domainMatches * 1.5;
        score += roleMatches * 3;
        score += pathBoost;
        score += Math.min(2, (collected.occurrences - 1) * 0.75);
        if (collected.kinds.has('website_people')) {
            score += 1.5;
        }
        if (collected.providers.size > 1) {
            score += 0.5;
        }
        if (LinkedInSniper.noisyPeopleTerms.some((term) => haystackLower.includes(term))) {
            score -= 3;
        }

        if (score < 8.5) {
            return null;
        }

        const entityMatchStatus = this.inferEntityMatchStatus(score);
        const confidence = Math.max(0.56, Math.min(0.9, Number((0.5 + (score / 24)).toFixed(2))));

        return {
            decisionMaker: {
                name,
                role,
                linkedin_url: url,
                source: [...collected.providers][0] || 'website_serp',
                source_kind: 'company_site',
                confidence,
                evidence_count: collected.occurrences,
                entity_match_status: entityMatchStatus,
                supporting_urls: [url],
                providers: [...collected.providers],
            },
            score,
            entityMatchStatus,
        };
    }

    public async snipeDetailed(companyId: string, input: NormalizedInput, discoveredUrl?: string | null): Promise<DecisionMakerSnipeResult> {
        const queries = this.buildSearchPlan(input, discoveredUrl);
        if (queries.length === 0) {
            return {
                decisionMaker: null,
                attempted_count: 0,
                evidence_count: 0,
                entity_match_status: 'unknown',
                providers: [],
                detail: 'no decision-maker queries built',
            };
        }

        const selectionContext = this.buildSelectionContext(input, discoveredUrl);
        const collected = new Map<string, CollectedResult>();
        const providersSeen = new Set<string>();
        let attemptedCount = 0;

        for (const queryPlan of queries) {
            attemptedCount += 1;
            try {
                const routeResult = await this.router.route<Array<{ url: string; title: string; snippet?: string }>>(
                    'SERP',
                    { query: queryPlan.query },
                    { companyId, maxTier: 2 }
                );
                providersSeen.add(routeResult.provider);
                for (const result of routeResult.data || []) {
                    this.collectResult(collected, result, routeResult.provider, queryPlan.kind);
                }
            } catch {
                // Continue with other queries; partial failures should not zero out recall.
            }
        }

        const rootDomain = this.toRegistrableDomain(this.extractHost(discoveredUrl || input.website));
        const rankedCandidates: RankedDecisionMakerCandidate[] = [];

        for (const entry of collected.values()) {
            const linkedinCandidate = this.rankLinkedInCandidate(entry, selectionContext);
            if (linkedinCandidate) {
                rankedCandidates.push(linkedinCandidate);
                continue;
            }

            const websiteCandidate = this.rankWebsiteCandidate(entry, selectionContext, rootDomain);
            if (websiteCandidate) {
                rankedCandidates.push(websiteCandidate);
            }
        }

        rankedCandidates.sort((a, b) => b.score - a.score);
        const best = rankedCandidates[0];
        if (!best) {
            return {
                decisionMaker: null,
                attempted_count: attemptedCount,
                evidence_count: collected.size,
                entity_match_status: 'unknown',
                providers: [...providersSeen],
                detail: collected.size > 0 ? 'serp results collected but no credible person candidate' : 'no serp evidence returned',
            };
        }

        best.decisionMaker.attempted_count = attemptedCount;
        best.decisionMaker.evidence_count = collected.size;
        best.decisionMaker.entity_match_status = best.entityMatchStatus;
        best.decisionMaker.providers = [...providersSeen];

        return {
            decisionMaker: best.decisionMaker,
            attempted_count: attemptedCount,
            evidence_count: collected.size,
            entity_match_status: best.entityMatchStatus,
            providers: [...providersSeen],
            detail: best.decisionMaker.source_kind === 'company_site'
                ? 'decision maker inferred from company-site people signals'
                : 'decision maker found from linkedin search results',
        };
    }

    public async snipe(companyId: string, input: NormalizedInput, discoveredUrl?: string | null): Promise<DecisionMaker | null> {
        const result = await this.snipeDetailed(companyId, input, discoveredUrl);
        return result.decisionMaker;
    }
}
