import type { Lead } from '../types/lead';
import type { EnrichmentResult, PerLeadContext, Stage } from '../types/enrichment';
import type { StageOutcome, ReasonCode } from '../types/output';
import { LeadStatus, ReasonCode as RC } from '../types/output';
import { normalizeLead } from '../discovery/input_normalizer';
import type { ProviderRouter } from '../providers/provider_router';
import type { Run } from '../runtime/run_context';
import { logger } from '../runtime/logger';
import { classifyError } from '../runtime/errors';
import { InputWebsiteStage } from './stages/input_website_stage';
import { PgDetailStage } from './stages/pg_detail_stage';
import { HyperGuesserStage } from './stages/hyper_guesser_stage';
import { SerpStage } from './stages/serp_stage';
import { RdapBoostStage } from './stages/rdap_stage';
import { FinancialStage } from './stages/financial_stage';
import { PgDetailHarvester } from '../discovery/sources/pagine_gialle_detail_harvester';

/**
 * Enrichment pipeline.
 *
 * Owns:
 *   - input ingest gating (`ingestError`, `INPUT_QUALITY_TOO_LOW`)
 *   - stage ordering (Phase 4.4: kept identical to Phase 4.2)
 *   - per-stage cost sync from the canonical `CostLedger.costForLead()`
 *   - reason-code policy: keep the FIRST informative reason; only fall
 *     back to `DISCOVERY_EXHAUSTED` when nothing more specific surfaced
 *   - finalize: project the lead into the output shape with cost / duration
 *
 * Stage IMPLEMENTATIONS live in `stages/*.ts`. Adding a new stage means
 * a new file under `stages/` and one extra entry in the `stages` array
 * below — nothing else has to change here.
 */

export interface PipelineInput {
  run: Run;
  perLead: PerLeadContext;
  router: ProviderRouter;
  lead: Lead;
  ingestError?: string;
  /**
   * Optional DNS resolver injected from outside (tests). Defaults to system DNS.
   * Used by HyperGuesserStage to keep tests offline.
   */
  dnsResolver?: (host: string) => Promise<string[]>;
  /**
   * R1 — optional PG harvester. Tests inject a mock to keep the
   * suite 0-network. Defaults to a fresh `PgDetailHarvester` per
   * pipeline invocation. Production callers (CLI) can pass a
   * SHARED instance to take advantage of the run-scoped cache
   * across leads with the same `pg_url`.
   */
  pgHarvester?: PgDetailHarvester;
  /**
   * R13.1 — financial enrichment stage. Runs AFTER the website discovery
   * ladder, UNCONDITIONALLY (it is orthogonal to website success). Defaults
   * to an enabled, NO-NETWORK instance that only promotes a checksum-valid
   * input P.IVA to `vat_code_final` and records provenance. Tests inject a
   * custom / disabled instance. It emits no `reason_code` and never sets
   * the lead status, so the website-discovery verdict is unaffected.
   */
  financialStage?: FinancialStage;
}

