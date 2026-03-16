import { fetch, Agent } from 'undici';
import * as cheerio from 'cheerio';
import { Logger } from '../../../utils/logger';
import { HoneyPotDetector } from '../../security/honeypot_detector';

const fetcherAgent = new Agent({
    connect: { rejectUnauthorized: false },
    keepAliveTimeout: 10000,
    connections: 50
});

export interface FetchedCandidate {
    domain: string;
    url: string;
    text: string;
    title: string;
    error?: string;
}

export class HyperGuesserVXFetcher {
    /**
     * Stealthily and concurrently fetches the text content of the given alive domains.
     * Uses axios instead of Puppeteer to achieve 100x speed without CPU overhead.
     */
    static async fetchBatch(domains: string[], maxConcurrency = 10): Promise<FetchedCandidate[]> {
        const results: FetchedCandidate[] = [];
        const chunks = this.chunkArray(domains, maxConcurrency);

        Logger.info(`[HyperGuesserVX] Unleashing Ghost Fetcher on ${domains.length} alive targets...`);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(domain => this.fetchDomain(domain));
            const chunkResults = await Promise.all(chunkPromises);

            // Filter out empty/errored ones right away
            results.push(...chunkResults.filter(r => r.text.length > 50));
        }

        Logger.info(`[HyperGuesserVX] Ghost Fetcher completed. Recovered ${results.length} websites with meaningful text.`);
        return results;
    }

    private static async fetchDomain(domain: string): Promise<FetchedCandidate> {
        const url = `https://${domain}`;
        try {
            // Highly optimized HTTP request disguised as a regular browser
            const response = await fetch(url, {
                method: 'GET',
                dispatcher: fetcherAgent,
                redirect: 'follow',
                signal: AbortSignal.timeout(5000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            });

              const html = await response.text();
              if (typeof html !== 'string' || response.status >= 500) {
                  return { domain, url, title: '', text: '', error: 'INVALID_RESPONSE' };
              }

              const honeypotVerdict = HoneyPotDetector.getInstance().analyzeContent(html);
              if (!honeypotVerdict.safe) {
                  return { domain, url, title: '', text: '', error: honeypotVerdict.reason || 'HONEYPOT_SIGNAL' };
              }

              // Extract pure text using cheerio
              const $ = cheerio.load(html);

            // Remove useless tags that pollute the LLM context
            $('script, style, link, img, noscript, svg').remove();

            const title = $('title').text().trim();
            const rawText = $('body').text().replace(/\s+/g, ' ').trim();

            // Parked domain heuristic check right at the fetch layer
            if (rawText.toLowerCase().includes('this domain is for sale') ||
                rawText.toLowerCase().includes('dominio in vendita')) {
                return { domain, url, title, text: '', error: 'PARKED_DOMAIN' };
            }

            // Cap the text to the first 2500 characters. We only need enough for the LLM 
            // to understand if the company name/sector matches.
            const truncatedText = rawText.substring(0, 2500);

            return {
                domain,
                url: response.url || url,
                title,
                text: truncatedText
            };

        } catch (error: any) {
            // Usually ECONNREFUSED or timeout for dead HTTPS ports
            return { domain, url, title: '', text: '', error: error.message };
        }
    }

    private static chunkArray<T>(array: T[], size: number): T[][] {
        const chunked = [];
        for (let i = 0; i < array.length; i += size) {
            chunked.push(array.slice(i, i + size));
        }
        return chunked;
    }
}
