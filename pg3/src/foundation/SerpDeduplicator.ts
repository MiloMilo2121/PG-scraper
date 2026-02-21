import { CostRouter } from './CostRouter';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { NormalizedInput } from './InputNormalizer';
import { RateLimitError } from 'openai'; // or our own

export interface CleanSearchResult {
    title: string;
    snippet: string;
    url: string;
    source: 'jina' | 'ddg' | 'bing';
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
    'amazon.it', 'subito.it', 'ebay.it', 'kijiji.it'
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

    public async search(companyId: string, input: NormalizedInput, target: 'company' | 'linkedin' | 'registry' | 'bilancio', options?: { maxTier?: number }): Promise<SearchOutput> {
        const variants = this.querySanitizer.buildQueryVariants(input, target);

        const rawResults: any[] = [];
        const queriesTried: string[] = [];
        const providersUsed = new Set<string>();

        for (const query of variants) {
            try {
                // CostRouter automatically waterfalls through healthy SERP providers (Jina -> DDG -> Bing)
                const routeResult = await this.costRouter.route<any[]>('SERP', query, {
                    maxTier: options?.maxTier,
                    companyId
                });

                queriesTried.push(query);
                providersUsed.add(routeResult.provider);

                if (routeResult.data && routeResult.data.length > 0) {
                    rawResults.push(...routeResult.data);
                    // We stop trying more variants at the first decent hit to save €€ / rate limits
                    if (routeResult.data.length >= 3) {
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

            const { normalized, domain } = this.normalizeUrl(raw.url);

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

            if (target === 'company' && isNoise) {
                continue;
            }

            cleanResults.push({
                title: raw.title || '',
                snippet: raw.snippet || '',
                url: raw.url,
                source: raw.source || 'ddg',
                normalized_url: normalized,
                domain
            });
            uniqueDomains.add(domain);
        }

        // Buffer LinkedIns if any
        if (linkedinBuffer.length > 0) {
            await this.buffer.saveRunnerUps(companyId, linkedinBuffer);
        }

        return {
            results: cleanResults.slice(0, 10),
            linkedin_buffered: linkedinBuffer.length,
            queries_tried: queriesTried,
            providers_used: Array.from(providersUsed)
        };
    }
}
