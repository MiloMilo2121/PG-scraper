import * as fs from 'fs';
import {
  CostLedger,
  LedgerEntry,
} from '../shared-runtime/budget/CostLedger';
import { RunPaths } from './agent_artifacts';
import {
  AgentCostSummary,
  AgentRunBudget,
  AgentScraperRequest,
  AgentStats,
} from './agent_contracts';

const WARNING_RATIO = 0.8;
const AGENT_GOVERNANCE_MODULE = 'agent_governance';

interface CostSummaryInput {
  budget?: AgentRunBudget;
  stats: AgentStats;
  durationMs: number;
  totalCostEur: number;
  externalCalls: number;
}

interface LedgerRollupInput {
  runId: string;
  ledgerPaths: string[];
  budget?: AgentRunBudget;
  stats: AgentStats;
  durationMs: number;
}

interface FinalizeCostInput {
  stats: AgentStats;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function hasBudget(budget?: AgentRunBudget): boolean {
  return !!budget && Object.values(budget).some((value) => value !== undefined);
}

function countCompanies(stats: AgentStats): number {
  return Math.max(stats.loaded, stats.discovered, stats.enriched, 0);
}

function overLimit(value: number, limit: number | undefined): boolean {
  return limit !== undefined && value > limit;
}

function nearLimit(value: number, limit: number | undefined): boolean {
  return limit !== undefined && limit > 0 && value >= limit * WARNING_RATIO && value <= limit;
}

function sumCost(entries: LedgerEntry[]): number {
  return entries.reduce((total, entry) => total + entry.cost_eur, 0);
}

function countExternalCalls(entries: LedgerEntry[]): number {
  return entries.filter((entry) => entry.module !== AGENT_GOVERNANCE_MODULE).length;
}

function readLedgerEntries(filePath: string): LedgerEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const entries: LedgerEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LedgerEntry);
    } catch {
      // Ignore partially written JSONL lines; ledgers are append-only.
    }
  }
  return entries;
}

export function emptyCostSummary(budget?: AgentRunBudget): AgentCostSummary {
  return {
    totalCostEur: 0,
    costPerCompanyEur: 0,
    externalCalls: 0,
    budgetStatus: hasBudget(budget) ? 'within_budget' : 'not_configured',
    warnings: [],
  };
}

export function evaluateCostSummary(input: CostSummaryInput): AgentCostSummary {
  const totalCostEur = roundCost(input.totalCostEur);
  const totalCompanies = countCompanies(input.stats);
  const costPerCompanyEur = roundCost(totalCompanies > 0 ? totalCostEur / totalCompanies : 0);
  const warnings: string[] = [];
  const budget = input.budget;

  if (!hasBudget(budget)) {
    return {
      totalCostEur,
      costPerCompanyEur,
      externalCalls: input.externalCalls,
      budgetStatus: 'not_configured',
      warnings,
    };
  }

  if (overLimit(totalCostEur, budget?.maxCostPerRun)) {
    warnings.push(`maxCostPerRun exceeded: ${totalCostEur} > ${budget!.maxCostPerRun}`);
  } else if (nearLimit(totalCostEur, budget?.maxCostPerRun)) {
    warnings.push(`maxCostPerRun warning: ${totalCostEur} >= 80% of ${budget!.maxCostPerRun}`);
  }

  if (overLimit(costPerCompanyEur, budget?.maxCostPerCompany)) {
    warnings.push(`maxCostPerCompany exceeded: ${costPerCompanyEur} > ${budget!.maxCostPerCompany}`);
  } else if (nearLimit(costPerCompanyEur, budget?.maxCostPerCompany)) {
    warnings.push(`maxCostPerCompany warning: ${costPerCompanyEur} >= 80% of ${budget!.maxCostPerCompany}`);
  }

  if (overLimit(input.externalCalls, budget?.maxExternalCalls)) {
    warnings.push(`maxExternalCalls exceeded: ${input.externalCalls} > ${budget!.maxExternalCalls}`);
  } else if (nearLimit(input.externalCalls, budget?.maxExternalCalls)) {
    warnings.push(`maxExternalCalls warning: ${input.externalCalls} >= 80% of ${budget!.maxExternalCalls}`);
  }

  if (overLimit(input.durationMs, budget?.maxRunDurationMs)) {
    warnings.push(`maxRunDurationMs exceeded: ${input.durationMs} > ${budget!.maxRunDurationMs}`);
  } else if (nearLimit(input.durationMs, budget?.maxRunDurationMs)) {
    warnings.push(`maxRunDurationMs warning: ${input.durationMs} >= 80% of ${budget!.maxRunDurationMs}`);
  }

  const exceeded = warnings.some((warning) => warning.includes('exceeded'));

  return {
    totalCostEur,
    costPerCompanyEur,
    externalCalls: input.externalCalls,
    budgetStatus: exceeded ? 'exceeded' : warnings.length > 0 ? 'warning' : 'within_budget',
    warnings,
  };
}

