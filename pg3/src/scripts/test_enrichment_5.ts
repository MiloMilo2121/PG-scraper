import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import pLimit from 'p-limit';
import { createOmegaRuntime } from '../enricher/runtime/runtime_composition';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';
import { EmailPermutator } from '../enricher/utils/email_permutator';
import { OpportunisticExtractor } from '../foundation/OpportunisticExtractor';
import { PecHunter } from '../foundation/PecHunter';
import { LinkedInSniper } from '../foundation/LinkedInSniper';

async function main() {
    console.log('🧪 DRY RUN — ENRICHMENT TEST (5 RECORDS) 🧪\n');

    const INPUT_FILE = path.join(process.cwd(), 'output/campaigns/ENRICHMENT_QUEUE.csv');
    const OUTPUT_FILE = path.join(process.cwd(), 'output/campaigns/TEST_ENRICHMENT_5.csv');

    initializeRuntimeEnvironment();
    initializeRuntimeConfig();
    const runtime = await createOmegaRuntime();
    const { pool, router } = runtime;
    const pecHunter = new PecHunter(pool, router);
    const linkedinSniper = new LinkedInSniper(router);

    const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true }).slice(0, 5);

    const limit = pLimit(2);
    const results: any[] = [];

    const tasks = records.map((record: any, index: number) => limit(async () => {
        const companyId = `test-${index}`;
        console.log(`🔍 [${index + 1}/5] testing: ${record.company_name}...`);

        const enrichment: any = { ...record };

        try {
            // Website Contacts
            const contacts = await pecHunter.hunt(companyId, record, record.website);
            enrichment.email = contacts.email;
            enrichment.pec = contacts.pec;

            // DM Snipe
            const dmResult = await linkedinSniper.snipeDetailed(companyId, record, record.website);
            if (dmResult.decisionMaker) {
                enrichment.dm_name = dmResult.decisionMaker.name;
                enrichment.dm_role = dmResult.decisionMaker.role;
            }

            // Email Inference
            if (enrichment.dm_name && !enrichment.email) {
                const names = enrichment.dm_name.split(' ');
                if (names.length >= 2) {
                    const domain = new URL(record.website).hostname.replace(/^www\./, '');
                    const perms = await EmailPermutator.findEmails(names[0], names[names.length-1], domain, false);
                    if (perms.length > 0) enrichment.email = perms[0].email;
                }
            }

            // Employees
            const page = await pool.navigateSafe(record.website);
            if (page.html) {
                const opp = OpportunisticExtractor.extract(page.html, record.website);
                enrichment.employees = opp.dipendenti;
            }

            console.log(`   ✅ Result: ${enrichment.email || 'N/A'} | ${enrichment.dm_name || 'N/A'}`);
        } catch (e: any) {
            console.error(`   ⚠️ Error: ${e.message}`);
        } finally {
            results.push(enrichment);
        }
    }));

    await Promise.all(tasks);
    fs.writeFileSync(OUTPUT_FILE, stringify(results, { header: true }));
    console.log(`\n✨ Test complete. Output: ${OUTPUT_FILE}`);
    await runtime.cleanup();
}

main().catch(console.error);
