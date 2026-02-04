import { SearchProvider, SearchResult } from '../../types';
import { PuppeteerWrapper } from '../browser';
import * as cheerio from 'cheerio';
import { getCached, setCache, saveCache } from '../cache/search-cache';
import Bottleneck from 'bottleneck';

export class PuppeteerSearchProvider implements SearchProvider {
    name = 'DuckDuckGoSearch';
    // Rate limit: 1 request every 2 seconds
    private limiter = new Bottleneck({ minTime: 2000, maxConcurrent: 1 });

    async search(query: string, limit: number): Promise<SearchResult[]> {
        // Check cache first
        const cached = getCached(query);
        if (cached) {
            console.log(`[Cache HIT] ${query.substring(0, 50)}...`);
            return cached.slice(0, limit);
        }

        // Use DuckDuckGo for more literal results
        const q = encodeURIComponent(query);
        // Use kl=it-it for Italian region
        const url = `https://html.duckduckgo.com/html/?q=${q}&kl=it-it`;

        console.log(`[DuckDuckGo] ${query}`);

        try {
            const res = await this.limiter.schedule(() => PuppeteerWrapper.fetch(url));

            if (res.status >= 400 || !res.content) {
                console.error(`DuckDuckGo search failed with status ${res.status}`);
                return [];
            }

            const $ = cheerio.load(res.content);
            const results: SearchResult[] = [];

            // DuckDuckGo HTML version uses div.result for each result
            $('div.result, .results_links').each((_: any, el: any) => {
                // Skip ads (usually have different classes)
                if ($(el).hasClass('result--ad')) return;

                // Get the link - usually in a.result__a or similar
                const linkEl = $(el).find('a.result__a, a.result__url, a[href^="http"]').first();
                const snippetEl = $(el).find('.result__snippet, .result__body');

                let link = linkEl.attr('href') || '';
                const title = linkEl.text().trim();
                const snippet = snippetEl.text().trim();

                // DuckDuckGo may use redirect URLs like //duckduckgo.com/l/?uddg=...
                if (link.includes('duckduckgo.com/l/')) {
                    const match = link.match(/uddg=([^&]+)/);
                    if (match && match[1]) {
                        link = decodeURIComponent(match[1]);
                    }
                }

                // Validate link
                if (title && link && (link.startsWith('http://') || link.startsWith('https://'))) {
                    // Skip DuckDuckGo internal links
                    if (link.includes('duckduckgo.com')) return;

                    results.push({
                        url: link,
                        title: title,
                        snippet: snippet
                    });
                }
            });

            console.log(`[DuckDuckGo] Found ${results.length} results for: ${query}`);

            // Cache the results
            if (results.length > 0) {
                setCache(query, results);
            }

            return results.slice(0, limit);

        } catch (e: any) {
            console.error(`[DuckDuckGo] Search error: ${e.message}`);
            return [];
        }
    }
}

// Export saveCache for pipeline cleanup
export { saveCache };
