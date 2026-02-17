
import { IdentityResolver } from '../core/discovery/identity_resolver';
import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';
import { ScraperClient } from '../utils/scraper_client';

async function test() {
    console.log('🧪 Testing AI Employee Estimation...');

    // 1. Check Scrape.do status
    console.log(`🔓 Scrape.do Enabled: ${ScraperClient.isScrapeDoEnabled()}`);

    // 2. Test Company (OpenAI - likely to be found and have info)
    const company: CompanyInput = {
        company_name: 'OpenAI',
        city: 'San Francisco',
        country: 'US'
    };

    // We mock a known URL to skip discovery and test the specific function
    const testUrl = 'https://openai.com';

    console.log(`🎯 Target: ${company.company_name} (${testUrl})`);

    const resolver = new IdentityResolver();
    const employees = await resolver.estimateEmployeesFromWebsite(company, testUrl);

    console.log('---------------------------------------------------');
    console.log('📊 AI RESULT:');
    console.log(`Employees: ${employees}`);
    console.log('---------------------------------------------------');
}

test().catch(console.error);
