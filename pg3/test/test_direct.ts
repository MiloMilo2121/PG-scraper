
import { SearchService } from './src/core/discovery/search_service';
import { Logger } from './src/utils/logger';
import { RateLimiter } from './src/utils/rate_limit';

async function test() {
    process.env.NODE_ENV = 'development'; // Force pretty logs

    const service = new SearchService();
    const company = {
        company_name: 'Officine Verbano Srl',
        city: 'Codogno',
        province: 'LO',
        piva: '0377436425'
    };

    console.log('🚀 TESTING SEARCH SERVICE...');
    console.log(`RateLimiter status for bing: ${RateLimiter.isBlocked('bing') ? 'BLOCKED' : 'OK'}`);

    const result = await service.findWebsite(company as any);

    console.log('-----------------------------------');
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log('-----------------------------------');

    await service.close();
    process.exit(0);
}

test().catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
});
