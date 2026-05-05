import type { Lead } from '../types/lead';
import type { NormalizedLead } from '../types/discovery';
import type { EnrichmentResult, PerLeadContext, Stage } from '../types/enrichment';
import type { StageOutcome, ReasonCode } from '../types/output';
import { LeadStatus, ReasonCode as RC, DiscoveryMethod } from '../types/output';
import { normalizeLead } from '../discovery/input_normalizer';
import { InputWebsiteCandidate } from '../discovery/website/input_website_candidate';
import { PreVerifyGate } from '../discovery/website/preverify_gate';
import { DEFAULTS } from '../config/defaults';
import type { ProviderRouter } from '../providers/provider_router';
import type { Run } from '../runtime/run_context';
import { logger } from '../runtime/logger';
import { classifyError } from '../runtime/errors';

export interface PipelineInput {
  run: Run;
  perLead: PerLeadContext;
  router: ProviderRouter;
  lead: Lead;
  ingestError?: string;
}

export async function runEnrichmentPipeline(input: PipelineInput): Promise<EnrichmentResult> {
  const start = Date.now();
  const { lead, run, perLead, router, ingestError } = input;

  // ---- Ingest error short-circuit ----
  if (ingestError) {
    return finalize(lead, {
      status: LeadStatus.ERROR,
      reason_code: RC.ERROR_INVALID_INPUT_ROW,
      stage_outcomes: { ingest: { stage: 'ingest', status: 'error', duration_ms: 0, reason_code: RC.ERROR_INVALID_INPUT_ROW, detail: ingestError } },
      start,
      perLead,
      outcome: 'error',
    });
  }

  // ---- Normalize ----
  const normalized = normalizeLead(lead);
  perLead.layersAttempted.push('NORMALIZE');

  if (normalized.quality_score < 0.3) {
    return finalize(lead, {
      status: LeadStatus.SKIPPED,
      reason_code: RC.INPUT_QUALITY_TOO_LOW,
      stage_outcomes: { normalize: { stage: 'normalize', status: 'skipped', duration_ms: 0, reason_code: RC.INPUT_QUALITY_TOO_LOW, detail: `quality=${normalized.quality_score}` } },
      start,
      perLead,
      outcome: 'not_found',
    });
  }

  // ---- Stage list (Phase 2: only input-website) ----
  const stages: Stage[] = [new InputWebsiteStage(router)];

  const stageOutcomes: Record<string, StageOutcome> = {};
  let lastReasonCode: ReasonCode | undefined;

  for (const stage of stages) {
    perLead.layersAttempted.push(stage.name);
    try {
      const outcome = await stage.run(perLead, lead, normalized);
      stageOutcomes[stage.name] = outcome;
      if (outcome.cost_eur) perLead.costEur += outcome.cost_eur;
      if (outcome.provider) perLead.providersUsed.add(outcome.provider);
      if (outcome.status === 'success') {
        // Early exit: a stage succeeded.
        break;
      }
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
      logger.warn({ stage: stage.name, err: (err as Error).message }, '[pipeline] stage threw');
    }
  }

  // ---- Decide final status ----
  const found = !!lead.official_website;
  const status: typeof LeadStatus[keyof typeof LeadStatus] = found ? LeadStatus.FOUND_WEBSITE_ONLY : LeadStatus.NOT_FOUND;
  const reasonCode = found ? RC.FOUND_WEBSITE_ONLY : (lastReasonCode ?? RC.DISCOVERY_EXHAUSTED);

  return finalize(lead, {
    status,
    reason_code: reasonCode,
    stage_outcomes: stageOutcomes,
    start,
    perLead,
    outcome: found ? 'success' : 'not_found',
  });

  void run; // run object reserved for cost ceiling checks in later phases
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
  }
): EnrichmentResult {
  lead.status = args.status;
  lead.reason_code = args.reason_code;
  lead.duration_ms = Date.now() - args.start;
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

/**
 * STAGE 1: Input Website Verification
 * If the input row carries a `website`, classify it; if VALID, fetch up to N
 * variants via direct_fetch and run PreVerifyGate on the HTML.
 */
class InputWebsiteStage implements Stage {
  readonly name = 'input_website';
  constructor(private router: ProviderRouter) {}

  async run(_ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
    const start = Date.now();
    const website = normalized.website;
    if (!website) {
      return { stage: this.name, status: 'skipped', duration_ms: 0, reason_code: RC.NOT_FOUND_NO_CANDIDATES, detail: 'no_input_website' };
    }

    const assessed = InputWebsiteCandidate.assess(website);
    if (assessed.classification !== 'VALID') {
      return {
        stage: this.name,
        status: 'not_found',
        duration_ms: Date.now() - start,
        reason_code: (assessed.reason_code as ReasonCode) ?? RC.INPUT_WEBSITE_INVALID,
        detail: `classification=${assessed.classification}`,
      };
    }

    const candidates = assessed.candidates.slice(0, 3);
    let lastDetail = '';
    for (const candidate of candidates) {
      const res = await this.router.fetch(candidate, { timeoutMs: DEFAULTS.pipeline.requestTimeoutMs });
      if (!res.html || res.status < 200 || res.status >= 400) {
        lastDetail = `${candidate} status=${res.status}${res.error ? ` err=${res.error}` : ''}`;
        continue;
      }
      const gate = PreVerifyGate.check(candidate, res.html, normalized);
      if (gate.status === 'VERIFIED') {
        lead.official_website = candidate;
        lead.website_confidence = DEFAULTS.scoring.pivaMatchConfidence;
        lead.website_discovery_method = DiscoveryMethod.INPUT_PIVA_MATCH;
        return { stage: this.name, status: 'success', duration_ms: Date.now() - start, provider: res.provider, evidence_count: 1, detail: 'piva_match' };
      }
      if (gate.status === 'VERIFIED_SEMANTIC') {
        lead.official_website = candidate;
        lead.website_confidence = DEFAULTS.scoring.semanticMatchConfidence;
        lead.website_discovery_method = DiscoveryMethod.INPUT_SEMANTIC;
        return { stage: this.name, status: 'success', duration_ms: Date.now() - start, provider: res.provider, evidence_count: 1, detail: gate.detail };
      }
      lastDetail = `${candidate} gate=${gate.status} ${gate.detail ?? ''}`;
    }

    return {
      stage: this.name,
      status: 'not_found',
      duration_ms: Date.now() - start,
      reason_code: RC.INPUT_WEBSITE_NOT_VERIFIED,
      detail: lastDetail || 'no_candidate_verified',
    };
  }
}
