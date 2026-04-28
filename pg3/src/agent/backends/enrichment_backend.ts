import * as fs from 'fs';
import { AgentScraperRequest, AgentStats } from '../agent_contracts';
import { RunPaths, copyInputCsv } from '../agent_artifacts';

export interface SchedulerSummary {
  loaded: number;
  enqueued: number;
  skipped: number;
  durationMs: number;
}

export interface EnrichmentBackendOutput {
  inputCsv: string;
  stats: AgentStats;
  summary: SchedulerSummary;
}

export type EnrichmentRunner = (csvPath: string) => Promise<SchedulerSummary>;

export async function runEnrichment(
  req: AgentScraperRequest,
  paths: RunPaths,
  runner?: EnrichmentRunner,
  sourceCsvOverride?: string
): Promise<EnrichmentBackendOutput> {
  const sourceCsv = sourceCsvOverride ?? req.sourceCsv;
  if (!sourceCsv) {
    throw new Error("Enrichment mode requires 'sourceCsv'");
  }
  if (!fs.existsSync(sourceCsv)) {
    throw new Error(`sourceCsv not found: ${sourceCsv}`);
  }

  const inputCsv = copyInputCsv(sourceCsv, paths);
  const effectiveRunner = runner ?? (await import('../../enricher/scheduler')).runScheduler;
  const summary = await effectiveRunner(inputCsv);

  const stats: AgentStats = {
    loaded: summary.loaded,
    discovered: 0,
    enriched: summary.enqueued,
    failed: summary.skipped,
  };

  return { inputCsv, stats, summary };
}
