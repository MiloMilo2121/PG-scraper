
import { LLMOracle } from '../enricher/core/discovery/llm_oracle';
import { CompanyInput } from '../enricher/types';

async function test() {
    console.log("🔮 Testing LLMOracle 🔮\n");

    const companies: CompanyInput[] = [
        {
            company_name: "Ferrari S.p.A.",
            city: "Maranello",
            province: "MO",
            id: "test1"
        } as any,
        {
            company_name: "Barilla G. e R. Fratelli",
            city: "Parma",
            province: "PR",
            category: "Alimentare",
            id: "test2"
        } as any
    ];

    for (const company of companies) {
        console.log(`--- Asking Oracle about: ${company.company_name} ---`);
        const start = Date.now();
        const url = await LLMOracle.predictWebsite(company);
        const duration = Date.now() - start;
        console.log(`Result: ${url} (took ${duration}ms)`);

        if (url) {
            console.log("✅ Oracle spoke.");
        } else {
            console.log("❌ Oracle was silent.");
        }
        console.log("\n");
    }

    // Test Caching (Second run should be faster)
    console.log("--- Testing Cache Speed ---");
    const company = companies[0];
    const start = Date.now();
    const url = await LLMOracle.predictWebsite(company);
    const duration = Date.now() - start;
    console.log(`Result: ${url} (took ${duration}ms)`);
    if (duration < 100) {
        console.log("✅ Cache HIT (Speed confirmed)");
    } else {
        console.log("⚠️ Cache Miss or Slow Redis");
    }
}

test();
