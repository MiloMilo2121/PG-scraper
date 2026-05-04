import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import pLimit from 'p-limit';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';

interface WaveRecord {
    company_name: string;
    city: string;
    address?: string;
    query_category?: string;
    website_url?: string;
    website_confidence?: string;
    website_layer?: string;
    inline_fatturato?: string;
    inline_anno?: string;
    inline_pec?: string;
    inline_ateco?: string;
    inline_dipendenti?: string;
    status: 'pending' | 'found' | 'failed' | 'no_website';
    error?: string;
}

function saveCsv(records: WaveRecord[], outputPath: string) {
    if (records.length === 0) return;
    const csv = stringify(records, { header: true });
    fs.writeFileSync(outputPath, csv, 'utf8');
    console.log(`\n💾 Checkpoint saved: ${outputPath} (${records.length} records)\n`);
}

async function runDiscoveryWave() {
    console.log('🚀 OMEGA V8 — DISCOVERY ONLY WAVE 🚀\n');

    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('❌ Usage: npx tsx src/scripts/v8_discovery_only.ts <input.csv>');
        process.exit(1);
    }

    const CONCURRENCY = parseInt(process.env.WAVE1_CONCURRENCY ?? '10', 10);

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rawRecords = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';'],
    });

    // Process ALL records instead of limiting to a BATCH_SIZE
    const inputRows: Record<string, string>[] = rawRecords;
    console.log(`📊 Loaded ${inputRows.length} companies from ${csvPath}`);
    console.log(`⚙️  Concurrency: ${CONCURRENCY}\n`);

    // Initialize runtime
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const { createOmegaRuntime } = await import('../enricher/runtime/runtime_factory');
    const runtime = await createOmegaRuntime();
    const { pipeline, cache, registry } = runtime;

    // Check dependencies
    console.log('🔍 Diagnostica Runtime:');
    console.log(`   Redis: ${await cache.ping() ? '✅ OK' : '❌ Assente'}`);
    console.log(`   Registry: ${registry.getStatus() ? '✅ OK' : '❌ Assente'}`);

    // Website-discovery only: bypass downstream enrichment stages entirely
    (pipeline as any).postDiscoveryEnrichment = {
        run: async () => ({
            financial: null, decisionMaker: null, employees: null, isEstimatedEmployees: false, vat: null, pec: null, email: null,
            stageOutcomes: {}
        })
    };

    const outputBase = path.basename(csvPath, '.csv');
    const outputPath = path.join(path.dirname(csvPath), `${outputBase}_discovery_results.csv`);

    // Initialize records
    const records: WaveRecord[] = inputRows.map(row => ({
        company_name: row.company_name || row.ragione_sociale || row.name || '?',
        city: row.city || row.citta || '',
        address: row.address || '',
        query_category: row.query_category || '',
        status: 'pending',
    }));

    const totalStart = Date.now();

    console.log('\n══════════════════════════════════════════════════');
    console.log(`🌊 WAVE 1: Website Discovery (${records.length} companies)`);
    console.log('══════════════════════════════════════════════════\n');

    const limit = pLimit(CONCURRENCY);
    let foundCount = 0;
    let processed = 0;

    await Promise.allSettled(
        records.map((rec, i) =>
            limit(async () => {
                try {
                    const result = await pipeline.processCompany(inputRows[i], i);
                    
                    const inlineFatturato = (inputRows[i] as any).inline_financials?.fatturato_current;
                    const inlineAnno = (inputRows[i] as any).inline_financials?.year;
                    const inlinePec = (inputRows[i] as any).inline_extra?.pec;
                    const inlineAteco = (inputRows[i] as any).inline_extra?.ateco;
                    const inlineDipendenti = (inputRows[i] as any).inline_extra?.dipendenti;
                    
                    if (inlineFatturato) rec.inline_fatturato = String(inlineFatturato);
                    if (inlineAnno) rec.inline_anno = String(inlineAnno);
                    if (inlinePec) rec.inline_pec = inlinePec;
                    if (inlineAteco) rec.inline_ateco = inlineAteco;
                    if (inlineDipendenti) rec.inline_dipendenti = String(inlineDipendenti);

                    if (result.status === 'FOUND_COMPLETE') {
                        rec.website_url = result.website?.url;
                        rec.website_confidence = result.website?.confidence?.toFixed(2);
                        rec.website_layer = result.website?.discovery_layer;
                        rec.status = 'found';
                        foundCount++;
                        console.log(`   ✅ [${i + 1}/${records.length}] ${rec.company_name} → ${rec.website_url}`);
                    } else if (result.status === 'ENRICHMENT_ONLY_NO_WEBSITE') {
                        rec.status = 'no_website';
                        console.log(`   🟡 [${i + 1}/${records.length}] ${rec.company_name} → Nessun sito`);
                    } else {
                        rec.status = 'failed';
                        rec.error = result.status;
                        console.log(`   ❌ [${i + 1}/${records.length}] ${rec.company_name} → ${result.status}`);
                    }
                } catch (e: any) {
                    rec.status = 'failed';
                    rec.error = e.message;
                    console.log(`   ⚠️  [${i + 1}/${records.length}] ${rec.company_name} → CRASH: ${e.message}`);
                } finally {
                    processed++;
                    // Save checkpoint every 250 records
                    if (processed % 250 === 0) {
                        saveCsv(records, outputPath);
                    }
                }
            })
        )
    );

    const duration = ((Date.now() - totalStart) / 1000).toFixed(1);
    const rate = ((foundCount / records.length) * 100).toFixed(1);
    
    saveCsv(records, outputPath);

    console.log('\n══════════════════════════════════════════════════');
    console.log('🏆 RISULTATI FINALI — DISCOVERY WAVE');
    console.log('══════════════════════════════════════════════════');
    console.log(`📊 Target analizzati:    ${records.length}`);
    console.log(`🌊 Siti Trovati:         ${foundCount}/${records.length} (${rate}%) in ${duration}s`);
    console.log(`\n📁 Output CSV: ${outputPath}`);
    console.log('══════════════════════════════════════════════════\n');

    await runtime.cleanup();
    process.exit(0);
}

if (require.main === module) {
    runDiscoveryWave().catch(err => {
        console.error('Fatal Error:', err);
        process.exit(1);
    });
}
