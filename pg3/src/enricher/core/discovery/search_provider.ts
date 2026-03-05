import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer, BingSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { BraveSerpAnalyzer } from './brave_analyzer';
import { Retry } from '../../../utils/decorators';
import { ScraperClient } from '../../utils/scraper_client';

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
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        Logger.info(`[DDGProvider] Searching via Proxy: ${url}`);

        try {
            const response = await ScraperClient.fetchHtml(url, { mode: 'auto', render: true, super: true });
            const content = response.data;
            const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : '';

            // Validating Content
            if (this.isBlocked(content, title)) {
                Logger.warn(`[DDGProvider] Block detected (Title: "${title}"). Retrying...`);
                throw new Error('DDG_BLOCK');
            }

            const results = DuckDuckGoSerpAnalyzer.parseSerp(content);
            Logger.info(`[DDGProvider] Success: ${results.length} results`);
            return results;

        } catch (e: unknown) {
            Logger.warn(`[DDGProvider] Search Error: ${(e as Error).message}`);
            throw e;
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
 * 🦁 BRAVE SEARCH PROVIDER
 * Task 04: Zero-cost alternative to Google/DDG via Tor
 */
export class BraveSearchProvider implements SearchProvider {

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
        Logger.info(`[BraveProvider] Searching via Proxy: ${url}`);

        try {
            const response = await ScraperClient.fetchHtml(url, { mode: 'auto', render: true, super: true });
            const content = response.data;
            const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : '';

            // Check blocks/captchas
            if (this.isBlocked(content, title)) {
                Logger.warn(`[BraveProvider] Block detected (Title: "${title}"). Retrying...`);
                throw new Error('BRAVE_BLOCK');
            }

            const results = BraveSerpAnalyzer.parseSerp(content);
            Logger.info(`[BraveProvider] Success: ${results.length} results`);
            return results;

        } catch (e: unknown) {
            Logger.warn(`[BraveProvider] Search Error: ${(e as Error).message}`);
            throw e;
        }
    }

    private isBlocked(content: string, title: string): boolean {
        return title.includes('Human Verification') ||
            title.toLowerCase().includes('are you a human') ||
            content.includes('unusual traffic') ||
            content.length < 500;
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
        const apiKey = process.env.SERPER_API_KEY;

        if (!apiKey) {
            Logger.warn('[SerperProvider] SERPER_API_KEY not set. Cannot search.');
            return [];
        }

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
            if (response.status === 400) Logger.warn('[SerperProvider] Out of Credits');

            throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const organic = data.organic || [];

        // Map to SerpResult format
        return organic.map((result: any) => ({
            title: result.title,
            url: result.link,
            source: 'serper_google'
        } as any));
    }
}

/**
 * 🕸 BING SEARCH PROVIDER (via Tor HTML)
 */
export class BingSearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it`;
        Logger.info(`[BingProvider] Searching via Proxy: ${url}`);

        try {
            const response = await ScraperClient.fetchHtml(url, { mode: 'auto', render: true, super: true });
            const content = response.data;

            // Check for Captcha/Blocks
            if (content.includes('form id="bnp_ttc_form"') || content.includes('Bing calls for human verification')) {
                Logger.warn(`[BingProvider] Captcha/Block detected. Retrying...`);
                throw new Error('BING_BLOCK');
            }

            const results = await BingSerpAnalyzer.parseSerp(content);
            Logger.info(`[BingProvider] Success: ${results.length} results`);
            return results;
        } catch (e: unknown) {
            Logger.warn(`[BingProvider] Search Error: ${(e as Error).message}`);
            throw e;
        }
    }
}

/**
 * 🧠 JINA.AI SEARCH PROVIDER
 */
export class JinaSearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 2000, backoff: 'fixed' })
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.JINA_API_KEY;
        if (!apiKey) {
            Logger.warn('[JinaProvider] JINA_API_KEY not set.');
            return [];
        }

        try {
            const isUrl = query.startsWith('http');
            const endpoint = isUrl ? `https://r.jina.ai/${query}` : `https://s.jina.ai/${encodeURIComponent(query)}`;
            Logger.info(`[JinaProvider] Searching: "${query}"`);

            const headers: any = { 'Authorization': `Bearer ${apiKey}` };
            if (!isUrl) {
                headers['Accept'] = 'application/json';
            }

            const axios = require('axios');
            const response = await axios.get(endpoint, { headers, timeout: 15000 });

            if (!isUrl && response.data && response.data.data) {
                return response.data.data.map((r: any) => ({
                    title: r.title,
                    url: r.url,
                    source: 'jina_ai'
                } as any));
            }

            // Fallback if doing an r.jina.ai read or unexpected structure
            return [{ title: query, url: query, source: 'jina_ai' } as any];

        } catch (e) {
            Logger.warn(`[JinaProvider] Search failed: ${(e as Error).message}`);
            throw e;
        }
    }
}

export { CrtShProvider } from './crtsh_provider';
export { SearXNGProvider } from './searxng_provider';
