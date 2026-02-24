import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { UnifiedDiscoveryService, DiscoveryMode } from '../enricher/core/discovery/unified_discovery_service';
import { CompanyInput } from '../enricher/types';
import { Logger } from '../enricher/utils/logger';

async function runBenchmark() {
    console.log("🚀 OMEGA V6.3 - 100 COMPANY BENCHMARK 🚀\n");

    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error("❌ Errore: Fornisci il percorso di un file CSV. Esempio:");
        console.error("   npx ts-node src/scripts/v6_benchmark_100.ts output_server/campaigns/archive/MASTER_HETZNER_MISSING_ONLY.csv");
        process.exit(1);
    }

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';']
    });

    const targetCompanies = records.slice(0, 100);
    console.log(`📊 Loaded ${targetCompanies.length} companies from ${csvPath}`);

    const service = new UnifiedDiscoveryService();
    let successCount = 0;

    // Convert CSV rows to CompanyInput
    const companiesToTest: CompanyInput[] = targetCompanies.map((r: any, idx: number) => ({
        id: `bench_${idx}`,
        company_name: r.company_name || r.ragione_sociale || r.name,
        city: r.city || r.citta || '',
        province: r.province || r.provincia || '',
        address: r.address || r.indirizzo || '',
        vat_code: r.vat || r.piva || r.vat_code || r.vat_number || '',
        phone: r.phone || r.telefono || ''
    }));

    console.log("🏁 Inizio Benchmark...");
    const startTime = Date.now();

    for (let i = 0; i < companiesToTest.length; i++) {
        const c = companiesToTest[i];
        console.log(`\n▶️ [${i + 1}/${companiesToTest.length}] Cerco: ${c.company_name} (${c.city})...`);
        try {
            const result = await service.discover(c, DiscoveryMode.NUCLEAR_RUN4);
            if (result.status === 'FOUND_VALID') {
                console.log(`   ✅ TROVATO: ${result.url} (Conf: ${result.confidence.toFixed(2)}, Metodo: ${result.method})`);
                successCount++;
            } else {
                console.log(`   ❌ NON TROVATO (${result.reason_code})`);
            }
        } catch (e: any) {
            console.log(`   ⚠️ ERRORE: ${e.message}`);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=========================================`);
    console.log(`🏆 RISULTATI BENCHMARK OMEGA V6.3`);
    console.log(`=========================================`);
    console.log(`Totale analizzati: ${companiesToTest.length}`);
    console.log(`Successi (FOUND_VALID): ${successCount}`);
    console.log(`Tasso di Successo: ${((successCount / companiesToTest.length) * 100).toFixed(1)}%`);
    console.log(`Tempo totale: ${duration} secondi`);
    console.log(`=========================================\n`);

    process.exit(0);
}

runBenchmark();
