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
  appendRunLog,
  ensureRunDir,
  writeReportJson,
} from './agent_artifacts';
import { AgentRunRegistry } from './agent_run_registry';
import type { CampaignRunner } from './backends/campaign_backend';
import type { EnrichmentRunner } from './backends/enrichment_backend';

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
    const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const safeRunId = rawObj.runId !== undefined ? String(rawObj.runId) : 'invalid';
    const rawMode = rawObj.mode;
    const fallbackMode: AgentScraperRequest['mode'] =
      rawMode === 'campaign' || rawMode === 'enrichment' || rawMode === 'full'
        ? rawMode
        : 'campaign';
    const fallback: AgentScraperResult = {
      runId: safeRunId,
      status: 'failed',
      input: {
        ...rawObj,
        runId: safeRunId,
        mode: fallbackMode,
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
  appendRunLog(paths, 'agent.run.started', { runId: request.runId, mode: request.mode });

  let status: AgentRunStatus = 'running';
  let stats = emptyStats();
  const artifacts: AgentScraperResult['artifacts'] = {
    reportJson: paths.reportJson,
    logFile: paths.logFile,
  };
  let error: AgentRunError | undefined;

  try {
    if (request.mode === 'campaign') {
      const { runCampaign } = await import('./backends/campaign_backend');
      const out = await runCampaign(request, paths, deps.campaignRunner);
      stats = out.stats;
      if (out.csvPath) artifacts.outputCsv = out.csvPath;
      status = 'completed';
    } else if (request.mode === 'enrichment') {
      const { runEnrichment } = await import('./backends/enrichment_backend');
      const out = await runEnrichment(request, paths, deps.enrichmentRunner);
      stats = out.stats;
      artifacts.inputCsv = out.inputCsv;
      status = 'queued';
    } else {
      const { runFull } = await import('./backends/full_backend');
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
    appendRunLog(paths, 'agent.run.failed', error);
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
    appendRunLog(paths, 'agent.run.finished', {
      status,
      stats,
      artifacts,
      durationMs: result.durationMs,
    });
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
