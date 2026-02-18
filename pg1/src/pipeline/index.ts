import { ingestCSV } from '../modules/ingestor';
import { ClusterManager } from '../modules/browser';
import { Normalizer } from '../modules/normalizer';
import { SeedProcessor } from '../modules/seed-processor';
import { CandidateMiner } from '../modules/miner';
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
import { once } from 'events';
import { OutputResult, Candidate, Evidence, ScoreBreakdown, DecisionStatus } from '../types';

import { SearchFactory } from '../modules/miner/provider';

export class Pipeline {

    static async run(inputPath: string, outputPath: string) {
        const config = getConfig();
        const miner = new CandidateMiner(SearchFactory.create());
        const runId = 'run-' + Date.now();
        const maxConcurrency = Math.max(1, Number(config.system.concurrency) || 1);

        const writeStream = fs.createWriteStream(outputPath);
        const csvStream = fastcsv.format({ headers: true });
        csvStream.pipe(writeStream);

        const iterator = ingestCSV(inputPath);
        const activeTasks = new Set<Promise<void>>();
        let writeChain = Promise.resolve();

        const enqueueCsvWrite = (row: OutputResult): Promise<void> => {
            writeChain = writeChain.then(async () => {
                const canContinue = csvStream.write(row);
                if (!canContinue) {
                    await once(csvStream, 'drain');
                }
            });
            return writeChain;
        };

        const processRow = async ({ row, line_number }: { row: any, line_number: number }): Promise<void> => {
            const start = Date.now();
            let output: Partial<OutputResult> = {};

            try {
                // 1. Normalize
                const entity = Normalizer.normalize(row);
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
                            rank: 1,
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
                            rank: 0,
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
                    const validity = await ValidityChecker.check(cand.root_domain);
                    if (!validity.dns_ok) continue;

                    const targetUrl = validity.final_url || cand.source_url;
                    let fetched;
                    try {
                        fetched = await fetcher.fetch(targetUrl);
                    } catch (e) {
                        continue;
                    }

                    if (fetched.status >= 400) continue;

                    const content = ContentExtractor.extract(fetched.data, fetched.finalUrl);
                    const classification = SiteClassifier.classify(cand.root_domain, content);
                    const evidence = SignalExtractor.extract(content, entity, {
                        dns_ok: validity.dns_ok,
                        http_ok: validity.http_ok,
                        is_https: targetUrl.startsWith('https') || fetched.finalUrl.startsWith('https'),
                        site_type: classification.type
                    });
                    const score = Scorer.score(evidence, entity, freq);

                    evaluatedCandidates.push({ candidate: cand, score, evidence });
                }

                output = await Decider.decide(evaluatedCandidates, entity, freq);

            } catch (e: any) {
                logger.log('error', `Row ${line_number} failed`, e);
                output = {
                    status: DecisionStatus.ERROR,
                    error_message: e.message
                };
            }

            const result: OutputResult = {
                ...row,
                ...output
            } as any;

            // Run metadata is stable per run; timestamp remains per-record.
            result.run_id = runId;
            result.timestamp_utc = new Date().toISOString();

            await enqueueCsvWrite(result);

            const duration = Date.now() - start;
            metrics.record(result, duration);
            logger.log('info', `Processed ${row.company_name} -> ${result.status} (${duration}ms)`);
        };

        try {
            for await (const item of iterator) {
                let task: Promise<void>;
                task = processRow(item)
                    .catch((e: any) => {
                        logger.log('error', `Unhandled processing error for row ${item.line_number}`, e);
                    })
                    .finally(() => {
                        activeTasks.delete(task);
                    });
                activeTasks.add(task);

                if (activeTasks.size >= maxConcurrency) {
                    await Promise.race(activeTasks);
                }
            }

            await Promise.all(activeTasks);
            await writeChain;
            csvStream.end();
            await once(writeStream, 'finish');

            console.log('Pipeline finished.');
            console.log(metrics.getSummary());
        } finally {
            // Clean up browser cluster to allow process exit
            await ClusterManager.close();
        }
    }
}
