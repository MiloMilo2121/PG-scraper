export interface SearchResultLike {
    title?: string;
    url?: string;
    snippet?: string;
}

export interface SearchSelectionContext {
    companyTokens?: string[];
    locationTokens?: string[];
    domainTokens?: string[];
    roleTokens?: string[];
    vat?: string;
}

function normalizeUrl(url?: string): string {
    if (!url) {
        return '';
    }

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        return `${hostname}${parsed.pathname}`.toLowerCase();
    } catch {
        return url.toLowerCase();
    }
}

function isLinkedInProfileUrl(url?: string): boolean {
    const normalized = normalizeUrl(url);
    return normalized.includes('linkedin.com/in/');
}

function normalizeHaystack(result: SearchResultLike): string {
    return `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
}

function countTokenMatches(haystack: string, tokens: string[] = []): number {
    return tokens.filter((token) => token && haystack.includes(token.toLowerCase())).length;
}

function getHostname(url?: string): string {
    if (!url) {
        return '';
    }

    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

function looksLikeFinancialDocument(result: SearchResultLike): boolean {
    const url = normalizeUrl(result.url);
    if (url.endsWith('.pdf')) {
        return true;
    }

    const haystack = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
    return haystack.includes('bilancio')
        || haystack.includes('fatturato')
        || haystack.includes('stato patrimoniale');
}

function looksLikeLowTrustFinancialResult(result: SearchResultLike): boolean {
    const haystack = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
    const hostname = getHostname(result.url);
    return haystack.includes('fac simile')
        || haystack.includes('modello')
        || haystack.includes('sample')
        || hostname.includes('slideshare')
        || hostname.includes('scribd')
        || hostname.includes('studocu');
}

export function scoreLinkedInProfileResult(result: SearchResultLike, context?: SearchSelectionContext): number {
    if (!isLinkedInProfileUrl(result.url)) {
        return Number.NEGATIVE_INFINITY;
    }

    const haystack = normalizeHaystack(result);
    let score = 8;
    score += countTokenMatches(haystack, context?.companyTokens) * 2.5;
    score += countTokenMatches(haystack, context?.locationTokens) * 1.5;
    score += countTokenMatches(haystack, context?.domainTokens) * 1.25;
    score += countTokenMatches(haystack, context?.roleTokens) * 1.25;

    if (haystack.includes('recruiter') || haystack.includes('talent acquisition')) {
        score -= 4;
    }
    if (haystack.includes('student') || haystack.includes('intern')) {
        score -= 2;
    }
    if (haystack.includes('former') || haystack.includes('ex ') || haystack.includes('freelance')) {
        score -= 2.5;
    }
    if (haystack.includes('branch manager') || haystack.includes('responsabile')) {
        score += 1.5;
    }

    return score;
}

export function pickLinkedInProfileResult(results: SearchResultLike[], context?: SearchSelectionContext): SearchResultLike | null {
    return [...results]
        .filter((result) => isLinkedInProfileUrl(result.url))
        .sort((a, b) => scoreLinkedInProfileResult(b, context) - scoreLinkedInProfileResult(a, context))[0] || null;
}

export function scoreFinancialSearchResult(result: SearchResultLike, context?: SearchSelectionContext): number {
    const haystack = normalizeHaystack(result);
    const normalizedUrl = normalizeUrl(result.url);
    const hostname = getHostname(result.url);
    let score = 0;

    if (normalizedUrl.endsWith('.pdf')) {
        score += 4;
    }
    if (looksLikeFinancialDocument(result)) {
        score += 3;
    }
    if (hostname.includes('fatturatoitalia.it')) {
        score += 5;
    }
    if (hostname.includes('registroimprese.it') || hostname.includes('telemaco')) {
        score += 4;
    }

    score += countTokenMatches(haystack, context?.companyTokens) * 1.75;
    score += countTokenMatches(haystack, context?.locationTokens) * 1.1;

    if (context?.vat && haystack.replace(/\D/g, '').includes(context.vat.replace(/\D/g, ''))) {
        score += 3;
    }

    if (hostname.includes('ufficiocamerale.it') || hostname.includes('reportaziende.it')) {
        score += 2;
    }

    if (looksLikeLowTrustFinancialResult(result)) {
        score -= 3;
    }

    return score;
}

export function pickFinancialSearchResult(results: SearchResultLike[], context?: SearchSelectionContext): SearchResultLike | null {
    return [...results]
        .sort((a, b) => scoreFinancialSearchResult(b, context) - scoreFinancialSearchResult(a, context))[0] || null;
}
