import { ZodError } from 'zod';
import {
  AgentRunError,
  AgentRunStatus,
  AgentScraperRequest,
  AgentScraperRequestSchema,
  AgentScraperResult,
  emptyStats,
} from './agent_contracts';
import {
  RunPaths,
  ensureRunDir,
  writeReportJson,
} from './agent_artifacts';
import { AgentRunRegistry } from './agent_run_registry';
import { runCampaign, CampaignRunner } from './backends/campaign_backend';
import { runEnrichment, EnrichmentRunner } from './backends/enrichment_backend';
import { runFull } from './backends/full_backend';

export interface RunScraperDeps {
  registry?: AgentRunRegistry;
  rootDir?: string;
  campaignRunner?: CampaignRunner;
  enrichmentRunner?: EnrichmentRunner;
}

function toAgentRunError(err: unknown): AgentRunError {
  if (err instanceof ZodError) {
    return {
      name: 'ZodError',
      message: err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
      stack: err.stack,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'UnknownError', message: String(err) };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runScraper(
  raw: unknown,
  deps: RunScraperDeps = {}
): Promise<AgentScraperResult> {
  const startedAt = nowIso();
  const startedAtMs = Date.now();
  const registry = deps.registry ?? new AgentRunRegistry({ rootDir: deps.rootDir });

  let request: AgentScraperRequest;
  try {
    request = AgentScraperRequestSchema.parse(raw);
  } catch (err) {
    const safeRunId =
      raw && typeof raw === 'object' && 'runId' in raw
        ? String((raw as { runId?: unknown }).runId ?? 'invalid')
        : 'invalid';
    const fallback: AgentScraperResult = {
      runId: safeRunId,
      status: 'failed',
      input: {
        runId: safeRunId,
        mode: 'campaign',
      } as AgentScraperRequest,
      stats: emptyStats(),
      artifacts: {},
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAtMs,
      error: toAgentRunError(err),
    };
    return fallback;
  }

  let paths: RunPaths;
  try {
    paths = ensureRunDir(request.runId, { rootDir: deps.rootDir });
  } catch (err) {
    return {
      runId: request.runId,
      status: 'failed',
      input: request,
      stats: emptyStats(),
      artifacts: {},
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAtMs,
      error: toAgentRunError(err),
    };
  }

  registry.register(request, startedAt);

  let status: AgentRunStatus = 'running';
  let stats = emptyStats();
  const artifacts: AgentScraperResult['artifacts'] = {
    reportJson: paths.reportJson,
    logFile: paths.logFile,
  };
  let error: AgentRunError | undefined;

  try {
    if (request.mode === 'campaign') {
      const out = await runCampaign(request, paths, deps.campaignRunner);
      stats = out.stats;
      if (out.csvPath) artifacts.outputCsv = out.csvPath;
      status = 'completed';
    } else if (request.mode === 'enrichment') {
      const out = await runEnrichment(request, paths, deps.enrichmentRunner);
      stats = out.stats;
      artifacts.inputCsv = out.inputCsv;
      status = 'queued';
    } else {
      const out = await runFull(request, paths, {
        campaignRunner: deps.campaignRunner,
        enrichmentRunner: deps.enrichmentRunner,
      });
      stats = out.stats;
      if (out.outputCsv) artifacts.outputCsv = out.outputCsv;
      if (out.inputCsv) artifacts.inputCsv = out.inputCsv;
      status = out.enrichment ? 'queued' : 'completed';
    }
  } catch (err) {
    status = 'failed';
    error = toAgentRunError(err);
  }

  const finishedAt = nowIso();
  const result: AgentScraperResult = {
    runId: request.runId,
    status,
    input: request,
    stats,
    artifacts,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedAtMs,
    error,
  };

  try {
    writeReportJson(paths, result);
  } catch {
    // Reporting must never crash the run; the registry below is the source of truth.
  }

  registry.update(request.runId, {
    status,
    finishedAt,
    result,
  });

  return result;
}
