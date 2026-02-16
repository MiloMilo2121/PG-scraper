
import { UnifiedDiscoveryService, DiscoveryMode } from '../enricher/core/discovery/unified_discovery_service';
import { CompanyInput } from '../enricher/types';
import { Logger } from '../enricher/utils/logger';

async function test() {
    console.log("Ω TESTING OMEGA PROTOCOL FULL LOOP Ω\n");

    const service = new UnifiedDiscoveryService();

    const company: CompanyInput = {
        id: "omega_test_1",
        company_name: "Ferrari S.p.A.", // Should be found by LLM or Surgical
        city: "Maranello",
        province: "MO",
        address: "Via Abetone Inferiore 4",
        vat_number: "00159560366", // Real Ferrari VAT
        category: "Automotive"
    } as any;

    console.log(`--- Discovery for: ${company.company_name} ---`);
    console.log(`--- Mode: NUCLEAR_RUN4 (Full Arsenal) ---`);

    const start = Date.now();
    try {
        const result = await service.discover(company, DiscoveryMode.NUCLEAR_RUN4);
        const duration = Date.now() - start;

        console.log(`\n✅ RESULT: ${result.status} (${duration}ms)`);
        console.log(`   URL: ${result.url}`);
        console.log(`   Method: ${result.method}`);
        console.log(`   Confidence: ${result.confidence}`);
        console.log(`   Wave: ${result.wave}`);

        if (result.details) {
            console.log(`   Details:`, JSON.stringify(result.details, null, 2));
        }

    } catch (e) {
        console.error("❌ DISCOVERY FAILED:", e);
    }
}

test();
