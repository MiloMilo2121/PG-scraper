import { SearchProvider, SearchResult } from '../../types';
import { getConfig } from '../../config';
import axios from 'axios';
import { PuppeteerSearchProvider } from './puppeteer-provider';

export interface SearchProviderInterface {
    search(query: string, limit?: number): Promise<SearchResult[]>;
}

export class DummyProvider implements SearchProvider {
    name = 'DummyProvider';

    async search(query: string, limit = 5): Promise<SearchResult[]> {
        console.log(`[DummyProvider] Searching for: ${query}`);
        return [];
    }
}

export class GoogleCustomSearchProvider implements SearchProvider {
    name = 'GoogleCS';
    private apiKey: string;
    private cx: string;

    constructor(apiKey: string, cx: string) {
        this.apiKey = apiKey;
        this.cx = cx;
    }

    async search(query: string, limit = 5): Promise<SearchResult[]> {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${this.apiKey}&cx=${this.cx}&q=${encodeURIComponent(query)}&num=${limit}`;
            const res = await axios.get(url, { timeout: 10000 });

            if (!res.data.items) return [];

            return res.data.items.map((item: any) => ({
                url: item.link,
                title: item.title,
                snippet: item.snippet
            }));
        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                console.warn(`[GoogleCS] Rate Limit: ${error.message}`);
                throw new Error('RATE_LIMIT');
            }
            console.error(`[GoogleCS] Error: ${error.message}`);
            return [];
        }
    }
}

export class SearchFactory {
    static create(): SearchProvider {
        const apiKey = process.env.GOOGLE_API_KEY;
        const cx = process.env.GOOGLE_CX;

        if (apiKey && cx) {
            return new GoogleCustomSearchProvider(apiKey, cx);
        }

        console.log('Using PuppeteerSearchProvider (No API Keys found)');
        return new PuppeteerSearchProvider();
    }
}
