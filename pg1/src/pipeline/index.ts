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
import { once } from 'events';
import crypto from 'crypto';
import { OutputResult, Candidate, Evidence, NormalizedEntity, ScoreBreakdown, DecisionStatus } from '../types';

import { SearchFactory } from '../modules/miner/provider';

/**
 * Backpressure-safe CSV writer.
 * Serializes writes and respects stream drain to prevent OOM.
 */
class AsyncCsvWriter {
    private queue: any[] = [];
    private writing = false;

    constructor(private stream: NodeJS.WritableStream) {}

    async write(row: any): Promise<void> {
        this.queue.push(row);
        if (!this.writing) await this.drainLoop();
    }

    private async drainLoop(): Promise<void> {
        this.writing = true;
        while (this.queue.length) {
            const row = this.queue.shift()!;
            const ok = this.stream.write(row);
            if (!ok) await once(this.stream, 'drain');
        }
        this.writing = false;
    }

    async end(): Promise<void> {
        await this.drainLoop();
        return new Promise((resolve) => this.stream.end(resolve));
    }
}

export class Pipeline {

    static async run(inputPath: string, outputPath: string) {
        const config = getConfig();
        const miner = new CandidateMiner(SearchFactory.create());

        // PR 4: Single run_id for the entire run (not per-row)
        const runId = `run-${crypto.randomUUID()}`;
        const runStart = new Date().toISOString();
        logger.log('info', `Pipeline run started: ${runId}`);

        const writeStream = fs.createWriteStream(outputPath);
        const csvStream = fastcsv.format({ headers: true });
        csvStream.pipe(writeStream);

        // PR 3: Backpressure-safe writer
        const writer = new AsyncCsvWriter(csvStream);

        const iterator = ingestCSV(inputPath);

        // Collect all rows first (for 200 items it's fine)
        const rows: { row: any, line_number: number }[] = [];
        for await (const item of iterator) {
            rows.push(item);
        }

        const { default: pMap } = await import('p-map');

        await pMap(rows, async ({ row, line_number }) => {
            const start = Date.now();
            let output: Partial<OutputResult> = {};
            let reasonCode = '';

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
                    } catch (e: any) {
                        // PR 1: Log instead of silent drop
                        logger.log('warn', `Row ${line_number}: Invalid seed URL "${url}": ${e.message}`);
                    }
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
                    } catch (e: any) {
                        // PR 1: Log instead of silent drop
                        logger.log('warn', `Row ${line_number}: Invalid input website "${row.initial_website}": ${e.message}`);
                    }
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
                    const targetUrl = validity.final_url || cand.source_url;
                    let fetched;
                    try {
                        fetched = await fetcher.fetch(targetUrl);
                    } catch (e: any) {
                        // PR 1: Log fetch failure instead of silent continue
                        logger.log('warn', `Row ${line_number}: Fetch failed for ${targetUrl}: ${e.message}`);
                        continue;
                    }

                    if (fetched.status >= 400) continue;

                    // 7. Extract
                    const content = ContentExtractor.extract(fetched.data, fetched.finalUrl);

                    // 8. Classify
                    const classification = SiteClassifier.classify(cand.root_domain, content);

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
                reasonCode = output.status === DecisionStatus.OK ? 'OK_CONFIRMED' : 'NOT_FOUND_NO_CANDIDATES';

            } catch (e: any) {
                logger.log('error', `Row ${line_number} failed: ${e.message}`);
                const isTimeout = e.message?.includes('timeout') || e.message?.includes('ETIMEDOUT');
                const isBlocked = e.message?.includes('403') || e.message?.includes('blocked');
                output = {
                    status: isTimeout ? DecisionStatus.ERROR_TIMEOUT
                         : isBlocked ? DecisionStatus.ERROR_BLOCKED
                         : DecisionStatus.ERROR,
                    error_message: e.message
                };
                reasonCode = isTimeout ? 'ERROR_TIMEOUT' : isBlocked ? 'ERROR_BLOCKED' : 'ERROR_INTERNAL';
            }

            // PR 1: Every record ALWAYS produces an output row (never dropped)
            const result: OutputResult = {
                ...row,
                ...output,
                reason_code: reasonCode || output.status || 'UNKNOWN',
            } as any;

            // PR 4: Consistent run_id for the entire run
            result.run_id = runId;
            result.timestamp_utc = new Date().toISOString();

            // PR 3: Backpressure-safe write
            await writer.write(result);

            const duration = Date.now() - start;
            metrics.record(result, duration);

            logger.log('info', `Processed ${row.company_name} -> ${result.status} [${reasonCode}] (${duration}ms)`);
        }, { concurrency: config.system.concurrency });

        await writer.end();
        logger.log('info', `Pipeline run completed: ${runId} (started: ${runStart})`);
        console.log('Pipeline finished.');
        console.log(metrics.getSummary());

        // Clean up browser cluster to allow process exit
        await ClusterManager.close();
    }
}
