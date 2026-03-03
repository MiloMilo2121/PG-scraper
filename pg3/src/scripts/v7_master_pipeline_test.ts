import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { MasterPipeline } from '../foundation/MasterPipeline';
import { CompanyInput, NormalizedInput } from '../enricher/types';

async function runTest() {
    console.log("🚀 OMEGA V7.0 - MASTER PIPELINE TEST (SPRINT 1) 🚀\n");

    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error("❌ Errore: Fornisci il percorso di un file CSV.");
        process.exit(1);
    }

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';']
    });

    const targetCompanies = records.slice(0, 5);
    console.log(`📊 Loaded ${targetCompanies.length} companies from ${csvPath}`);

    const pipeline = new MasterPipeline({
        maxConcurrency: 1,
        proxyTier: 2,
        llmTier: 1,
        bleedingMode: false
    });

    let successCount = 0;
    const failures: string[] = [];

    console.log("🏁 Inizio MasterPipeline Test...");
    const startTime = Date.now();

    for (let i = 0; i < targetCompanies.length; i++) {
        const c = targetCompanies[i] as any;
        console.log(`\n▶️ [${i + 1}/${targetCompanies.length}] Cerco: ${c.ragione_sociale || c.company_name} (${c.citta || c.city})...`);

        const input: NormalizedInput = {
            company_name: c.company_name || c.ragione_sociale || c.name,
            city: c.city || c.citta || '',
            province: c.province || c.provincia || '',
            domain: ''
        };

        const rawInput = {
            vat: c.vat || c.piva || c.vat_code || c.vat_number || '',
            phone: c.phone || c.telefono || ''
        };

        try {
            console.log(`   [Action] Lancia MasterPipeline...`);
            const combinedInput = { ...c, ...input, ...rawInput };
            const result = await pipeline.processCompany(combinedInput, i);

            if (result.status === 'FOUND_COMPLETE') {
                console.log(`   ✅ PIPELINE TROVATO: ${result.discovered_url} (Layer: ${result.discovery_layer})`);
                successCount++;
            } else {
                console.log(`   ❌ NON TROVATO (Status: ${result.status})`);
                failures.push(input.company_name);
            }
        } catch (e: any) {
            console.log(`   ⚠️ ERRORE: ${e.message}`);
            failures.push(input.company_name);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=========================================`);
    console.log(`🏆 RISULTATI SPRINT 1 (MASTER PIPELINE)`);
    console.log(`=========================================`);
    console.log(`Totale analizzati: ${targetCompanies.length}`);
    console.log(`Successi: ${successCount}`);
    console.log(`Tasso di Successo: ${((successCount / targetCompanies.length) * 100).toFixed(1)}%`);
    console.log(`Tempo totale: ${duration} secondi`);

    // Shutdown logic usually handled elsewhere or omit
    process.exit(0);
}

runTest().catch(console.error);
