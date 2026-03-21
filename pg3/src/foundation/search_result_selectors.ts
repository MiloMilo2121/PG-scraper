export interface SearchResultLike {
    title?: string;
    url?: string;
    snippet?: string;
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

export function pickLinkedInProfileResult(results: SearchResultLike[]): SearchResultLike | null {
    return results.find((result) => isLinkedInProfileUrl(result.url)) || null;
}

export function pickFinancialSearchResult(results: SearchResultLike[]): SearchResultLike | null {
    return (
        results.find((result) => normalizeUrl(result.url).endsWith('.pdf'))
        || results.find((result) => looksLikeFinancialDocument(result))
        || results[0]
        || null
    );
}
