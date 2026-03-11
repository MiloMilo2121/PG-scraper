
import { LLMValidator } from '../src/enricher/core/ai/llm_validator';
import { CompanyInput } from '../src/enricher/types';
import { ModelRouter } from '../src/enricher/core/ai/model_router';
import { Logger } from '../src/enricher/utils/logger';
import * as dotenv from 'dotenv';
dotenv.config();

async function testPrompts() {
    Logger.info('🧪 Testing Prompt Engineering 2.0 Implementation...');

    // Mock Data
    const company: CompanyInput = {
        name: 'Test Srl',
        company_name: 'Test Srl',
        city: 'Milano',
        vat_code: '12345678901'
    };

    const mockHtml = `
        <html>
            <body>
                <h1>Benvenuti in Test Srl - Milano</h1>
                <p>Leader nelle soluzioni software.</p>
                <footer>P.IVA 12345678901 - Via Roma 1, Milano</footer>
            </body>
        </html>
    `;

    const mockSerp = [
        { url: 'https://www.testsrl.it', title: 'Test Srl - Milano', snippet: 'Sito ufficiale di Test Srl a Milano.' },
        { url: 'https://www.paginegialle.it/testsrl', title: 'Test Srl - PagineGialle', snippet: 'Scheda azienda...' }
    ];

    // 1. Test VALIDATE_COMPANY_PROMPT
    Logger.info('\n🔬 1. Testing Validation Prompt...');
    const valResult = await LLMValidator.validateCompany(company, mockHtml);
    console.log('Validation Result:', JSON.stringify(valResult, null, 2));

    if ((valResult.matchedSignals?.length || 0) > 0 || (valResult.rejectedSignals?.length || 0) > 0) {
        Logger.info('✅ Validation evidence fields captured successfully!');
    } else {
        Logger.error('❌ Missing evidence fields in Validation result');
    }

    // 2. Test SELECT_BEST_URL_PROMPT
    Logger.info('\n🔬 2. Testing URL Selection Prompt...');
    const selResult = await LLMValidator.selectBestUrl(company, mockSerp);
    console.log('Selection Result:', JSON.stringify(selResult, null, 2));

    if ((selResult.signals?.length || 0) > 0) {
        Logger.info('✅ Selection evidence fields captured successfully!');
    } else {
        Logger.error('❌ Missing evidence fields in Selection result');
    }
}

testPrompts().catch(console.error);
