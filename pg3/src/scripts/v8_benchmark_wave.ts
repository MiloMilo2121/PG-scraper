/**
 * v8_benchmark_wave.ts
 *
 * WAVE-BASED BENCHMARK - Architecture by Marco Milanello
 *
 * Three separate waves executed in parallel batches:
 *   Wave 1 → Discover website for ALL companies (parallel, no enrichment bottleneck)
 *   Wave 2 → Fetch financial data for ALL found companies (parallel)
 *   Wave 3 → Find Decision Maker for ALL companies (parallel)
 *
 * Benefits vs per-company:
 *   - BackpressureValve penalizations affect only ONE wave at a time
 *   - Partial CSV saved after each wave (fault-tolerant)
 *   - Total time 3-5x faster than sequential per-company
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import pLimit from 'p-limit';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaveRecord {
    company_name: string;
    city: string;
    address?: string;
    query_category?: string;
    // Wave 1 results
    website_url?: string;
    website_confidence?: string;
    website_layer?: string;
    // Wave 2 results
    fatturato_url?: string;
    fatturato_raw?: string;
    // Wave 3 results
    email?: string;
    pec?: string;
    decision_maker_name?: string;
    decision_maker_title?: string;
    decision_maker_linkedin?: string;
    // Meta
    status: 'pending' | 'found' | 'enriched' | 'failed' | 'no_website';
    error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function logWave(wave: number, msg: string) {
    const icon = ['', '🌊', '💰', '🎯'][wave] ?? '▶️';
    console.log(`${icon} [WAVE ${wave}] ${msg}`);
}

function saveCsv(records: WaveRecord[], outputPath: string) {
    if (records.length === 0) return;
    const csv = stringify(records, { header: true });
    fs.writeFileSync(outputPath, csv, 'utf8');
    console.log(`\n💾 Checkpoint saved: ${outputPath} (${records.length} records)\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runWaveBenchmark() {
    console.log('🚀 OMEGA V8 — WAVE BENCHMARK 🚀\n');

    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('❌ Usage: npx tsx src/scripts/v8_benchmark_wave.ts <input.csv>');
        process.exit(1);
    }

    const WAVE1_CONCURRENCY = parseInt(process.env.WAVE1_CONCURRENCY ?? '8', 10);
    const WAVE2_CONCURRENCY = parseInt(process.env.WAVE2_CONCURRENCY ?? '10', 10);
    const WAVE3_CONCURRENCY = parseInt(process.env.WAVE3_CONCURRENCY ?? '6', 10);
    const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '50', 10);

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rawRecords = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        delimiter: [',', ';'],
    });

    const inputRows: Record<string, string>[] = rawRecords.slice(0, BATCH_SIZE);
    console.log(`📊 Loaded ${inputRows.length} companies from ${csvPath}`);
    console.log(`⚙️  Concurrency — Wave1: ${WAVE1_CONCURRENCY}, Wave2: ${WAVE2_CONCURRENCY}, Wave3: ${WAVE3_CONCURRENCY}\n`);

    // Initialize runtime
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const { createOmegaRuntime } = await import('../enricher/runtime/runtime_factory');
    const runtime = await createOmegaRuntime();
    const { pipeline, cache, registry, pool, router, bleedingCtrl } = runtime;

    // Check dependencies
    console.log('🔍 Diagnostica Runtime:');
    console.log(`   Redis: ${await cache.ping() ? '✅ OK' : '❌ Assente'}`);
    console.log(`   Registry: ${registry.getStatus() ? '✅ OK' : '❌ Assente'}`);

    // Build internal dependencies for granular calls
    const { InputNormalizer } = await import('../foundation/InputNormalizer');
    const { BilancioHunter } = await import('../foundation/BilancioHunter');
    const { LinkedInSniper } = await import('../foundation/LinkedInSniper');
    const { PecHunter } = await import('../foundation/PecHunter');

    const normalizer = new InputNormalizer();
    const bilancioHunter = new BilancioHunter(router);
    const linkedInSniper = new LinkedInSniper(router);
    const pecHunter = new PecHunter(pool, router);

    const outputBase = path.basename(csvPath, '.csv');
    const outputPath = path.join(path.dirname(csvPath), `${outputBase}_wave_results.csv`);

    // Initialize records
    const records: WaveRecord[] = inputRows.map(row => ({
        company_name: row.company_name || row.ragione_sociale || row.name || '?',
        city: row.city || row.citta || '',
        address: row.address || '',
        query_category: row.query_category || '',
        status: 'pending',
    }));

    const totalStart = Date.now();

    // ═══════════════════════════════════════════════════════════════
    //  WAVE 1 — Discover Websites
    // ═══════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════════');
    console.log(`🌊 WAVE 1: Website Discovery (${records.length} companies)`);
    console.log('══════════════════════════════════════════════════\n');

    const wave1Start = Date.now();
    const wave1Limit = pLimit(WAVE1_CONCURRENCY);
    let wave1Found = 0;

    await Promise.allSettled(
        records.map((rec, i) =>
            wave1Limit(async () => {
                try {
                    const result = await pipeline.processCompany(inputRows[i], i);
                    if (result.status === 'FOUND_COMPLETE') {
                        rec.website_url = result.website?.url;
                        rec.website_confidence = result.website?.confidence?.toFixed(2);
                        rec.website_layer = result.website?.discovery_layer;
                        rec.status = 'found';
                        wave1Found++;
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
                }
            })
        )
    );

    const wave1Duration = ((Date.now() - wave1Start) / 1000).toFixed(1);
    const wave1Rate = ((wave1Found / records.length) * 100).toFixed(1);
    console.log(`\n🏁 WAVE 1 DONE: ${wave1Found}/${records.length} siti trovati (${wave1Rate}%) in ${wave1Duration}s`);
    saveCsv(records, outputPath);

    // ═══════════════════════════════════════════════════════════════
    //  WAVE 2 — Financial Enrichment
    // ═══════════════════════════════════════════════════════════════
    const foundRecords = records.filter(r => r.status === 'found' && r.website_url);
    console.log('\n══════════════════════════════════════════════════');
    console.log(`💰 WAVE 2: Financial Enrichment (${foundRecords.length} companies with website)`);
    console.log('══════════════════════════════════════════════════\n');

    const wave2Start = Date.now();
    const wave2Limit = pLimit(WAVE2_CONCURRENCY);
    let wave2Found = 0;

    await Promise.allSettled(
        foundRecords.map((rec, i) =>
            wave2Limit(async () => {
                const rawRow = inputRows.find(r =>
                    (r.company_name || r.ragione_sociale || r.name) === rec.company_name
                ) || {};
                const input = normalizer.normalize(rawRow);
                const companyId = `wave2-${i}`;
                try {
                    const financial = await bilancioHunter.hunt(companyId, input);
                    if (financial) {
                        rec.fatturato_url = financial.source_url ?? '';
                        rec.fatturato_raw = JSON.stringify({
                            fatturato: financial.revenue_eur,
                            dipendenti: financial.employees,
                            anno: financial.year,
                        });
                        rec.status = 'enriched';
                        wave2Found++;
                        console.log(`   💰 [${i + 1}/${foundRecords.length}] ${rec.company_name} → ${financial.revenue_eur ? `€${financial.revenue_eur.toLocaleString()}` : 'dati trovati'}`);
                    } else {
                        console.log(`   ⚠️  [${i + 1}/${foundRecords.length}] ${rec.company_name} → Nessun dato finanziario`);
                    }
                } catch (e: any) {
                    console.log(`   ❌ [${i + 1}/${foundRecords.length}] ${rec.company_name} → ${e.message}`);
                }
            })
        )
    );

    const wave2Duration = ((Date.now() - wave2Start) / 1000).toFixed(1);
    console.log(`\n🏁 WAVE 2 DONE: ${wave2Found}/${foundRecords.length} fatturati trovati in ${wave2Duration}s`);
    saveCsv(records, outputPath);

    // ═══════════════════════════════════════════════════════════════
    //  WAVE 3 — Decision Makers + Email
    // ═══════════════════════════════════════════════════════════════
    const wave3Targets = records.filter(r => r.status === 'found' || r.status === 'enriched');
    console.log('\n══════════════════════════════════════════════════');
    console.log(`🎯 WAVE 3: Decision Makers & Contacts (${wave3Targets.length} companies)`);
    console.log('══════════════════════════════════════════════════\n');

    const wave3Start = Date.now();
    const wave3Limit = pLimit(WAVE3_CONCURRENCY);
    let wave3FoundDM = 0;
    let wave3FoundEmail = 0;

    await Promise.allSettled(
        wave3Targets.map((rec, i) =>
            wave3Limit(async () => {
                const rawRow = inputRows.find(r =>
                    (r.company_name || r.ragione_sociale || r.name) === rec.company_name
                ) || {};
                const input = normalizer.normalize(rawRow);
                const companyId = `wave3-${i}`;

                // Run LinkedIn + PEC in parallel per company
                const [dmResult, emailResult] = await Promise.allSettled([
                    linkedInSniper.snipe(companyId, input, rec.website_url),
                    rec.website_url
                        ? pecHunter.hunt(companyId, input, rec.website_url)
                        : Promise.resolve(null),
                ]);

                if (dmResult.status === 'fulfilled' && dmResult.value) {
                    const dm = dmResult.value;
                    rec.decision_maker_name = dm.name || '';
                    rec.decision_maker_title = dm.title || '';
                    rec.decision_maker_linkedin = dm.linkedin_url || '';
                    wave3FoundDM++;
                    console.log(`   🎯 [${i + 1}/${wave3Targets.length}] ${rec.company_name} → ${dm.name} (${dm.title})`);
                } else {
                    console.log(`   ⚪ [${i + 1}/${wave3Targets.length}] ${rec.company_name} → DM non trovato`);
                }

                if (emailResult.status === 'fulfilled' && emailResult.value) {
                    const contacts = emailResult.value as any;
                    rec.email = contacts?.emails?.[0] || contacts?.email || '';
                    rec.pec = contacts?.pec || '';
                    if (rec.email || rec.pec) {
                        wave3FoundEmail++;
                        console.log(`   📧 [${i + 1}/${wave3Targets.length}] ${rec.company_name} → ${rec.email || rec.pec}`);
                    }
                }
            })
        )
    );

    const wave3Duration = ((Date.now() - wave3Start) / 1000).toFixed(1);

    // ═══════════════════════════════════════════════════════════════
    //  FINAL SUMMARY
    // ═══════════════════════════════════════════════════════════════
    saveCsv(records, outputPath);

    const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
    const avgPerCompany = (parseFloat(totalDuration) / records.length).toFixed(1);

    console.log('\n══════════════════════════════════════════════════');
    console.log('🏆 RISULTATI FINALI — WAVE BENCHMARK OMEGA V8');
    console.log('══════════════════════════════════════════════════');
    console.log(`📊 Target analizzati:    ${records.length}`);
    console.log(`🌊 Wave 1 — Siti:        ${wave1Found}/${records.length} (${wave1Rate}%) in ${wave1Duration}s`);
    console.log(`💰 Wave 2 — Fatturati:   ${wave2Found}/${foundRecords.length}`);
    console.log(`🎯 Wave 3 — DM trovati:  ${wave3FoundDM}/${wave3Targets.length}`);
    console.log(`📧 Wave 3 — Email/PEC:   ${wave3FoundEmail}/${wave3Targets.length}`);
    console.log(`⏱️  Tempo totale:         ${totalDuration}s`);
    console.log(`⚡ Media per azienda:    ${avgPerCompany}s`);
    console.log(`\n📁 Output CSV: ${outputPath}`);
    console.log('══════════════════════════════════════════════════\n');

    // Print top results
    const found = records.filter(r => r.status === 'found' || r.status === 'enriched');
    console.log('📜 TOP RISULTATI:');
    found.slice(0, 20).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.company_name} → ${r.website_url} ${r.email ? `| ✉️  ${r.email}` : ''} ${r.decision_maker_name ? `| 👤 ${r.decision_maker_name}` : ''}`);
    });

    const failed = records.filter(r => r.status === 'failed');
    if (failed.length > 0) {
        console.log(`\n❌ FALLITI (${failed.length}):`);
        failed.forEach((r, i) => console.log(`   ${i + 1}. ${r.company_name} → ${r.error || 'UNKNOWN'}`));
    }

    await runtime.cleanup();
    process.exit(0);
}

if (require.main === module) {
    runWaveBenchmark().catch(err => {
        console.error('Fatal Wave Benchmark Error:', err);
        process.exit(1);
    });
}
