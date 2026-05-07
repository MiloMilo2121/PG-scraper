import type { Lead } from './lead';
import type { NormalizedLead } from './discovery';
import type { StageOutcome } from './output';

/**
 * Run-scoped context passed to every stage in the enrichment pipeline.
 * Contains shared infrastructure and per-lead accumulators.
 */
export interface RunContext {
  runId: string;
  startedAt: number;
  costCeilingEur: number;
  abort: AbortSignal;
  /**
   * Phase G — paid providers gate. Default false. Set true via the
   * `--enable-paid` CLI flag / `PAID_PROVIDERS_ENABLED=true` env. When
   * false, no provider with `costPerCallEur > 0` is ever called,
   * regardless of tier or budget.
   */
  paidEnabled?: boolean;
  /**
   * Phase G — run-level cost ceiling (EUR). Aggregate cap across the
   * whole run; once reached, paid providers stop. `undefined` means
   * no run-level cap.
   */
  runCostCeilingEur?: number;
}

export interface PerLeadContext {
  runId: string;
  leadId: string;
  startedAt: number;
  costEur: number;
  providersUsed: Set<string>;
  layersAttempted: string[];
  abort: AbortSignal;
  /**
   * Per-lead cost ceiling in EUR. Threaded from `RunContext.costCeilingEur`
   * for fast access inside stages. When `costEur >= costCeilingEur`,
   * stages must downgrade to free-tier providers (`maxTier: 0`) for the
   * remainder of this lead's processing.
   */
  costCeilingEur: number;
  /** Set to true the first time the budget is exhausted for this lead. */
  budgetExhausted?: boolean;
  /**
   * Phase G — when true, stages may run paid-tier providers within
   * the per-lead budget. Default false. Threaded from `RunContext`
   * which gets it from the CLI flag / env. The router still enforces
   * per-call cost gates as a defence-in-depth.
   */
  paidEnabled?: boolean;
}

/**
 * The Stage contract. Every step in the enrichment pipeline implements this.
 * Pure: takes context + lead, returns an outcome (and optionally mutates the lead).
 */
export interface Stage {
  readonly name: string;
  run(ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome>;
}

/**
 * The product of running the enrichment pipeline on a single lead.
 */
export interface EnrichmentResult {
  lead: Lead;
  outcome: 'success' | 'partial' | 'not_found' | 'error';
  stage_outcomes: Record<string, StageOutcome>;
  duration_ms: number;
  cost_eur: number;
}
