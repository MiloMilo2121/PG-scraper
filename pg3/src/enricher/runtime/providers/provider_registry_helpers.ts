import { ProviderAdapter } from '../../../shared-runtime/routing/provider_adapter';
import { config } from '../../../shared-runtime/config/runtime_config';

export type ProviderRegistryEntry = [string, ProviderAdapter];

const USD_TO_EUR_ESTIMATE = 0.86;

export function usdToEur(usd: number): number {
    return Number((usd * USD_TO_EUR_ESTIMATE).toFixed(6));
}

export function readLocalOracleFetchCostEur(): number {
    const raw = process.env.LOCAL_ORACLE_FETCH_COST_EUR?.trim();
    if (!raw) {
        return 0;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

type SearchProviderCtor = new () => { search(query: string): Promise<unknown> };

export async function runSearchProvider<T>(
    loader: () => Promise<Record<string, SearchProviderCtor>>,
    exportName: string,
    query: string,
): Promise<T> {
    const module = await loader();
    const ProviderClass = module[exportName];
    if (!ProviderClass) {
        throw new Error(`Missing provider export: ${exportName}`);
    }

    const provider = new ProviderClass();
    return (await provider.search(query)) as T;
}

export async function runScraperFetch<T>(mode: 'direct' | 'brightdata', url: string, options: any): Promise<T> {
    const { ScraperClient } = await import('../../utils/scraper_client');
    const result = await ScraperClient.fetchHtml(url, { mode, ...options });
    if (mode === 'direct' && (result.status === 403 || result.status === 429)) {
        throw new Error('BLOCK');
    }
    return result as unknown as T;
}

export async function runOracleFetch<T>(url: string): Promise<T> {
    const { OracleClient } = await import('../../utils/oracle_client');
    const result = await OracleClient.fetchHtmlStealth(url);
    return { data: result.html, status: 200 } as unknown as T;
}

interface FirecrawlScrapeResponse {
    success?: boolean;
    data?: {
        html?: string;
        rawHtml?: string;
        metadata?: {
            sourceURL?: string;
            url?: string;
        };
    };
}

export async function runFirecrawlFetch<T>(url: string, options: any): Promise<T> {
    const apiKey = config.search.firecrawl.apiKey?.trim();
    if (!apiKey) {
        throw new Error('FIRECRAWL_API_KEY missing');
    }

    const timeout = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 30000;
    const response = await fetch(`${config.search.firecrawl.baseUrl}/scrape`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            url,
            formats: ['html'],
            onlyMainContent: false,
            timeout,
            proxy: 'auto',
            blockAds: true,
            storeInCache: false,
            location: {
                country: 'IT',
                languages: ['it-IT'],
            },
        }),
    });

    if (!response.ok) {
        const error = new Error(`Firecrawl API error: ${response.status} ${response.statusText}`) as Error & {
            response?: { status: number };
        };
        error.response = { status: response.status };
        throw error;
    }

    const payload = (await response.json()) as FirecrawlScrapeResponse;
    const data = payload.data?.html || payload.data?.rawHtml || '';

    return {
        via: 'firecrawl',
        status: response.status,
        finalUrl: payload.data?.metadata?.sourceURL || payload.data?.metadata?.url || url,
        headers: {},
        data,
    } as unknown as T;
}

export function parseJsonPayload<T>(raw: string): T {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T;
}
