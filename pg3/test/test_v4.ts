
import { UnifiedDiscoveryServiceV4, DiscoveryModeV4 } from './src/core/discovery/v4/unified_service_v4';
import { GoogleSearchProvider, DDGSearchProvider, BingSearchProvider } from './src/core/discovery/v4/providers/search_providers';
import { StandardAnalyzer } from './src/core/discovery/v4/providers/analysis_providers';
import { CompanyInput } from './src/core/company_types';
import { Logger } from './src/utils/logger';
import { BrowserFactory } from './src/core/browser/factory_v2';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    Logger.info('🧪 Testing UnifiedDiscoveryService V4 (Isolated Profile)...');

    // 0. Setup Isolated Browser Factory
    const testProfile = path.join(process.cwd(), 'temp_profiles', 'test_v4_runner');
    // Clean previous run
    if (fs.existsSync(testProfile)) {
        try { fs.rmSync(testProfile, { recursive: true, force: true }); } catch (e) { }
    }

    // Instantiate with custom profile
    const browserFactory = BrowserFactory.getInstance(testProfile);

    // 1. Setup Providers with Injection
    const searchProviders = [
        new GoogleSearchProvider(browserFactory),
        new DDGSearchProvider(browserFactory),
        new BingSearchProvider(browserFactory)
    ];
    const analyzer = new StandardAnalyzer(browserFactory);

    // 2. Initialize Service
    const service = new UnifiedDiscoveryServiceV4(searchProviders, analyzer);

    // 3. Test Inputs
    const testCompanies: CompanyInput[] = [
        {
            company_name: 'Ferrari S.p.A.',
            city: 'Maranello',
            province: 'MO',
            category: 'Automobili',
            address: 'Via Abetone Inferiore 4',
            zip_code: '41053',
            region: 'Emilia-Romagna',
            phone: '',
            vat: ''
        },
        {
            company_name: 'Trattoria La Buca',
            city: 'Zibello',
            province: 'PR',
            category: 'Ristoranti'
        }
    ];

    // 4. Execute
    for (const company of testCompanies) {
        console.log(`\n🔍 Testing: ${company.company_name}`);
        const result = await service.discover(company, DiscoveryModeV4.FAST_RUN1);
        console.log('Result:', JSON.stringify(result, null, 2));
    }

    // Cleanup
    await browserFactory.close();
    process.exit(0);
}

main().catch(console.error);
