
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';
import pLimit from 'p-limit';
import { FinancialService } from './src/core/financial/service';
import { Logger } from './src/utils/logger';
import { CompanyInput } from './src/core/company_types';
import * as dotenv from 'dotenv';

dotenv.config();

const INPUT_FILE = process.argv[2] || 'output/campaigns/BOARD_FINAL_SANITISED.csv';
const OUTPUT_FILE = 'output/campaigns/BOARD_ENRICHED_PHASE2.csv';
const FINANCIAL_SERVICE = new FinancialService();

async function main() {
    Logger.info('🚀 STARTING FINANCIAL ENRICHMENT PHASE 2');

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        process.exit(1);
    }

    const companies = await loadCompanies(INPUT_FILE);
    Logger.info(`📊 Loaded ${companies.length} companies for enrichment.`);

    const csvWriter = createObjectCsvWriter({
        path: OUTPUT_FILE,
        header: [
            { id: 'company_name', title: 'company_name' },
            { id: 'city', title: 'city' },
            { id: 'province', title: 'province' },
            { id: 'address', title: 'address' },
            { id: 'phone', title: 'phone' },
            { id: 'website', title: 'website' },
            { id: 'category', title: 'category' },
            { id: 'vat', title: 'vat' },
            { id: 'revenue', title: 'revenue' },
            { id: 'employees', title: 'employees' },
            { id: 'source', title: 'source' }
        ]
    });

    const limit = pLimit(5); // Adjust based on server resources
    let processed = 0;

    const tasks = companies.map(company => limit(async () => {
        try {
            console.log(`🔍 [${processed + 1}/${companies.length}] Enriching: ${company.company_name}...`);
            const data = await FINANCIAL_SERVICE.enrich(company, company.website);

            const record = {
                ...company,
                vat: data.vat || '',
                revenue: data.revenue || '',
                employees: data.employees || '',
                source: data.source || 'Scraped'
            };

            await csvWriter.writeRecords([record]);
        } catch (e) {
            console.error(`❌ Error enriching ${company.company_name}:`, (e as Error).message);
        } finally {
            processed++;
        }
    }));

    await Promise.all(tasks);
    Logger.info(`✨ PHASE 2 COMPLETE! Saved results to ${OUTPUT_FILE}`);
}

async function loadCompanies(filePath: string): Promise<any[]> {
    return new Promise((resolve) => {
        const rows: any[] = [];
        fs.createReadStream(filePath)
            .pipe(parse({ headers: true, strictColumnHandling: false }))
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows));
    });
}

main().catch(console.error);
