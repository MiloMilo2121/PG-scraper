
import * as dotenv from 'dotenv';
import { FinancialService } from '../src/enricher/core/financial/service';
import { CompanyInput } from '../src/enricher/types';
import { Logger } from '../src/enricher/utils/logger';

dotenv.config();

const testCompanies: CompanyInput[] = [
    {
        company_name: "Autoriparazioni Fornaci",
        address: "Lombardia Via Quinzano, 81/D - 25030 Castel Mella (BS)",
        city: "Castel Mella (Brescia)", // Adjusted city/province parsing manually for test
        province: "BS",
        phone: "030 2681124",
        country: "IT"
    },
    {
        company_name: "Meccatronica S.r.l.",
        address: "Lombardia Via Statale, 48/N - 25011 Calcinato (BS)",
        city: "Calcinato (Brescia)",
        province: "BS",
        phone: "030 9636544",
        country: "IT"
    },
    {
        company_name: "Ferri Motori",
        address: "Lombardia Via Vittorio Veneto, 125 - 24020 Songavazzo (BG)",
        city: "Songavazzo (Bergamo)",
        province: "BG",
        phone: "0346 73426",
        country: "IT"
    },
    {
        company_name: "ITS Lombardia Meccatronica Academy",
        address: "Sesto San Giovanni, Metropolitan City of Milan, Italy",
        city: "Sesto San Giovanni",
        province: "MI",
        phone: "+39 02 262921",
        country: "IT"
    },
    {
        company_name: "Costelmec Gru a Ponte Industriali",
        address: "Sede a Parma (PR) Lavora in trasferta",
        city: "Parma",
        province: "PR",
        phone: "0521 986391",
        country: "IT"
    },
    {
        company_name: "G.Z. Impianti",
        address: "Sede a Manerbio (BS) Lavora in trasferta",
        city: "Manerbio",
        province: "BS",
        phone: "030 9937829",
        country: "IT"
    },
    {
        company_name: "Valbia",
        address: "Sede a Lumezzane (BS) Lavora in trasferta",
        city: "Lumezzane",
        province: "BS",
        phone: "030 8969411",
        country: "IT"
    },
    {
        company_name: "Automazioni Industriali Capitanio S.r.l.",
        address: "Lombardia Via Cavallera, 20 - 25030 Torbole Casaglia (BS)",
        city: "Torbole Casaglia",
        province: "BS",
        phone: "0365 826333",
        country: "IT"
    },
    {
        company_name: "Pasetti Mario Elettricista",
        address: "Lombardia Via Roncadelle, 58 - 25030 Castel Mella (BS)",
        city: "Castel Mella",
        province: "BS",
        phone: "347 2685799",
        country: "IT"
    },
    {
        company_name: "Gruppo Pedercini - Elettro 2000 - Pcombustion",
        address: "Lombardia Via Pietro Mascagni, 14 - 25080 Nuvolera (BS)",
        city: "Nuvolera",
        province: "BS",
        phone: "030 6915119",
        country: "IT"
    }
];

async function runTest() {
    Logger.info("🚀 STARTING OMEGA TEST RUN - 10 COMPANIES");

    // Check Config
    if (!process.env.OPENAI_API_KEY) {
        Logger.warn("⚠️ OPENAI_API_KEY missing. AI estimation will be skipped.");
    }

    const service = new FinancialService();

    for (const [index, company] of testCompanies.entries()) {
        Logger.info(`\n--------------------------------------------------`);
        Logger.info(`Processing ${index + 1}/10: ${company.company_name}`);
        Logger.info(`📍 ${company.city} (${company.province}) | 📞 ${company.phone}`);

        try {
            const start = Date.now();
            const result = await service.enrich(company);
            const duration = ((Date.now() - start) / 1000).toFixed(2);

            Logger.info(`✅ DONE in ${duration}s`);
            Logger.info(`📊 RESULTS:`, {
                vat: result.vat || 'N/A',
                revenue: result.revenue || 'N/A',
                employees: result.employees || 'N/A',
                pec: result.pec || 'N/A',
                source: result.source || 'N/A'
            });
        } catch (error) {
            Logger.error(`❌ FAILED: ${(error as Error).message}`);
        }
    }

    Logger.info("\n🏁 OMEGA TEST RUN COMPLETE");
    process.exit(0);
}

runTest().catch(e => {
    console.error("Fatal Script Error:", e);
    process.exit(1);
});
