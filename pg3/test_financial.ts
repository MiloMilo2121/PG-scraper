
import { FinancialService } from './src/core/financial/service';
import { Logger } from './src/utils/logger';

async function test() {
    const service = new FinancialService();
    const company = { company_name: "TECO SPA", city: "BRESCIA" } as any;
    Logger.info("TESTING ENRICHMENT FOR TECO SPA...");
    const data = await service.enrich(company);
    console.log("RESULT:", JSON.stringify(data, null, 2));
    process.exit(0);
}

test();