export async function runEnrichmentPipeline(input: PipelineInput): Promise<EnrichmentResult> {
  const start = Date.now();
  const { lead, run, perLead, router, ingestError } = input;

  // ---- Ingest error short-circuit ----
  if (ingestError) {
    return finalize(lead, {
      status: LeadStatus.ERROR,
      reason_code: RC.ERROR_INVALID_INPUT_ROW,
      stage_outcomes: {
        ingest: { stage: 'ingest', status: 'error', duration_ms: 0, reason_code: RC.ERROR_INVALID_INPUT_ROW, detail: ingestError },
      },
      start,
      perLead,
      outcome: 'error',
      run,
    });
  }

  // ---- Normalize ----
  const normalized = normalizeLead(lead);
  perLead.layersAttempted.push('NORMALIZE');

  if (normalized.quality_score < 0.3) {
    return finalize(lead, {
      status: LeadStatus.SKIPPED,
      reason_code: RC.INPUT_QUALITY_TOO_LOW,
      stage_outcomes: {
        normalize: {
          stage: 'normalize',
          status: 'skipped',
          duration_ms: 0,
          reason_code: RC.INPUT_QUALITY_TOO_LOW,
          detail: `quality=${normalized.quality_score}`,
        },
      },
      start,
      perLead,
      outcome: 'not_found',
      run,
    });
  }

  // ---- Multi-stage discovery ladder ----
  // R1 — `PgDetailStage` runs BEFORE HyperGuesser/SERP. When the
  // lead has a `pg_url`, it harvests the PG company-detail page for
  // official_website / P.IVA / phone / email / address and
  // backfills the lead. This both short-circuits the ladder when
  // PG already advertises the site AND enriches the input for the
  // downstream stages.
  // Phase G — `paidFallbackEnabled` is forwarded from the per-lead
  // context. The router still enforces per-call cost gates as
  // defence-in-depth.
  const harvester = input.pgHarvester ?? new PgDetailHarvester();
  const stages: Stage[] = [
    new InputWebsiteStage(router),
    new PgDetailStage(router, harvester),
    new HyperGuesserStage(router, input.dnsResolver),
    new SerpStage(router, { paidFallbackEnabled: perLead.paidEnabled === true }),
    new RdapBoostStage(),
  ];

  const stageOutcomes: Record<string, StageOutcome> = {};
  let lastReasonCode: ReasonCode | undefined;

  for (const stage of stages) {
    perLead.layersAttempted.push(stage.name);
    try {
      const outcome = await stage.run(perLead, lead, normalized);
      stageOutcomes[stage.name] = outcome;
      if (outcome.provider) perLead.providersUsed.add(outcome.provider);
      // Phase 4.2.1: source-of-truth for per-lead cost is the CostLedger.
      // Stages may forget to populate StageOutcome.cost_eur; the ledger
      // already saw every router call (with meta.lead_id), so we sync
      // from there. This keeps `tierCapForLead()` honest in the next
      // iteration AND `lead.cost_eur` correct at finalize time.
      perLead.costEur = run.ledger.costForLead(perLead.leadId);
      if (outcome.status === 'success') break; // discovery succeeded — stop ladder
      lastReasonCode = outcome.reason_code ?? lastReasonCode;
    } catch (err) {
      const reason = classifyError(err);
      stageOutcomes[stage.name] = {
        stage: stage.name,
        status: 'error',
        duration_ms: 0,
        reason_code: reason,
        detail: (err as Error).message,
      };
      lastReasonCode = reason;
      // Sync cost even on stage error — the failed call may still have
      // cost the operator something (paid SERP that 5xx'd, etc.).
      perLead.costEur = run.ledger.costForLead(perLead.leadId);
      logger.warn({ stage: stage.name, err: (err as Error).message }, '[pipeline] stage threw');
    }
  }

  // ---- Financial enrichment (R13.1, orthogonal to website discovery) ----
  // Runs for EVERY lead that reached the ladder, regardless of whether a
  // website was found. Safe / no-network: it only promotes a checksum-valid
  // input P.IVA to `vat_code_final` and records provenance. It emits no
  // reason_code and never sets the lead status, so the website-discovery
  // verdict computed below is unaffected. Wrapped so a throw can never
  // break the lead's output row.
  const financialStage = input.financialStage ?? new FinancialStage({ enabled: true });
  perLead.layersAttempted.push(financialStage.name);
  try {
    const finOutcome = await financialStage.run(perLead, lead, normalized);
    stageOutcomes[financialStage.name] = finOutcome;
    // NOTE: deliberately NOT added to providersUsed — the financial source
    // ('input') is provenance, not a network provider.
  } catch (err) {
    stageOutcomes[financialStage.name] = {
      stage: financialStage.name,
      status: 'skipped',
      duration_ms: 0,
      detail: `financial_stage_threw: ${(err as Error).message}`,
    };
    logger.warn({ err: (err as Error).message }, '[pipeline] financial stage threw');
  }

  const found = !!lead.official_website;
  const status: typeof LeadStatus[keyof typeof LeadStatus] = found ? LeadStatus.FOUND_WEBSITE_ONLY : LeadStatus.NOT_FOUND;
  // Reason policy: keep the FIRST informative reason_code from the ladder.
  // Generic "no candidates" / "discovery exhausted" only win when nothing
  // more specific was produced upstream (e.g. the input website was a
  // directory — that's a more useful signal to the operator than "we
  // couldn't find anything else either").
  const GENERIC_REASONS = new Set<ReasonCode>([RC.DISCOVERY_EXHAUSTED, RC.NOT_FOUND_NO_CANDIDATES]);
  const informative = Object.values(stageOutcomes)
    .map((o) => o.reason_code)
    .filter((rc): rc is ReasonCode => !!rc && !GENERIC_REASONS.has(rc));
  const reasonCode: ReasonCode = found
    ? RC.FOUND_WEBSITE_ONLY
    : (informative[0] ?? lastReasonCode ?? RC.DISCOVERY_EXHAUSTED);

  return finalize(lead, {
    status,
    reason_code: reasonCode,
    stage_outcomes: stageOutcomes,
    start,
    perLead,
    outcome: found ? 'success' : 'not_found',
    run,
  });
}

function finalize(
  lead: Lead,
  args: {
    status: typeof LeadStatus[keyof typeof LeadStatus];
    reason_code: ReasonCode;
    stage_outcomes: Record<string, StageOutcome>;
    start: number;
    perLead: PerLeadContext;
    outcome: 'success' | 'partial' | 'not_found' | 'error';
    run: Run;
  }
): EnrichmentResult {
  lead.status = args.status;
  lead.reason_code = args.reason_code;
  lead.duration_ms = Date.now() - args.start;
  // Phase 4.2.1: lead.cost_eur is sourced from the canonical CostLedger
  // (filtered by lead_id), NOT from the in-memory perLead.costEur which
  // depended on stages remembering to populate StageOutcome.cost_eur.
  // Stages may attribute their cost only via router.fetch/search/complete
  // (which always tags the entry with meta.lead_id) — this guarantees
  // the final number matches what was actually billable.
  args.perLead.costEur = args.run.ledger.costForLead(args.perLead.leadId);
  lead.cost_eur = args.perLead.costEur;
  lead.providers_used = Array.from(args.perLead.providersUsed);
  lead.stage_outcomes = args.stage_outcomes;
  return {
    lead,
    outcome: args.outcome,
    stage_outcomes: args.stage_outcomes,
    duration_ms: lead.duration_ms,
    cost_eur: lead.cost_eur,
  };
}
