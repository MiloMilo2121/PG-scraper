import {
    ProviderRegistryEntry,
    runFirecrawlFetch,
    readLocalOracleFetchCostEur,
    runOracleFetch,
    runScraperFetch,
    usdToEur,
} from './provider_registry_helpers';

const BRIGHTDATA_WEB_UNLOCKER_COST_EUR = usdToEur(1.5 / 1000);
const FIRECRAWL_SCRAPE_COST_EUR = usdToEur(0.0035);

export function buildHttpProviderEntries(): ProviderRegistryEntry[] {
    return [
        ['HTTP-DIRECT-1', {
            family: 'PROXY_FETCH',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                return runScraperFetch<T>('direct', url, options);
            },
        }],
        ['FIRECRAWL-SCRAPE-3', {
            family: 'PROXY_FETCH',
            costPerRequest: FIRECRAWL_SCRAPE_COST_EUR,
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                return runFirecrawlFetch<T>(url, options);
            },
        }],
        ['HTTP-BRIGHTDATA-4', {
            family: 'PROXY_FETCH',
            costPerRequest: BRIGHTDATA_WEB_UNLOCKER_COST_EUR,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                return runScraperFetch<T>('brightdata', url, options);
            },
        }],
        ['ORACLE-CRAWL4AI-5', {
            family: 'PROXY_FETCH',
            costPerRequest: readLocalOracleFetchCostEur(),
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                return runOracleFetch<T>(url);
            },
        }],
    ];
}
