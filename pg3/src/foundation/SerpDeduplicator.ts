import { CostRouter } from './CostRouter';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { NormalizedInput } from './InputNormalizer';
import { RateLimitError } from 'openai'; // or our own
import { PagineGialleHarvester } from '../enricher/core/directories/paginegialle';
import { ContentFilter } from '../enricher/core/discovery/content_filter';
import { InputWebsiteCandidate } from './InputWebsiteCandidate';

export interface CleanSearchResult {
    title: string;
    snippet: string;
    url: string;
    source: string;
    normalized_url: string;
    domain: string;
}

export interface SearchOutput {
    results: CleanSearchResult[];
    linkedin_buffered: number;
    queries_tried: string[];
    providers_used: string[];
}

const NOISE_DOMAINS = new Set([
    'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
    'paginegialle.it', 'infoimprese.it', 'registroimprese.it', 'tuttocitta.it',
    'google.com', 'youtube.com', 'tripadvisor.com', 'tiktok.com',
    'amazon.it', 'subito.it', 'ebay.it', 'kijiji.it',
    'kompass.com', 'europages.it', 'europages.com', 'cylex.it',
    'trovaprezzi.it', 'pinterest.com', 'pinterest.it',
    'yelp.com', 'yelp.it', 'trustpilot.com', 'trustpilot.it',
    'wikipedia.org', 'it.wikipedia.org', 'dnb.com',
    'informazione-aziende.it', 'impresaitalia.info',
    'atoka.io', 'cerved.com', 'cribis.com',
    'signalhire.com', 'rocketreach.co', 'zoominfo.com', 'apollo.io',
    'lusha.com', 'arounddeal.com', 'datanyze.com', 'companywall.it',
]);

export class SerpDeduplicator {
    private costRouter: CostRouter;
    private querySanitizer: QuerySanitizer;
    private buffer: EnrichmentBuffer;

    constructor(router: CostRouter, sanitizer: QuerySanitizer, buffer: EnrichmentBuffer) {
        this.costRouter = router;
        this.querySanitizer = sanitizer;
        this.buffer = buffer;
    }

    private normalizeUrl(url: string): { normalized: string, domain: string } {
        try {
            const u = new URL(url);
            let domain = u.hostname.replace(/^www\./i, '').toLowerCase();
            let normalized = `${u.protocol}//${domain}${u.pathname}`;
            if (normalized.endsWith('/')) {
                normalized = normalized.slice(0, -1);
            }
            return { normalized, domain };
        } catch {
            return { normalized: url, domain: url };
        }
    }

