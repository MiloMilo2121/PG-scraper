import axios, { AxiosInstance } from 'axios';
import * as rax from 'retry-axios';
import { getConfig } from '../../config';
import { PuppeteerWrapper } from '../browser';

export interface FetchResult {
    url: string;
    status: number;
    data: string; // HTML content
    headers: any;
    finalUrl: string; // valid for redirects
}

const CACHE = new Map<string, { data: FetchResult, expiry: number }>();

export class Fetcher {
    private client: AxiosInstance;

    constructor() {
        const config = getConfig();
        this.client = axios.create({
            timeout: config.fetcher.timeout_ms,
            headers: {
                'User-Agent': config.fetcher.user_agent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            }
        });

        // Attach retry-axios
        this.client.defaults.raxConfig = {
            retry: config.fetcher.retries,
            retryDelay: config.fetcher.backoff_ms,
            httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS'],
            statusCodesToRetry: [[429, 429], [503, 503], [500, 500]],
            backoffType: 'exponential'
        };
        rax.attach(this.client);
    }

    async fetch(url: string, useCache = true): Promise<FetchResult> {
        if (useCache) {
            const cached = CACHE.get(url);
            if (cached && cached.expiry > Date.now()) {
                return cached.data;
            }
        }

        let result: FetchResult | null = null;

        try {
            // Try Axios first (fast)
            const response = await this.client.get(url);

            result = {
                url: url,
                status: response.status,
                data: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                headers: response.headers,
                finalUrl: response.request.res.responseUrl || url
            };

        } catch (error: any) {
            // Check if it's a response error that warrants fallback
            // 403 (Forbidden), 429 (Too Many Requests), 503 (Service Unavailable)
            // Also if response is undefined, it might be a network error (TLS)
            const status = error.response ? error.response.status : 0;
            const shouldFallback = !error.response || [403, 429, 503].includes(status);

            if (shouldFallback) {
                try {
                    const pupRes = await PuppeteerWrapper.fetch(url);
                    // If Puppeteer returns a valid page (status < 400), we take it
                    // Even if it's 404, valid. But if 0, failed.
                    if (pupRes.status > 0) {
                        result = {
                            url: url,
                            status: pupRes.status,
                            data: pupRes.content,
                            headers: {},
                            finalUrl: pupRes.finalUrl
                        };
                    }
                } catch (pupError) {
                    // Puppeteer failed too
                }
            }

            // If we still don't have a result, return the original error info
            if (!result) {
                if (error.response) {
                    return {
                        url: url,
                        status: error.response.status,
                        data: '',
                        headers: error.response.headers,
                        finalUrl: url
                    };
                }
                // If it was a network error and Puppeteer failed, rethrow or return status 0
                return {
                    url: url,
                    status: 0,
                    data: '',
                    headers: {},
                    finalUrl: url
                };
            }
        }

        if (result && useCache) {
            CACHE.set(url, {
                data: result,
                expiry: Date.now() + 1000 * 60 * 60
            });
        }

        if (!result) throw new Error(`Fetch failed for ${url}`);

        return result;
    }
}

export const fetcher = new Fetcher();
