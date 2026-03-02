import { SerpDeduplicator } from './src/foundation/SerpDeduplicator';
import { CostRouter } from './src/foundation/CostRouter';
import { MemoryFirstCache } from './src/foundation/MemoryFirstCache';
import { CostLedger } from './src/foundation/CostLedger';
import { QuerySanitizer } from './src/foundation/QuerySanitizer';
import { EnrichmentBuffer } from './src/foundation/EnrichmentBuffer';
import { SerperSearchProvider, JinaSearchProvider, BingSearchProvider, DDGSearchProvider, BraveSearchProvider } from './src/enricher/core/discovery/search_provider';

async function run() {
    const ledger = new CostLedger();
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 10 });
    const providers = new Map([
        ['BING-HTML-1', { costPerRequest: 0, tier: 0, execute: async (p: any) => new BingSearchProvider().search(p) } as any],
        ['DDG-LITE-1', { costPerRequest: 0, tier: 1, execute: async (p: any) => new DDGSearchProvider().search(p) } as any],
        ['BRAVE-HTML-1', { costPerRequest: 0, tier: 1, execute: async (p: any) => new BraveSearchProvider().search(p) } as any],
        ['SERPER-1', { costPerRequest: 0.001, tier: 2, execute: async (p: any) => new SerperSearchProvider().search(p) } as any],
        ['JINA-1', { costPerRequest: 0.002, tier: 2, execute: async (p: any) => new JinaSearchProvider().search(p) } as any],
    ]);
    const router = new CostRouter(cache, ledger, providers);
    const dedup = new SerpDeduplicator(router, new QuerySanitizer(), new EnrichmentBuffer(cache));

    console.log("Starting SERP...");
    const query = { company_name: 'Elettronave', city: 'Brescia', normalized_name: 'Elettronave' };
    try {
        const res = await dedup.search('123', query as any, 'company', { maxTier: 2 });
        console.log(JSON.stringify(res, null, 2));
    } catch(e) {
        console.error("CRASHED", e);
    }
}
run().catch(console.error);
