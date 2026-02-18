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

        const reasonCodeFromStatus = (status: DecisionStatus, decisionReason = ''): string => {
            const reason = decisionReason.toLowerCase();
            if (status === DecisionStatus.OK || status === DecisionStatus.OK_LIKELY) {
                return 'OK_LIKELY_NAME_CITY_MATCH';
            }
            if (status === DecisionStatus.NO_DOMAIN_FOUND) {
                if (reason.includes('no candidates')) return 'NOT_FOUND_NO_CANDIDATES';
                return 'REJECTED_NO_MATCHING_SIGNALS';
            }
            if (status === DecisionStatus.REJECTED_DIRECTORY) return 'REJECTED_DIRECTORY_OR_SOCIAL';
            if (status === DecisionStatus.ERROR_TIMEOUT) return 'ERROR_TIMEOUT_FETCH';
            if (status === DecisionStatus.ERROR_BLOCKED) return 'ERROR_BLOCKED_403';
            if (status === DecisionStatus.ERROR_DNS) return 'REJECTED_NO_MATCHING_SIGNALS';
            if (status === DecisionStatus.ERROR_FETCH) return 'ERROR_TIMEOUT_FETCH';
            return 'ERROR_INTERNAL';
        };

        const reasonCodeFromError = (error: any): string => {
            const message = `${error?.message || ''}`.toLowerCase();
            if (message.includes('timeout')) return 'ERROR_TIMEOUT_FETCH';
            if (message.includes('403') || message.includes('blocked') || message.includes('captcha')) return 'ERROR_BLOCKED_403';
            if (message.includes('dns') || message.includes('enotfound')) return 'REJECTED_NO_MATCHING_SIGNALS';
            if (message.includes('429') || message.includes('rate')) return 'ERROR_PROVIDER_RATE_LIMIT';
            return 'ERROR_INTERNAL';
        };

        const enqueueCsvWrite = (row: OutputResult): Promise<void> => {
            writeChain = writeChain.then(async () => {
                const canContinue = csvStream.write(row);
                if (!canContinue) {
                    await once(csvStream, 'drain');
                }
            });
            return writeChain;
        };

        const processRow = async ({ row, line_number, ingest_error }: { row: any, line_number: number, ingest_error?: string }): Promise<void> => {
            const start = Date.now();
            let output: Partial<OutputResult> = {};

            try {
                if (ingest_error) {
                    output = {
                        status: DecisionStatus.ERROR,
                        reason_code: 'ERROR_INVALID_INPUT_ROW',
                        decision_reason: 'Invalid input row schema',
                        error_message: ingest_error
                    };
                } else {
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
                    } catch (e) {
                        logger.log('warn', 'Invalid seed candidate URL skipped', { line_number, url, error: e });
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
                    } catch (e) {
                        logger.log('warn', 'Invalid input website URL skipped', { line_number, url: row.initial_website, error: e });
                    }
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
                }

            } catch (e: any) {
                logger.log('error', `Row ${line_number} failed`, e);
                output = {
                    status: DecisionStatus.ERROR,
                    reason_code: reasonCodeFromError(e),
                    error_message: e.message
                };
            }

            const result: OutputResult = {
                ...row,
                ...output
            } as any;

            result.status = (result.status || DecisionStatus.ERROR) as DecisionStatus;
            result.reason_code = result.reason_code || reasonCodeFromStatus(result.status, result.decision_reason || '');
            result.domain_official = result.domain_official ?? null;
            result.site_url_official = result.site_url_official ?? null;
            result.score = Number.isFinite(result.score as any) ? Number(result.score) : 0;
            result.confidence = Number.isFinite(result.confidence as any) ? Number(result.confidence) : 0;
            result.decision_reason = result.decision_reason || (result.status === DecisionStatus.ERROR ? 'Unhandled record error' : 'No decisive signal');
            result.evidence_json = result.evidence_json || '{}';
            result.candidates_json = result.candidates_json || '[]';

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
                    .catch(async (e: any) => {
                        logger.log('error', `Unhandled processing error for row ${item.line_number}`, e);
                        const fallback: OutputResult = {
                            ...item.row,
                            domain_official: null,
                            site_url_official: null,
                            status: DecisionStatus.ERROR,
                            reason_code: reasonCodeFromError(e),
                            score: 0,
                            confidence: 0,
                            decision_reason: 'Unhandled row processing error',
                            evidence_json: '{}',
                            candidates_json: '[]',
                            run_id: runId,
                            timestamp_utc: new Date().toISOString(),
                            error_message: e?.message || 'Unknown error',
                        } as OutputResult;
                        await enqueueCsvWrite(fallback);
                        metrics.record(fallback, 0);
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
