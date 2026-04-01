export interface EmailInferenceResult {
    domain: string;
    candidates: string[];
    inferredEmail: string;
    mode: 'website_mx' | 'company_guess_mx';
    confidence: number;
}

const DOMAIN_DENYLIST = new Set([
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'paginegialle.it',
    'casa.it',
    'immobiliare.it',
    'idealista.it',
    'wikicasa.it',
    'subito.it',
    'bakeca.it',
    'tecnocasa.it',
    'tecnocasa.com',
    'tempocasa.it',
    'gruppovendocasa.it',
    'gov.it',
    'gmail.com',
    'libero.it',
    'virgilio.it',
    'alice.it',
    'outlook.com',
    'hotmail.com',
]);

const CORPORATE_PREFIX_WEIGHTS: Array<[string, number]> = [
    ['info', 10],
    ['agenzia', 8],
    ['studio', 7],
    ['contatti', 6],
    ['contact', 5],
    ['commerciale', 4],
    ['amministrazione', 4],
    ['office', 3],
    ['hello', 2],
];

export function getHostname(value: string | undefined): string {
    try {
        if (!value) {
            return '';
        }
        return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

export function getRegistrableDomain(host: string): string {
    const cleaned = host.replace(/^www\./, '').toLowerCase();
    const parts = cleaned.split('.').filter(Boolean);
    if (parts.length <= 2) {
        return cleaned;
    }

    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const useThreePartSuffix = last.length === 2 && secondLast.length <= 3;
    return useThreePartSuffix
        ? parts.slice(-3).join('.')
        : parts.slice(-2).join('.');
}

export function isInferenceSafeDomain(domain: string): boolean {
    if (!domain) {
        return false;
    }
    return !DOMAIN_DENYLIST.has(domain.toLowerCase());
}

export function normalizeCompanyName(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\b(srl|s\.r\.l|spa|s\.p\.a|snc|sas|sapa|srls|societa|societa a responsabilita limitata|societa a responsabilita limitata semplificata)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildGenericEmailCandidates(companyName: string, domain: string): string[] {
    const normalizedCompany = normalizeCompanyName(companyName);
    const domainLabel = domain.split('.')[0].replace(/[^a-z0-9-]/g, '');
    const weighted = new Map<string, number>();

    for (const [prefix, baseWeight] of CORPORATE_PREFIX_WEIGHTS) {
        let score = baseWeight;
        if (normalizedCompany.includes(prefix)) {
            score += 4;
        }
        weighted.set(`${prefix}@${domain}`, score);
    }

    if (domainLabel && domainLabel.length >= 4 && domainLabel.length <= 24) {
        const brandLocal = domainLabel.replace(/-/g, '');
        weighted.set(`${brandLocal}@${domain}`, 5);
    }

    return [...weighted.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([candidate]) => candidate);
}

export async function inferEmailFromDomain(
    companyName: string,
    domain: string,
    mode: 'website_mx' | 'company_guess_mx',
    resolveMx: (domain: string) => Promise<unknown[]>,
): Promise<EmailInferenceResult | null> {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!isInferenceSafeDomain(normalizedDomain)) {
        return null;
    }

    try {
        const records = await resolveMx(normalizedDomain);
        if (!records || records.length === 0) {
            return null;
        }
    } catch {
        return null;
    }

    const candidates = buildGenericEmailCandidates(companyName, normalizedDomain);
    if (candidates.length === 0) {
        return null;
    }

    return {
        domain: normalizedDomain,
        candidates,
        inferredEmail: candidates[0],
        mode,
        confidence: mode === 'website_mx' ? 0.45 : 0.35,
    };
}
