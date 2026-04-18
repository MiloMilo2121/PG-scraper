import { SearchProvider, SearchResult } from '../../types';
import { getConfig } from '../../config';
import axios from 'axios';
import { PuppeteerSearchProvider } from './puppeteer-provider';

export interface SearchProviderInterface {
    search(query: string, limit?: number): Promise<SearchResult[]>;
}

export type GoogleSearchFailureKind = 'auth_quota' | 'rate_limit' | 'network' | 'bad_request' | 'empty_result';

export class GoogleSearchProviderError extends Error {
    kind: GoogleSearchFailureKind;
    retriable: boolean;
    statusCode?: number;

    constructor(kind: GoogleSearchFailureKind, message: string, options: { retriable: boolean; statusCode?: number; cause?: unknown }) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.name = 'GoogleSearchProviderError';
        this.kind = kind;
        this.retriable = options.retriable;
        this.statusCode = options.statusCode;
        if (options.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
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

            const items = Array.isArray(res.data.items) ? res.data.items : [];
            if (items.length === 0) {
                throw new GoogleSearchProviderError(
                    'empty_result',
                    '[GoogleCS] Empty result set',
                    { retriable: false, statusCode: res.status }
                );
            }

            return items.map((item: any) => ({
                url: item.link,
                title: item.title,
                snippet: item.snippet
            }));
        } catch (error: any) {
            if (error instanceof GoogleSearchProviderError) {
                throw error;
            }

            const status = error?.response?.status;
            const responseMessage = `${error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || ''}`.toLowerCase();
            const message = error?.message || 'Google Custom Search request failed';

            if (status === 429 || responseMessage.includes('rate limit') || (responseMessage.includes('quota') && responseMessage.includes('exceeded'))) {
                throw new GoogleSearchProviderError('rate_limit', `[GoogleCS] Rate limit: ${message}`, {
                    retriable: true,
                    statusCode: status ?? 429,
                    cause: error,
                });
            }

            if (
                status === 401 ||
                status === 403 ||
                responseMessage.includes('api key') ||
                responseMessage.includes('unauthorized') ||
                responseMessage.includes('forbidden') ||
                responseMessage.includes('quota') ||
                responseMessage.includes('billing')
            ) {
                throw new GoogleSearchProviderError('auth_quota', `[GoogleCS] Auth/quota failure: ${message}`, {
                    retriable: false,
                    statusCode: status,
                    cause: error,
                });
            }

            if (status === 400 || responseMessage.includes('bad request') || responseMessage.includes('invalid') || responseMessage.includes('malformed')) {
                throw new GoogleSearchProviderError('bad_request', `[GoogleCS] Bad request: ${message}`, {
                    retriable: false,
                    statusCode: status ?? 400,
                    cause: error,
                });
            }

            if (
                error?.code === 'ECONNABORTED' ||
                error?.code === 'ENOTFOUND' ||
                error?.code === 'ECONNRESET' ||
                error?.code === 'EAI_AGAIN' ||
                responseMessage.includes('network') ||
                responseMessage.includes('timeout') ||
                responseMessage.includes('socket')
            ) {
                throw new GoogleSearchProviderError('network', `[GoogleCS] Network error: ${message}`, {
                    retriable: true,
                    statusCode: status,
                    cause: error,
                });
            }

            throw new GoogleSearchProviderError('network', `[GoogleCS] Network error: ${message}`, {
                retriable: true,
                statusCode: status,
                cause: error,
            });
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
