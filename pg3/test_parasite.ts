import { SerpDeduplicator } from './src/foundation/SerpDeduplicator';
import { PagineGialleHarvester } from './src/enricher/core/directories/paginegialle';

async function test() {
    const mockRouter = {
        route: async () => ({
            data: [
                { url: 'https://www.paginegialle.it/lombardia/castel_goffredo/autofficina-coffani.html', title: 'PG', snippet: '', source: 'ddg' },
                { url: 'https://www.facebook.com/coffani', title: 'FB', snippet: '', source: 'ddg' }
            ],
            provider: 'test'
        })
    };
    const mockSanitizer = { buildQueryVariants: () => ['test'] };
    const mockBuffer = { saveRunnerUps: async () => {} };

    const dedup = new SerpDeduplicator(mockRouter as any, mockSanitizer as any, mockBuffer as any);
    
    console.log("Testing Parasite Deduplication...");
    const res = await dedup.search('123', { company_name: 'Autofficina Coffani di Coffani Massimiliano', city: 'Castel Goffredo' } as any, 'company');
    console.log("Result:", JSON.stringify(res.results, null, 2));
}
test();
