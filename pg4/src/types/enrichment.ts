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
}

export interface PerLeadContext {
  runId: string;
  leadId: string;
  startedAt: number;
  costEur: number;
  providersUsed: Set<string>;
  layersAttempted: string[];
  abort: AbortSignal;
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
