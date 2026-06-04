import { ProviderRegistryEntry, runSearchProvider } from './provider_registry_helpers';
import { config } from '../../../shared-runtime/config/runtime_config';

export function buildSerpProviderEntries(): ProviderRegistryEntry[] {
    const entries: ProviderRegistryEntry[] = [
        ['DNS-MX-MINING-0', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/mx_discovery_provider'), 'MxDiscoveryProvider', query);
            },
        }],
        ['CRTSH-API-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'CrtShProvider', query);
            },
        }],
        ['SERPER-API-1', {
            family: 'SERP',
            costPerRequest: 0.001,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'SerperSearchProvider', query);
            },
        }],
        ['EXA-API-2', {
            family: 'SERP',
            costPerRequest: 0.002,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'ExaSearchProvider', query);
            },
        }],
        ['TAVILY-API-2', {
            family: 'SERP',
            costPerRequest: 0.001,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'TavilySearchProvider', query);
            },
        }],
        ['BING-HTML-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'BingSearchProvider', query);
            },
        }],
        ['DDG-LITE-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/search_provider'), 'DDGSearchProvider', query);
            },
        }],
    ];

    if (config.features.perplexityEnabled) {
        entries.push(['PERPLEXITY-API-4', {
            family: 'SERP',
            costPerRequest: 0.010,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../../core/discovery/perplexity_provider'), 'PerplexityProvider', query);
            },
        }]);
    }

    return entries;
}
