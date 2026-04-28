import * as fs from 'fs';
import * as path from 'path';
import { AgentRunRegistry, RegistryEntry } from './agent_run_registry';
import { AgentScraperResult } from './agent_contracts';
import { rollupCostSummaryFromLedgers } from './agent_costs';

export interface AgentInspectPayload {
  entry: RegistryEntry;
  report: AgentScraperResult | unknown | null;
}

function resolveRuntimeCostLedgerPath(): string {
  const runtimeDataDir = process.env.RUNTIME_DATA_DIR || './data';
  return path.resolve(
    process.env.COST_LEDGER_PATH || path.join(runtimeDataDir, 'cost_ledger.jsonl')
  );
}

function readReport(reportPath?: string): unknown | null {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

function isReportLike(report: unknown): report is AgentScraperResult {
  return !!report
    && typeof report === 'object'
    && typeof (report as AgentScraperResult).runId === 'string'
    && !!(report as AgentScraperResult).stats
    && !!(report as AgentScraperResult).artifacts;
}

function refreshReportCostSummary(report: AgentScraperResult): AgentScraperResult {
  const ledgerPaths = [
    report.artifacts.costLedger,
    resolveRuntimeCostLedgerPath(),
  ].filter((value): value is string => !!value);

  return {
    ...report,
    costSummary: rollupCostSummaryFromLedgers({
      runId: report.runId,
      ledgerPaths,
      budget: report.input.budget,
      stats: report.stats,
      durationMs: report.durationMs ?? 0,
    }),
  };
}

export function inspectAgentRun(
  runId: string,
  opts: { rootDir?: string } = {}
): AgentInspectPayload | { runId: string; found: false } {
  const registry = new AgentRunRegistry({ rootDir: opts.rootDir });
  const entry = registry.get(runId);
  if (!entry) {
    return { runId, found: false };
  }

  const rawReport = readReport(entry.result?.artifacts?.reportJson);
  const report = isReportLike(rawReport) ? refreshReportCostSummary(rawReport) : rawReport;
  const refreshedEntry: RegistryEntry = isReportLike(report)
    ? {
        ...entry,
        result: entry.result
          ? {
              ...entry.result,
              costSummary: report.costSummary,
            }
          : entry.result,
      }
    : entry;

  return { entry: refreshedEntry, report };
}
