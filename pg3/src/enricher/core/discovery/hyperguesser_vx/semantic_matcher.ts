import { CompanyInput } from '../../../types';
import { ContentFilter } from '../content_filter';
import { FetchedCandidate } from './fetcher';

export interface SemanticWebsiteMatch {
    selected_url: string;
    confidence: number;
    reason: string;
    domain: string;
}

export function selectBestSemanticCandidate(
    company: CompanyInput,
    candidates: FetchedCandidate[],
    minScore = 0.72,
): SemanticWebsiteMatch | null {
    const scored = candidates
        .map((candidate) => ({
            candidate,
            score: scoreFetchedCandidate(company, candidate),
        }))
        .sort((left, right) => right.score - left.score);

    const best = scored[0];
    if (!best || best.score < minScore) {
        return null;
    }

    return {
        selected_url: best.candidate.url,
        confidence: Number(Math.min(0.89, best.score).toFixed(2)),
        reason: 'Deterministic semantic match selected the strongest company/title/domain candidate.',
        domain: best.candidate.domain,
    };
}

export function scoreFetchedCandidate(company: CompanyInput, candidate: FetchedCandidate): number {
    const title = normalizeFreeText(candidate.title || '');
    const body = normalizeFreeText(candidate.text || '');
    const companyTokens = companyNameTokens(company.company_name || '');
    const compactVariants = companyCompactVariants(company.company_name || '');

    const titleMatches = companyTokens.filter((token) => title.includes(token));
    const bodyMatches = companyTokens.filter((token) => body.includes(token));

    let score = 0;

    if (companyTokens.length > 0) {
        score += (titleMatches.length / companyTokens.length) * 0.45;
        score += (bodyMatches.length / companyTokens.length) * 0.25;
    }

    const domainSlug = extractDomainSlug(candidate.url);
    if (compactVariants.some((variant) => domainSlug === variant)) {
        score += 0.30;
    } else if (compactVariants.some((variant) => domainSlug.includes(variant) || variant.includes(domainSlug))) {
        score += 0.18;
    }

    const locationSignals = [company.city, company.province]
        .filter(Boolean)
        .map((value) => normalizeFreeText(value || ''))
        .filter((value) => value.length >= 2);
    if (locationSignals.some((signal) => signal && (title.includes(signal) || body.includes(signal)))) {
        score += 0.10;
    }

    const phoneDigits = normalizeDigits(company.phone || '');
    if (phoneDigits.length >= 6) {
        const bodyDigits = normalizeDigits(candidate.text || '');
        if (bodyDigits.includes(phoneDigits)) {
            score += 0.12;
        }
    }

    const addressSignals = normalizeAddressSignals(company.address || '');
    if (addressSignals.some((signal) => signal && (title.includes(signal) || body.includes(signal)))) {
        score += 0.08;
    }

    if (ContentFilter.isDirectoryOrSocial(candidate.url)) {
        score -= 0.60;
    }
    if (ContentFilter.isDirectoryLikeTitle(candidate.title || '')) {
        score -= 0.20;
    }

    return Math.max(0, score);
}

function companyNameTokens(companyName: string): string[] {
    return Array.from(new Set(
        normalizeFreeText(companyName)
            .replace(/\b(srl|spa|snc|sas|societa|unipersonale|in liquidazione)\b/gi, ' ')
            .split(/\s+/)
            .filter((token) => token.length >= 4),
    ));
}

function companyCompactVariants(companyName: string): string[] {
    const normalized = normalizeFreeText(companyName)
        .replace(/\b(srl|spa|snc|sas|societa|unipersonale|in liquidazione)\b/gi, ' ')
        .trim();

    const compact = normalized.replace(/\s+/g, '');
    const tokens = normalized.split(/\s+/).filter((token) => token.length >= 4);
    const firstTwo = tokens.slice(0, 2).join('');

    return Array.from(new Set([compact, firstTwo].filter((variant) => variant.length >= 4)));
}

function extractDomainSlug(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').split('.')[0].toLowerCase();
    } catch {
        return '';
    }
}

function normalizeFreeText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDigits(value: string): string {
    return value.replace(/\D+/g, '');
}

function normalizeAddressSignals(address: string): string[] {
    const stopwords = new Set(['via', 'viale', 'piazza', 'corso', 'largo', 'vicolo', 'strada', 'numero', 'civico']);

    return normalizeFreeText(address)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !stopwords.has(token));
}
