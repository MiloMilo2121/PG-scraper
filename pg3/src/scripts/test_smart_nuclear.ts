
import { NuclearStrategy } from '../enricher/core/discovery/nuclear_strategy';
import { Logger } from '../enricher/utils/logger';

async function test() {
    console.log("🚀 Testing SMART NUCLEAR Strategy (GLM-5)...");

    // Mock Company
    const company = {
        company_name: "Trattoria da Mario",
        city: "Rapallo",
        province: "GE",
        address: "Via Roma 29",
        region: "Liguria",
        country: "Italy",
        zip_code: "16035"
    };

    const strategy = new NuclearStrategy();

    try {
        console.log(`📡 Analyzing SERP for: "${company.company_name}" in ${company.city}...`);

        const result = await strategy.execute(company);

        console.log("---------------------------------------------------");
        console.log(`✅ Method: ${result.method}`);
        console.log(`✅ URL:    ${result.url}`);
        console.log(`✅ Conf:   ${result.confidence}`);

        if (result.method === 'nuclear_smart_ai' && result.confidence > 0.6) {
            console.log("🎉 TEST PASSED: AI successfully selected high-confidence URL!");
        } else if (result.method.includes('legacy')) {
            console.log("⚠️ TEST WARNING: AI failed/unsure, fell back to legacy.");
        } else {
            console.log("❌ TEST FAILED: No results found.");
        }

    } catch (error) {
        console.error("❌ TEST FAILED with Error:", error);
        process.exit(1);
    }
}

test();