    private tokenizeCompanyNames(input: NormalizedInput): string[] {
        const variants = input.company_name_variants?.length > 0
            ? input.company_name_variants
            : [input.company_name];

        return Array.from(new Set(
            variants
                .flatMap((variant) => variant
                    .toLowerCase()
                    .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&|snc|srl|sas|spa/gi, ' ')
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                )
                .filter((token) => token.length >= 3)
        ));
    }

    private extractInlineDomains(text: string): string[] {
        const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/gi;
        const domains = new Set<string>();
        const rawText = text || '';

        for (const match of rawText.matchAll(domainRegex)) {
            const domain = (match[1] || '')
                .replace(/^www\./i, '')
                .replace(/[),.;:]+$/g, '')
                .toLowerCase();

            if (!domain.includes('.')) {
                continue;
            }

            if (ContentFilter.isDirectoryOrSocial(domain)) {
                continue;
            }

            const assessed = InputWebsiteCandidate.assess(`https://${domain}`);
            if (assessed.classification !== 'VALID' || !assessed.normalizedUrl) {
                continue;
            }

            domains.add(assessed.normalizedUrl);
        }

        return Array.from(domains);
    }

    private scoreCompanyCandidate(
        result: Pick<CleanSearchResult, 'title' | 'snippet' | 'url' | 'domain'>,
        input: NormalizedInput,
        piva?: string,
    ): number {
        const haystack = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
        const companyTokens = this.tokenizeCompanyNames(input);
        const locationSignals = [input.city, input.provincia]
            .filter(Boolean)
            .map((value) => (value || '').toLowerCase());
        const compactVariants = Array.from(new Set(
            (input.company_name_variants?.length ? input.company_name_variants : [input.company_name])
                .map((variant) => variant.toLowerCase().replace(/[^a-z0-9]/g, ''))
                .filter((variant) => variant.length >= 4)
        ));

        let score = 0;

        const matchedTokens = companyTokens.filter((token) => haystack.includes(token));
        if (companyTokens.length > 0) {
            score += (matchedTokens.length / companyTokens.length) * 0.35;
        }

        if (locationSignals.some((signal) => signal && haystack.includes(signal))) {
            score += 0.10;
        }

        if (/(contatti|chi siamo|azienda|about|privacy|partita iva|p\.?\s*iva|sito ufficiale)/i.test(haystack)) {
            score += 0.12;
        }

        if (piva) {
            const cleanPiva = piva.replace(/[^0-9]/g, '');
            if (cleanPiva.length === 11 && haystack.replace(/[^0-9]/g, '').includes(cleanPiva)) {
                score += 0.35;
            }
        }

        const domain = result.domain.toLowerCase();
        const domainSlug = domain.split('.')[0];
        if (compactVariants.some((variant) => domainSlug === variant)) {
            score += 0.45;
        } else if (compactVariants.some((variant) => domainSlug.includes(variant) || variant.includes(domainSlug))) {
            score += 0.28;
        } else if (compactVariants.some((variant) => variant.length >= 6 && domainSlug.startsWith(variant.substring(0, 6)))) {
            score += 0.15;
        }

        if (domain.endsWith('.it')) {
            score += 0.05;
        } else if (domain.endsWith('.com') || domain.endsWith('.eu')) {
            score += 0.03;
        }

        if (ContentFilter.isDirectoryLikeTitle(result.title || '')) {
            score -= 0.20;
        }

        return score;
    }

    public async search(companyId: string, input: NormalizedInput, target: 'company' | 'linkedin' | 'registry' | 'bilancio', options?: { maxTier?: number, piva?: string }): Promise<SearchOutput> {
        const variants = this.querySanitizer.buildQueryVariants(input, target, options?.piva);

        const rawResults: any[] = [];
        const queriesTried: string[] = [];
        const providersUsed = new Set<string>();

        for (const query of variants) {
            try {
                // CostRouter automatically waterfalls through healthy SERP providers (Serper -> DDG -> Bing)
                const routeResult = await this.costRouter.route<any[]>('SERP', query, {
                    maxTier: options?.maxTier,
                    companyId
                });

                queriesTried.push(query);
                providersUsed.add(routeResult.provider);

                if (routeResult.data && routeResult.data.length > 0) {
                    rawResults.push(...routeResult.data);
                    const strongSignals = target === 'company'
                        ? routeResult.data.filter((result) => {
                            if (!result?.url) {
                                return false;
                            }
                            const { domain } = this.normalizeUrl(result.url);
                            return this.scoreCompanyCandidate({
                                title: result.title || '',
                                snippet: result.snippet || '',
                                url: result.url,
                                domain,
                            }, input, options?.piva) >= 0.60;
                        }).length
                        : routeResult.data.length;

                    if (
                        (target !== 'company' && routeResult.data.length >= 3)
                        || rawResults.length >= 12
                        || (target === 'company' && strongSignals >= 2)
                        || (target === 'company' && strongSignals >= 1 && rawResults.length >= 6)
                    ) {
                        break;
                    }
                }
            } catch (err: any) {
                console.warn(`[SerpDeduplicator] Query failed: ${query} - ${err.message}`);
            }
        }

        // Processing & Deduplication
        const uniqueDomains = new Set<string>();
        const cleanResults: CleanSearchResult[] = [];
        const linkedinBuffer: Array<{ url: string; score: number; source: string; title: string; description: string; timestamp: string }> = [];

        for (const raw of rawResults) {
            if (!raw.url) continue;

            let { normalized, domain } = this.normalizeUrl(raw.url);
            const inlineDomainCandidates = target === 'company'
                ? this.extractInlineDomains(`${raw.title || ''} ${raw.snippet || ''}`)
                : [];

            for (const inlineCandidate of inlineDomainCandidates) {
                const inlineParsed = this.normalizeUrl(inlineCandidate);
                if (uniqueDomains.has(inlineParsed.domain) || NOISE_DOMAINS.has(inlineParsed.domain)) {
                    continue;
                }

                cleanResults.push({
                    title: raw.title || '',
                    snippet: raw.snippet || '',
                    url: inlineCandidate,
                    source: 'inline_domain',
                    normalized_url: inlineParsed.normalized,
                    domain: inlineParsed.domain,
                });
                uniqueDomains.add(inlineParsed.domain);
            }

            if (uniqueDomains.has(domain)) continue;

            const isNoise = NOISE_DOMAINS.has(domain);
            const isLinkedIn = domain.includes('linkedin.com') && raw.url.includes('/in/');

            if (isLinkedIn) {
                linkedinBuffer.push({
                    url: normalized,
                    score: 0.9,
                    source: 'serp',
                    title: raw.title || '',
                    description: raw.snippet || '',
                    timestamp: new Date().toISOString()
                });
                uniqueDomains.add(domain);
                continue;
            }

            let finalUrl = raw.url;
            let finalNormalized = normalized;
            let isJunk = isNoise;

            if (target === 'company' && isJunk) {
                // 🦠 DIRECTORY PARASITE: Hijack PagineGialle to extract the real website
                if (domain.includes('paginegialle.it') && !normalized.includes('/ricerca/')) {
                    console.log(`[SerpDeduplicator] 🦠 Directory Parasite attached to: ${normalized}`);
                    try {
                        const harvest = await PagineGialleHarvester.harvestByPhone({ ...input, pg_url: normalized } as any);
                        if (harvest && harvest.officialWebsite) {
                            console.log(`[SerpDeduplicator] 💉 Parasite successfully extracted real website: ${harvest.officialWebsite}`);
                            finalUrl = harvest.officialWebsite;
                            const newParsed = this.normalizeUrl(finalUrl);
                            finalNormalized = newParsed.normalized;
                            domain = newParsed.domain;
                            isJunk = false; // It's no longer noise
                            // Note: We deliberately fall back down to uniqueDomains check!
                        }
                    } catch (e) {
                        // ignore parasite failures
                    }
                }

                if (isJunk) continue;
            }

            if (uniqueDomains.has(domain)) continue;

            cleanResults.push({
                title: raw.title || '',
                snippet: raw.snippet || '',
                url: finalUrl,
                source: finalUrl !== raw.url ? 'parasite_pg' : (raw.source || 'ddg'),
                normalized_url: finalNormalized,
                domain
            });
            uniqueDomains.add(domain);
        }

        // Buffer LinkedIns if any
        if (linkedinBuffer.length > 0) {
            await this.buffer.saveRunnerUps(companyId, linkedinBuffer);
        }

        const rankedResults = target === 'company'
            ? [...cleanResults].sort((left, right) =>
                this.scoreCompanyCandidate(right, input, options?.piva) - this.scoreCompanyCandidate(left, input, options?.piva)
            )
            : cleanResults;

        return {
            results: rankedResults.slice(0, 10),
            linkedin_buffered: linkedinBuffer.length,
            queries_tried: queriesTried,
            providers_used: Array.from(providersUsed)
        };
    }
}
