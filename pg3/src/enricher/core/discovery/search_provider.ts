import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer, BingSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { BraveSerpAnalyzer } from './brave_analyzer';
import { TorBrowser } from '../browser/tor_browser';
import { Retry } from '../../../utils/decorators';
import { TorError } from '../../../utils/errors';

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
        const torBrowser = TorBrowser.getInstance();

        // Fail-fast: check if Tor ControlPort is reachable before wasting time
        const torReady = await torBrowser.isControlPortAvailable();
        if (!torReady) {
            throw new TorError('Tor ControlPort 9051 is not reachable. DDG search unavailable.', false);
        }

        let page;
        try {
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
            throw e; // Re-throw to trigger retry (or fail-fast if TorError with canRetry=false)
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
 * 🦁 BRAVE SEARCH PROVIDER
 * Task 04: Zero-cost alternative to Google/DDG via Tor
 */
export class BraveSearchProvider implements SearchProvider {

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const torBrowser = TorBrowser.getInstance();

        const torReady = await torBrowser.isControlPortAvailable();
        if (!torReady) {
            throw new TorError('Tor ControlPort 9051 is not reachable. Brave search unavailable.', false);
        }

        let page;
        try {
            page = await torBrowser.getPage();

            const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

            Logger.info(`[BraveProvider] Searching via Tor: ${url}`);
            // Brave blocks headless fast, we try the naive Tor approach first
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

            const title = await page.title();
            const content = await page.content();

            // Check blocks/captchas
            if (this.isBlocked(content, title)) {
                Logger.warn(`[BraveProvider] Block detected (Title: "${title}"). Rotating IP...`);
                await torBrowser.rotateIP();
                throw new Error('BRAVE_BLOCK');
            }

            const results = BraveSerpAnalyzer.parseSerp(content);
            Logger.info(`[BraveProvider] Success: ${results.length} results`);
            return results;

        } catch (e: unknown) {
            Logger.warn(`[BraveProvider] Search Error: ${(e as Error).message}`);
            throw e;
        } finally {
            if (page) await page.close().catch(() => { });
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
        const torBrowser = TorBrowser.getInstance();
        const torReady = await torBrowser.isControlPortAvailable();
        if (!torReady) {
            throw new TorError('Tor ControlPort 9051 is not reachable. Bing search unavailable.', false);
        }

        let page;
        try {
            page = await torBrowser.getPage();
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it`;

            Logger.info(`[BingProvider] Searching via Tor: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

            const content = await page.content();

            // Check for Captcha/Blocks
            if (content.includes('form id="bnp_ttc_form"') || content.includes('Bing calls for human verification')) {
                Logger.warn(`[BingProvider] Captcha/Block detected. Rotating IP...`);
                await torBrowser.rotateIP();
                throw new Error('BING_BLOCK');
            }

            const results = await BingSerpAnalyzer.parseSerp(content);
            Logger.info(`[BingProvider] Success: ${results.length} results`);
            return results;
        } catch (e: unknown) {
            Logger.warn(`[BingProvider] Search Error: ${(e as Error).message}`);
            throw e;
        } finally {
            if (page) await page.close().catch(() => { });
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
