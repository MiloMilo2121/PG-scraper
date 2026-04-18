import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';

async function runBenchmark() {
    console.log("🚀 OMEGA V8.0 - BENCHMARK (REAL WORLD TARGET) 🚀\n");

    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error("❌ Errore: Fornisci il percorso di un file CSV (es. input/benchmark_50.csv).");
        process.exit(1);
    }

    const BATCH_SIZE = 50; 
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';']
    });

    const targetCompanies = records.slice(0, BATCH_SIZE);
    console.log(`📊 Loaded ${targetCompanies.length} companies from ${csvPath}`);

    // Init runtime
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const { createOmegaRuntime } = await import('../enricher/runtime/runtime_factory');
    const runtime = await createOmegaRuntime();
    const { pipeline, cache, registry, pool } = runtime;

    console.log("\n🔍 Diagnostica Runtime:");
    console.log(`   Redis: ${await cache.ping() ? '✅ OK' : '❌ Assente'}`);
    console.log(`   Registry: ${registry.getStatus() ? '✅ OK' : '❌ Assente'}`);
    
    let successCount = 0;
    const proofs: { name: string, url: string, status: string, confidence: string }[] = [];
    const failures: { name: string, status: string, error: string }[] = [];

    console.log("\n🏁 Inizio Benchmark...\n");
    const startTime = Date.now();

    for (let i = 0; i < targetCompanies.length; i++) {
        const row = targetCompanies[i];
        const name = row.company_name || row.ragione_sociale || row.name;
        const city = row.city || row.citta || '';
        
        console.log(`▶️ [${i + 1}/${targetCompanies.length}] Analisi: ${name} (${city})`);
        try {
            const result = await pipeline.processCompany(row, i);

            if (result.status === 'FOUND_COMPLETE' || result.status === 'ENRICHMENT_ONLY_NO_WEBSITE') {
                const isFoundComplete = result.status === 'FOUND_COMPLETE';
                const url = result.website?.url || 'NESSUN SITO';
                const conf = result.website?.confidence !== undefined ? result.website.confidence.toFixed(2) : '-';
                
                if (isFoundComplete) {
                    console.log(`   ✅ SITO TROVATO: ${url} (Conf: ${conf}, Layer: ${result.website?.discovery_layer})`);
                    successCount++;
                } else {
                    console.log(`   🟡 SOLO ARRICCHIMENTO: Nessun sito web valido confermato, ma estratti dati finanziari.`);
                }
                
                proofs.push({ name, url, status: result.status, confidence: conf });
            } else {
                console.log(`   ❌ NON TROVATO (Status: ${result.status})`);
                failures.push({ name, status: result.status, error: result.error || '' });
            }
        } catch (e: any) {
            console.log(`   ⚠️ CRASH: ${e.message}`);
            failures.push({ name, status: 'WORKER_EXCEPTION', error: e.message });
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n=========================================`);
    console.log(`🏆 RISULTATI BENCHMARK OMEGA V8`);
    console.log(`=========================================`);
    console.log(`Target: ${targetCompanies.length} aziende (${BATCH_SIZE} max)`);
    console.log(`Siti trovati: ${successCount}`);
    console.log(`Tasso di Successo URL: ${((successCount / targetCompanies.length) * 100).toFixed(1)}%`);
    console.log(`Tempo totale: ${duration}s / Media: ${(parseFloat(duration) / targetCompanies.length).toFixed(1)}s`);
    
    console.log(`\n📜 PROVE — SITI E DATI (Campione):`);
    proofs.slice(0, 50).forEach((p, i) => {
        console.log(`   ${i + 1}. [${p.name}] -> ${p.url} (Conf: ${p.confidence}) - ${p.status}`);
    });

    console.log(`\n❌ FALLITI (${failures.length}):`);
    failures.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f.name} -> ${f.status} ${f.error ? `(${f.error})` : ''}`);
    });
    console.log(`=========================================\n`);

    await runtime.cleanup();
    process.exit(0);
}

if (require.main === module) {
    runBenchmark().catch(err => {
        console.error('Fatal Benchmark Error:', err);
        process.exit(1);
    });
}
