import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { TorBrowser } from '../browser/tor_browser';
import { Retry } from '../../../utils/decorators';

export interface SearchProvider {
    search(query: string): Promise<SerpResult[]>;
}

/**
 * 🚀 GOOGLE PROVIDER (via SERPER.DEV)
 * Replaced Scrape.do/Puppeteer with Serper.dev API for stability and speed.
 * Law 002: O(1) efficiency vs O(n) browser rendering.
 */
export class GoogleSearchProvider implements SearchProvider {
    async search(query: string): Promise<SerpResult[]> {
        // Delegate to SerperProvider directly
        const provider = new SerperSearchProvider();
        return provider.search(query);
    }
}


export class DDGSearchProvider implements SearchProvider {

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        let page;
        try {
            const torBrowser = TorBrowser.getInstance();
            page = await torBrowser.getPage();

            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

            Logger.info(`[DDGProvider] Searching via Tor: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Increased timeout for Tor

            const title = await page.title();
            const content = await page.content();

            // Validating Content
            if (this.isBlocked(content, title)) {
                Logger.warn(`[DDGProvider] Block detected (Title: "${title}"). Rotating IP...`);
                await torBrowser.rotateIP();

                // Throw error to trigger Retry decorator
                throw new Error('DDG_BLOCK');
            }

            const results = DuckDuckGoSerpAnalyzer.parseSerp(content);
            Logger.info(`[DDGProvider] Success: ${results.length} results`);
            return results;

        } catch (e: unknown) {
            Logger.warn(`[DDGProvider] Search Error: ${(e as Error).message}`);
            throw e; // Re-throw to trigger retry
        } finally {
            if (page) await page.close().catch(() => { });
        }
    }

    private isBlocked(content: string, title: string): boolean {
        return content.includes('bots use duckduckgo too') ||
            title.includes('403') ||
            content.includes('issue with the Tor Exit Node') ||
            content.length < 500; // Adjusted length check
    }
}


/**
 * 📍 REVERSE ADDRESS SEARCH PROVIDER
 * Task 04: Find companies by exact address match
 * Query: "{address}" {city} sito web
 */
export class ReverseAddressSearchProvider implements SearchProvider {
    /**
     * reverseAddressSearch - Find website by exact address match
     * @param address - Full street address (e.g., "Via Roma 123")
     * @param city - City name
     */
    async reverseAddressSearch(address: string, city: string): Promise<SerpResult[]> {
        // Use exact match with quotes for address
        const query = `"${address}" ${city} sito web`;
        return this.search(query);
    }

    async search(query: string): Promise<SerpResult[]> {
        // Use Serper via GoogleProvider
        const provider = new GoogleSearchProvider();
        return provider.search(query);
    }
}


/**
 * 🚀 SERPER.DEV PROVIDER (Google API)
 * High reliability, low cost, fast.
 */
export class SerperSearchProvider implements SearchProvider {
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.SERPER_API_KEY || 'e0feae3b0d8ba0ebcdc8a70874543e15bd6bf01a';

        if (!apiKey) {
            Logger.warn('[SerperProvider] No API Key provided');
            return [];
        }

        try {
            Logger.info(`[SerperProvider] Searching: "${query}"`);

            // Serper.dev API endpoint
            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: query,
                    gl: 'it',
                    hl: 'it'
                })
            });

            if (!response.ok) {
                // Handle 403/429 specifically
                if (response.status === 403) Logger.error('[SerperProvider] Invalid API Key');
                if (response.status === 429) Logger.warn('[SerperProvider] Rate Limit Exceeded');

                throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const organic = data.organic || [];

            // Map to SerpResult format
            return organic.map((result: any) => ({
                title: result.title,
                url: result.link,
                snippet: result.snippet,
                source: 'serper_google'
            }));

        } catch (e) {
            Logger.warn(`[SerperProvider] Search failed: ${(e as Error).message}`);
            return [];
        }
    }
}