export function budgetExceededError(summary: AgentCostSummary): Error {
  const err = new Error(summary.warnings.join('; ') || 'Agent budget exceeded');
  err.name = 'BudgetExceededError';
  return err;
}

export function rollupCostSummaryFromLedgers(input: LedgerRollupInput): AgentCostSummary {
  const seen = new Set<string>();
  const entries: LedgerEntry[] = [];

  for (const ledgerPath of input.ledgerPaths) {
    if (seen.has(ledgerPath)) continue;
    seen.add(ledgerPath);

    const allEntries = readLedgerEntries(ledgerPath);
    const isRunLocalLedger = ledgerPath.endsWith('/cost_ledger.jsonl')
      && ledgerPath.includes(`/${input.runId}/`);

    entries.push(
      ...allEntries.filter((entry) => isRunLocalLedger || entry.run_id === input.runId)
    );
  }

  return evaluateCostSummary({
    budget: input.budget,
    stats: input.stats,
    durationMs: input.durationMs,
    totalCostEur: sumCost(entries),
    externalCalls: countExternalCalls(entries),
  });
}

export class AgentCostTracker {
  private readonly ledger: CostLedger;

  constructor(
    paths: RunPaths,
    private readonly request: AgentScraperRequest
  ) {
    this.ledger = new CostLedger({
      filePath: paths.costLedger,
      flushIntervalMs: 60_000,
    });
  }

  async recordStarted(startedAt: string): Promise<void> {
    await this.logGovernanceEntry({
      timestamp: startedAt,
      taskType: 'agent.run.started',
      durationMs: 0,
      success: true,
    });
  }

  async finalize(input: FinalizeCostInput): Promise<AgentCostSummary> {
    await this.logGovernanceEntry({
      timestamp: new Date().toISOString(),
      taskType: 'agent.run.finished',
      durationMs: input.durationMs,
      success: input.success,
      error: input.errorMessage,
    });

    const entries = await this.ledger.getRecentEntries(1000);
    const summary = evaluateCostSummary({
      budget: this.request.budget,
      stats: input.stats,
      durationMs: input.durationMs,
      totalCostEur: sumCost(entries),
      externalCalls: countExternalCalls(entries),
    });

    if (summary.budgetStatus === 'warning' || summary.budgetStatus === 'exceeded') {
      await this.logGovernanceEntry({
        timestamp: new Date().toISOString(),
        taskType: `agent.budget.${summary.budgetStatus}`,
        durationMs: input.durationMs,
        success: summary.budgetStatus !== 'exceeded',
        error: summary.warnings.join('; '),
      });
    }

    this.ledger.cleanup();
    return summary;
  }

  cleanup(): void {
    this.ledger.cleanup();
  }

  private async logGovernanceEntry(input: {
    timestamp: string;
    taskType: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }): Promise<void> {
    await this.ledger.log({
      timestamp: input.timestamp,
      module: AGENT_GOVERNANCE_MODULE,
      provider: 'agent-runtime',
      tier: 0,
      task_type: input.taskType,
      cost_eur: 0,
      cache_hit: false,
      cache_level: 'MISS',
      duration_ms: input.durationMs,
      success: input.success,
      error: input.error,
      company_id: this.request.runId,
      run_id: this.request.runId,
      correlation_id: this.request.context?.traceId,
    });
  }
}
