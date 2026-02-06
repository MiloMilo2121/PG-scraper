/**
 * 🧪 AUDIT 2: FINANCIAL TEST
 * Verifies the P.IVA conditional logic is working
 * 
 * What to look for:
 * - System should find P.IVA for a known company
 * - Should log "🎯 P.IVA found... Targeting UfficioCamerale"
 * - Should return revenue/employees if available
 * 
 * Usage: npx ts-node scripts/test-financial.ts
 */

import { FinancialService, FinancialData } from '../src/enricher/core/financial/service';
import { CompanyInput } from '../src/enricher/types';
import { Logger } from '../src/enricher/utils/logger';

async function runFinancialAudit() {
    Logger.info('🧪 AUDIT 2: FINANCIAL TEST - Verifying P.IVA Logic');

    const service = new FinancialService();

    // Test company: Barilla (well-known, should have public data)
    const testCompany: CompanyInput = {
        company_name: 'Barilla G. e R. Fratelli',
        city: 'Parma',
        address: 'Via Mantova 166',
    };

    Logger.info(`📍 Testing: "${testCompany.company_name}" in "${testCompany.city}"`);
    Logger.info('');

    try {
        const result: FinancialData = await service.enrich(testCompany);

        Logger.info('');
        Logger.info('📊 RESULTS:');
        Logger.info('================');
        console.log('   P.IVA:', result.vat || 'NOT FOUND');
        console.log('   Revenue:', result.revenue || 'NOT FOUND');
        console.log('   Employees:', result.employees || 'NOT FOUND');
        console.log('   Estimated:', result.isEstimatedEmployees ? 'Yes' : 'No');
        console.log('   PEC:', result.pec || 'NOT FOUND');
        console.log('   Source:', result.source || 'Unknown');

        Logger.info('');

        // Validation
        if (result.vat) {
            Logger.info('✅ P.IVA FOUND - P.IVA conditional path executed');
        } else {
            Logger.warn('⚠️ P.IVA NOT FOUND - Name-based search path used');
        }

        if (result.revenue) {
            Logger.info('✅ REVENUE FOUND - Financial data extraction working');
        } else {
            Logger.warn('⚠️ REVENUE NOT FOUND - May need manual verification');
        }

        Logger.info('');
        Logger.info('🎯 AUDIT 2 COMPLETE');
        Logger.info('================');
        Logger.info('Check logs above for "🎯 P.IVA found... Targeting UfficioCamerale"');
        Logger.info('This indicates the P.IVA → Registry path was executed.');

    } catch (error: any) {
        Logger.error('❌ AUDIT 2 FAILED:', { message: error.message, stack: error.stack });
        throw error;
    }

    process.exit(0);
}

runFinancialAudit().catch((err) => {
    Logger.error('Fatal error:', err);
    process.exit(1);
});
