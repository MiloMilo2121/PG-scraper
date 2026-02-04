import { ingestCSV } from '../modules/ingestor';
import { ClusterManager } from '../modules/browser';
import { Normalizer } from '../modules/normalizer';
import { SeedProcessor } from '../modules/seed-processor';
import { CandidateMiner } from '../modules/miner';
import { DummyProvider, GoogleCustomSearchProvider } from '../modules/miner/provider';
import { CandidateDeduper } from '../modules/deduper';
import { ValidityChecker } from '../modules/validity';
import { fetcher } from '../modules/fetcher';
import { ContentExtractor } from '../modules/extractor';
import { SignalExtractor } from '../modules/signal';
import { SiteClassifier } from '../modules/classifier';
import { phoneTracker } from '../modules/phone-freq';
import { Scorer } from '../modules/scorer';
import { Decider } from '../modules/decider';
import { logger, metrics } from '../modules/observability';
import { getConfig } from '../config';
import * as fastcsv from 'fast-csv';
import fs from 'fs';
import { OutputResult, Candidate, Evidence, NormalizedEntity, ScoreBreakdown, DecisionStatus } from '../types';

import { SearchFactory } from '../modules/miner/provider';

export class Pipeline {

    static async run(inputPath: string, outputPath: string) {
        const config = getConfig();
        const miner = new CandidateMiner(SearchFactory.create());

        const writeStream = fs.createWriteStream(outputPath);
        const csvStream = fastcsv.format({ headers: true });
        csvStream.pipe(writeStream);

        const iterator = ingestCSV(inputPath);

        // Batch processing could go here, but for simplicity we do sequential or semi-parallel
        // Let's do simple sequential or p-map limit. 
        // Since ingestCSV is a generator, we iterate.

        // Collect all rows first (for 200 items it's fine)
        const rows: { row: any, line_number: number }[] = [];
        for await (const item of iterator) {
            rows.push(item);
        }

        const { default: pMap } = await import('p-map'); // Dynamic import if ESM, or require if CommonJS. 
        // p-map might be ESM only in recent versions. 
        // Our project seems CJS (ts-node default) or ESM? 
        // Let's assume standard import if typescript handles it, or use require.
        // Actually best to try standard import at top of file, but previous attempts failed with require vs import?
        // Let's use standard import at top.

        await pMap(rows, async ({ row, line_number }) => {
            const start = Date.now();
            let output: Partial<OutputResult> = {};

            try {
                // 1. Normalize
                const entity = Normalizer.normalize(row);
                // phoneTracker is global singleton, might have race conditions if not thread safe? 
                // It just adds to a Map. Map is generally safe-ish in JS event loop (single threaded).
                phoneTracker.track(entity.phones);
                const freq = phoneTracker.getFrequency(entity.phones);

                // 2. Seed
                const seedRes = await SeedProcessor.process(row.source_url || '', row);

                // 3. Mine
                let candidates = await miner.mine(entity);

                // Add Seed candidates (from source_url scraping)
                seedRes.external_urls.forEach(url => {
                    try {
                        candidates.push({
                            root_domain: new URL(url).hostname.replace(/^www\./, ''),
                            source_url: url,
                            rank: 1, // High priority but scraped
                            provider: 'seed_scraping',
                            snippet: 'From source URL',
                            title: 'Seed Link'
                        });
                    } catch (e) { }
                });

                // Add Input Website (from CSV)
                if (row.initial_website) {
                    try {
                        candidates.push({
                            root_domain: new URL(row.initial_website).hostname.replace(/^www\./, ''),
                            source_url: row.initial_website,
                            rank: 0, // Highest Priority
                            provider: 'input_csv',
                            snippet: 'Direct from Input',
                            title: 'Input Website'
                        });
                    } catch (e) { }
                }

                // 4. Dedupe
                candidates = CandidateDeduper.dedupe(candidates);

                // Eval Candidates
                const evaluatedCandidates: { candidate: Candidate, score: ScoreBreakdown, evidence: Evidence }[] = [];

                for (const cand of candidates) {
                    // 5. Validity
                    const validity = await ValidityChecker.check(cand.root_domain);
                    if (!validity.dns_ok) continue; // Hard reject

                    // 6. Fetch Content
                    // Use final URL from validity check if available
                    const targetUrl = validity.final_url || cand.source_url;
                    let fetched;
                    try {
                        fetched = await fetcher.fetch(targetUrl); // We might want to fetch planned URLs (contact, etc) too.
                        // Impl note: For MVP we fetch just the main page found.
                    } catch (e) {
                        continue;
                    }

                    if (fetched.status >= 400) continue;

                    // 7. Extract
                    const content = ContentExtractor.extract(fetched.data, fetched.finalUrl);

                    // 8. Classify
                    const classification = SiteClassifier.classify(cand.root_domain, content);

                    // Update validity info with classification result
                    // (Need to map Classification result to Evidence structure)

                    // 9. Signal
                    const evidence = SignalExtractor.extract(content, entity, {
                        dns_ok: validity.dns_ok,
                        http_ok: validity.http_ok,
                        is_https: targetUrl.startsWith('https') || fetched.finalUrl.startsWith('https'),
                        site_type: classification.type
                    });

                    // 10. Score
                    const score = Scorer.score(evidence, entity, freq);

                    evaluatedCandidates.push({ candidate: cand, score, evidence });
                }

                // 11. Decide (async for OpenAI fallback)
                output = await Decider.decide(evaluatedCandidates, entity, freq);

            } catch (e: any) {
                logger.log('error', `Row ${line_number} failed`, e);
                output = {
                    status: DecisionStatus.ERROR,
                    error_message: e.message
                };
            }

            // Finalize output row
            const result: OutputResult = {
                ...row,
                ...output
            } as any;

            // Add metadata
            result.run_id = 'run-' + Date.now();
            result.timestamp_utc = new Date().toISOString();

            // Writing to CSV stream is concurrent? 
            // fast-csv stream.write is sync? 
            // It should be fine to call write from async (order in file will be random though).
            csvStream.write(result);

            const duration = Date.now() - start;
            metrics.record(result, duration);

            logger.log('info', `Processed ${row.company_name} -> ${result.status} (${duration}ms)`);
        }, { concurrency: config.system.concurrency }); // Use config value

        csvStream.end();
        console.log('Pipeline finished.');
        console.log(metrics.getSummary());

        // Clean up browser cluster to allow process exit
        await ClusterManager.close();
    }
}
