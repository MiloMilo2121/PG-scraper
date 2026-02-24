import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { UnifiedDiscoveryService, DiscoveryMode } from '../enricher/core/discovery/unified_discovery_service';
import { CompanyInput } from '../enricher/types';

// Mock all Google/Search providers — we are testing VX ONLY
import { GoogleBrowserProvider } from '../enricher/core/discovery/google_browser_provider';
import { SerperSearchProvider, GoogleSearchProvider } from '../enricher/core/discovery/search_provider';

GoogleBrowserProvider.prototype.search = async () => [];
SerperSearchProvider.prototype.search = async () => [];
GoogleSearchProvider.prototype.search = async () => [];

async function runBenchmark() {
    console.log("🚀 OMEGA V6.3 - HYPERGUESSER VX ONLY (100 COMPANIES) 🚀\n");

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

    const targetCompanies = records.slice(0, 100);
    console.log(`📊 Loaded ${targetCompanies.length} companies from ${csvPath}`);

    const service = new UnifiedDiscoveryService();

    let successCount = 0;

    // Array to store the proofs
    const proofs: { name: string, url: string, conf: number }[] = [];
    const failures: string[] = [];

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
            console.log(`   [Action] Launching HyperGuesser VX...`);
            const result = await service.discover(c, DiscoveryMode.HYPERGUESSER_VX_ONLY);

            if (result.status === 'FOUND_VALID') {
                console.log(`   ✅ VX TROVATO: ${result.url} (Conf: ${result.confidence.toFixed(2)})`);
                successCount++;
                proofs.push({ name: c.company_name, url: result.url!, conf: result.confidence });
            } else {
                console.log(`   ❌ NON TROVATO (${result.reason_code || result.status})`);
                failures.push(c.company_name);
            }
        } catch (e: any) {
            console.log(`   ⚠️ ERRORE: ${e.message}`);
            failures.push(c.company_name);
        }

        // Print intermediate progress every 10 companies
        if ((i + 1) % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n📊 --- CHECKPOINT [${i + 1}/${companiesToTest.length}] --- Trovati: ${successCount} | Tempo: ${elapsed}s ---`);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const durationMin = (parseFloat(duration) / 60).toFixed(1);
    console.log(`\n=========================================`);
    console.log(`🏆 RISULTATI BENCHMARK HYPERGUESSER VX (100 AZIENDE)`);
    console.log(`=========================================`);
    console.log(`Totale analizzati: ${companiesToTest.length}`);
    console.log(`Successi (Solo VX): ${successCount}`);
    console.log(`Tasso di Successo: ${((successCount / companiesToTest.length) * 100).toFixed(1)}%`);
    console.log(`Tempo totale: ${duration} secondi (${durationMin} minuti)`);
    console.log(`Media per azienda: ${(parseFloat(duration) / companiesToTest.length).toFixed(1)}s`);
    console.log(`\n📜 PROVE — SITI TROVATI:`);
    proofs.forEach((p, i) => {
        console.log(`   ${i + 1}. [${p.name}] -> ${p.url} (Conf: ${p.conf})`);
    });
    console.log(`\n❌ NON TROVATI (${failures.length}):`);
    failures.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f}`);
    });
    console.log(`=========================================\n`);

    process.exit(0);
}

runBenchmark();
