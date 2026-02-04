
import { GoogleSearchProvider, DDGSearchProvider } from '../src/core/discovery/search_provider';
import { TrustArbiter } from '../src/core/knowledge/trust_arbiter';
import { CompanyInput } from '../src/core/company_types';
import { Logger } from '../src/utils/logger';

async function testSearchProviders() {
    Logger.info('--- 1. Testing Search Providers ---');
    const google = new GoogleSearchProvider();
    const query = 'Tesla Italy sito ufficiale';

    Logger.info(`Searching Google for: "${query}"...`);
    const gResults = await google.search(query);
    console.log('Google Results:', gResults.slice(0, 3));

    if (gResults.length > 0) Logger.info('✅ Google Provider Working');
    else Logger.warn('❌ Google Provider returned 0 results');
}

async function testTrustArbiter() {
    Logger.info('\n--- 2. Testing Trust Arbiter ---');
    const arbiter = TrustArbiter.getInstance();
    const company: CompanyInput = {
        company_name: 'Barilla',
        city: 'Parma',
        piva: '12345678901'
    };

    // Correct DataPoint Structure
    const candidates = [
        {
            value: 'https://www.barilla.com',
            source: 'WEBSITE_DIRECT' as any,
            timestamp: Date.now(),
            confidence: 0.9
        },
        {
            value: 'https://www.barilla.it',
            source: 'PAGINEGIALLE' as any,
            timestamp: Date.now(),
            confidence: 0.85
        }
    ];

    Logger.info('Resolving conflict between .com (0.9) and .it (0.85)...');
    const best = arbiter.resolve(candidates);
    console.log('Winner:', best);

    if (best === 'https://www.barilla.com') Logger.info('✅ Arbiter selected highest confidence');
    else Logger.warn('❌ Arbiter failed logic');
}

async function main() {
    try {
        await testTrustArbiter(); // Fast
        await testSearchProviders(); // Slow (Browser)
    } catch (e) {
        console.error(e);
    }
}

main();
