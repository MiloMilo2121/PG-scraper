import axios from 'axios';
import { Logger } from '../../utils/logger';
import { BingSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { BraveSerpAnalyzer } from './brave_analyzer';
import { Retry } from '../../../utils/decorators';
import { ScraperClient } from '../../utils/scraper_client';

export interface SearchProvider {
    search(query: string): Promise<SerpResult[]>;
}

interface SerperOrganicResult {
    title?: string;
    link?: string;
    snippet?: string;
}

interface JinaSearchItem {
    title?: string;
    url?: string;
    content?: string;
}

interface JinaSearchResponse {
    data?: JinaSearchItem[];
}

interface BraveApiWebResult {
    title?: string;
    url?: string;
    description?: string;
    extra_snippets?: string[];
}

interface BraveApiResponse {
    web?: {
        results?: BraveApiWebResult[];
    };
}

interface TavilySearchItem {
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string | null;
}

interface TavilySearchResponse {
    results?: TavilySearchItem[];
}

interface ExaSearchItem {
    title?: string;
    url?: string;
    text?: string;
}

interface ExaSearchResponse {
    results?: ExaSearchItem[];
}

/**
 * Compatibility shim for callers that still expect Google SERP access via Serper.
 * Recent provider cleanup removed this class, but multiple enrichment paths still import it.
 */
export class SerperSearchProvider implements SearchProvider {
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.SERPER_API_KEY?.trim();
        if (!apiKey) {
            Logger.warn('[SerperProvider] SERPER_API_KEY not set. Cannot search.');
            return [];
        }

        Logger.info(`[SerperProvider] Searching: "${query}"`);

        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q: query,
                gl: 'it',
                hl: 'it',
            }),
        });

        if (!response.ok) {
            if (response.status === 403) Logger.error('[SerperProvider] Invalid API Key');
            if (response.status === 429) Logger.warn('[SerperProvider] Rate Limit Exceeded');
            if (response.status === 400) Logger.warn('[SerperProvider] Out of Credits or bad request');
            throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as { organic?: SerperOrganicResult[] };
        return (data.organic || [])
            .filter((result) => typeof result.link === 'string' && result.link.trim() !== '')
            .map((result) => ({
                title: result.title || '',
                url: result.link!,
                snippet: result.snippet || '',
                source: 'serper_google',
            } as SerpResult));
    }
}

/**
 * Compatibility shim for enrichment paths that use Jina search/read as a cheap fallback.
 */
export class JinaSearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 2000, backoff: 'fixed' })
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.JINA_API_KEY?.trim();
        if (!apiKey) {
            Logger.warn('[JinaProvider] JINA_API_KEY not set.');
            return [];
        }

        Logger.info(`[JinaProvider] Searching: "${query}"`);
        const response = await axios.get<JinaSearchResponse>(`https://s.jina.ai/${encodeURIComponent(query)}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
            timeout: 15000,
        });

        return (response.data.data || [])
            .filter((result) => typeof result.url === 'string' && result.url.trim() !== '')
            .map((result) => ({
                title: result.title || '',
                url: result.url!,
                snippet: result.content || '',
                source: 'jina_ai',
            } as SerpResult));
    }
}

export class BraveApiSearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 2000, backoff: 'fixed' })
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
        if (!apiKey) {
            Logger.warn('[BraveApiProvider] BRAVE_SEARCH_API_KEY not set.');
            return [];
        }

        Logger.info(`[BraveApiProvider] Searching: "${query}"`);

        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('country', 'IT');
        url.searchParams.set('search_lang', 'it');
        url.searchParams.set('ui_lang', 'it-IT');
        url.searchParams.set('count', '10');
        url.searchParams.set('extra_snippets', 'true');

        const response = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as BraveApiResponse;
        return (data.web?.results || [])
            .filter((result) => typeof result.url === 'string' && result.url.trim() !== '')
            .map((result) => ({
                title: result.title || '',
                url: result.url!,
                snippet: [result.description, ...(result.extra_snippets || [])].filter(Boolean).join(' | '),
                source: 'brave_api',
            } as SerpResult));
    }
}

export class TavilySearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 2000, backoff: 'fixed' })
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.TAVILY_API_KEY?.trim();
        if (!apiKey) {
            Logger.warn('[TavilyProvider] TAVILY_API_KEY not set.');
            return [];
        }

        Logger.info(`[TavilyProvider] Searching: "${query}"`);

        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                search_depth: 'basic',
                max_results: 10,
                include_answer: false,
                include_raw_content: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as TavilySearchResponse;
        return (data.results || [])
            .filter((result) => typeof result.url === 'string' && result.url.trim() !== '')
            .map((result) => ({
                title: result.title || '',
                url: result.url!,
                snippet: result.content || result.raw_content || '',
                source: 'tavily_search',
            } as SerpResult));
    }
}

export class ExaSearchProvider implements SearchProvider {
    @Retry({ attempts: 3, delay: 2000, backoff: 'fixed' })
    async search(query: string): Promise<SerpResult[]> {
        const apiKey = process.env.EXA_API_KEY?.trim();
        if (!apiKey) {
            Logger.warn('[ExaProvider] EXA_API_KEY not set.');
            return [];
        }

        Logger.info(`[ExaProvider] Searching: "${query}"`);

        const response = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify({
                query,
                numResults: 10,
                type: 'keyword',
                text: true,
            }),
        });

        if (!response.ok) {
            throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as ExaSearchResponse;
        return (data.results || [])
            .filter((result) => typeof result.url === 'string' && result.url.trim() !== '')
            .map((result) => ({
                title: result.title || '',
                url: result.url!,
                snippet: result.text || '',
                source: 'exa_search',
            } as SerpResult));
    }
}

export class DDGSearchProvider implements SearchProvider {

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const rng = Math.random().toString(36).substring(7);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&_t=${Date.now()}_${rng}`;
        Logger.info(`[DDGProvider] Searching via Proxy: ${url}`);

        try {
            const response = await ScraperClient.fetchHtml(url, { mode: 'auto', render: false, super: true });
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
        const lowerTitle = title.toLowerCase();
        return content.includes('bots use duckduckgo too') ||
            lowerTitle.includes('403') ||
            lowerTitle.includes('forbidden') ||
            content.includes('issue with the Tor Exit Node') ||
            content.length < 1000;
    }
}

export class BraveSearchProvider implements SearchProvider {

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const rng = Math.random().toString(36).substring(7);
        const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&_t=${Date.now()}_${rng}`;
        Logger.info(`[BraveProvider] Searching via Proxy: ${url}`);

        try {
            const response = await ScraperClient.fetchHtml(url, { mode: 'auto', render: false, super: true });
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
        const lowerTitle = title.toLowerCase();
        return lowerTitle.includes('human verification') ||
            lowerTitle.includes('are you a human') ||
            content.includes('unusual traffic') ||
            lowerTitle.includes('403') ||
            content.length < 1000;
    }
}

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
        // Use DDG as default searchable fallback
        const provider = new DDGSearchProvider();
        return provider.search(query);
    }
}

export { CrtShProvider } from './crtsh_provider';
export { SearXNGProvider } from './searxng_provider';
