import { request } from 'undici';
import * as cheerio from 'cheerio';
import { SearchProvider } from './search_provider';
import { SerpResult } from './serp_analyzer';
import { Logger } from '../../utils/logger';
import { Retry } from '../../../utils/decorators';

export class FreeProxyAggregatorProvider implements SearchProvider {
    id = 'FREE-AGGR-PROXY-3';
    tier = 3; // Fallback estremo prima di arrendersi (ma dopo le opzioni 100% free)
    costPerRequest = 0; // Utilizziamo solo i free tier

    // Leggiamo un array di chiavi "Free Tier" da .env (es. ScraperAPI, ZenRows)
    private apiKeys: string[] = [];
    private currentKeyIdx = 0;

    constructor() {
        const keysEnv = process.env.SCRAPERAPI_FREE_KEYS;
        if (keysEnv) {
            this.apiKeys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
        }
        if (this.apiKeys.length === 0) {
            Logger.warn(`[FreeProxyAggregatorProvider] No SCRAPERAPI_FREE_KEYS found in .env. Provider will be inactive if called.`);
        }
    }

    private getNextKey(): string | null {
        if (this.apiKeys.length === 0) return null;
        const key = this.apiKeys[this.currentKeyIdx];
        this.currentKeyIdx = (this.currentKeyIdx + 1) % this.apiKeys.length;
        return key;
    }

    @Retry({ attempts: 1, delay: 3000, backoff: 'fixed' })
    async search(query: string, maxResults: number = 10): Promise<SerpResult[]> {
        const apiKey = this.getNextKey();
        if (!apiKey) {
            // Silently fail instead of throwing an error to prevent the BackpressureValve from throttling
            Logger.warn("[FreeProxyAggregatorProvider] Inactive: No free keys available.");
            return [];
        }

        // Costruiamo la URL target (Google HTML) da far proxare
        const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=${maxResults}`;

        // Esempio: ScraperAPI Endpoint
        const scraperApiUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true`;

        Logger.info(`[FreeProxyAggregatorProvider] Delegating SERP scrape to Free Proxy Network with key ***${apiKey.slice(-4)}`);

        try {
            const response = await request(scraperApiUrl, {
                method: 'GET',
                bodyTimeout: 35000,
                headersTimeout: 35000,
            });
            const html = await response.body.text();
            const $ = cheerio.load(html);

            const processedResults: SerpResult[] = [];
            const seenUrls = new Set<string>();

            // Parsiamo gli organic results (.g, o .tF2Cxc)
            $('.g a').each((i, el) => {
                const rawUrl = $(el).attr('href');
                const title = $(el).find('h3').text() || $(el).text();

                if (!rawUrl || !title || rawUrl.startsWith('/')) return;

                const cleanUrl = rawUrl.split('#')[0].split('?')[0].trim();

                if (cleanUrl.startsWith('http') && !cleanUrl.includes('google.com/url') && !seenUrls.has(cleanUrl)) {
                    seenUrls.add(cleanUrl);
                    processedResults.push({
                        url: cleanUrl,
                        title: title.trim(),
                        source: 'free_aggr'
                    } as any);
                }
            });

            if (processedResults.length === 0) {
                Logger.warn(`[FreeProxyAggregatorProvider] Rate limit o blocco restituito dall'Aggregator.`);
                throw new Error("API_RATE_LIMIT");
            }

            Logger.info(`[FreeProxyAggregatorProvider] Riacquisiti ${processedResults.length} risultati da Google tramite Aggregator`);
            return maxResults ? processedResults.slice(0, maxResults) : processedResults;

        } catch (e: any) {
            // 429 Rate Limit from the SaaS or 403 Forbidden
            if (e.code === 'UND_ERR_CONNECT_TIMEOUT' || e.message?.includes('429') || e.message?.includes('403')) {
                Logger.warn(`[FreeProxyAggregatorProvider] Burned key ***${apiKey.slice(-4)}. Rotating.`);
                // Optionally remove the dead key
                // this.apiKeys = this.apiKeys.filter(k => k !== apiKey);
            }
            throw e;
        }
    }

    async getCredits(): Promise<number> {
        return this.apiKeys.length * 1000; // Mock: assume 1k free reqs per key
    }
}
