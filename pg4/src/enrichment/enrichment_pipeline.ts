import type { Lead } from '../types/lead';
import type { NormalizedLead } from '../types/discovery';
import type { EnrichmentResult, PerLeadContext, Stage } from '../types/enrichment';
import type { StageOutcome, ReasonCode } from '../types/output';
import { LeadStatus, ReasonCode as RC, DiscoveryMethod } from '../types/output';
import { normalizeLead } from '../discovery/input_normalizer';
import { InputWebsiteCandidate } from '../discovery/website/input_website_candidate';
import { PreVerifyGate } from '../discovery/website/preverify_gate';
import { SerpDeduplicator } from '../discovery/website/serp_deduplicator';
import { HyperGuesser } from '../discovery/website/hyper_guesser';
import { RdapValidator } from '../discovery/website/rdap_validator';
import { isParked, isUnderConstruction } from '../discovery/website/content_filter';
import { DEFAULTS } from '../config/defaults';
import type { ProviderRouter } from '../providers/provider_router';
import type { Run } from '../runtime/run_context';
import { tierCapForLead } from '../runtime/run_context';
import { logger } from '../runtime/logger';
import { classifyError } from '../runtime/errors';

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
  const stages: Stage[] = [
    new InputWebsiteStage(router),
    new HyperGuesserStage(router, input.dnsResolver),
    new SerpStage(router),
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

/** Verify the input `website` field via direct_fetch + PreVerifyGate. */
class InputWebsiteStage implements Stage {
  readonly name = 'input_website';
  constructor(private router: ProviderRouter) {}

  async run(ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
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
    const verdict = await verifyCandidates(this.router, assessed.candidates.slice(0, 3), normalized, lead, {
      timeoutMs: DEFAULTS.pipeline.requestTimeoutMs,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
    });
    if (verdict.matched) {
      lead.website_discovery_method = verdict.method === 'piva' ? DiscoveryMethod.INPUT_PIVA_MATCH : DiscoveryMethod.INPUT_SEMANTIC;
      lead.website_confidence = verdict.confidence;
      return { stage: this.name, status: 'success', duration_ms: Date.now() - start, provider: verdict.provider, detail: verdict.detail };
    }
    return {
      stage: this.name,
      status: 'not_found',
      duration_ms: Date.now() - start,
      reason_code: verdict.timedOut ? RC.INPUT_WEBSITE_TIMEOUT : RC.INPUT_WEBSITE_NOT_VERIFIED,
      detail: verdict.detail,
    };
  }
}

/** Generate brand+city domain permutations, DNS-resolve, then verify alive ones. */
class HyperGuesserStage implements Stage {
  readonly name = 'hyper_guesser';
  constructor(private router: ProviderRouter, private dnsResolver?: (host: string) => Promise<string[]>) {}

  async run(ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
    const start = Date.now();
    const guesses = await HyperGuesser.run(normalized, { maxCandidates: 60, resolve4: this.dnsResolver });
    if (guesses.length === 0) {
      return { stage: this.name, status: 'not_found', duration_ms: Date.now() - start, reason_code: RC.NOT_FOUND_NO_CANDIDATES, detail: 'no_alive_domains' };
    }
    const candidateUrls = guesses.slice(0, 6).map((g) => `https://${g.domain}`);
    const verdict = await verifyCandidates(this.router, candidateUrls, normalized, lead, {
      timeoutMs: DEFAULTS.pipeline.requestTimeoutMs,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
    });
    if (verdict.matched) {
      lead.website_discovery_method = DiscoveryMethod.HYPER_GUESSER;
      lead.website_confidence = verdict.confidence;
      return { stage: this.name, status: 'success', duration_ms: Date.now() - start, provider: verdict.provider, detail: `alive=${guesses.length} ${verdict.detail}` };
    }
    return {
      stage: this.name,
      status: 'not_found',
      duration_ms: Date.now() - start,
      reason_code: RC.NOT_FOUND_NO_CANDIDATES,
      detail: `alive=${guesses.length} top=${guesses.slice(0, 3).map((g) => g.domain).join(',')}`,
    };
  }
}

/** Query free SERP providers, dedupe candidates, verify top hits. */
class SerpStage implements Stage {
  readonly name = 'serp';
  private dedup = new SerpDeduplicator();
  constructor(private router: ProviderRouter) {}

  async run(ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
    const start = Date.now();
    const query = this.buildQuery(normalized);
    // Per-lead budget gate: when the ceiling is hit we cap to free SERP
    // (tier ≤ 1). Free SERP is the default cap anyway today, but the
    // helper makes the policy uniform if/when the operator opens paid
    // tiers via env or CLI flag.
    const maxTier = Math.min(1, tierCapForLead(ctx, 1));
    const result = await this.router.search(query, {
      maxTier,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
    });
    if (!result.results || result.results.length === 0) {
      return { stage: this.name, status: 'not_found', duration_ms: Date.now() - start, reason_code: RC.DISCOVERY_EXHAUSTED, detail: 'no_serp_results' };
    }
    const ranked = this.dedup.dedupe([result.results], { limit: 8 });
    if (ranked.length === 0) {
      return { stage: this.name, status: 'not_found', duration_ms: Date.now() - start, reason_code: RC.REJECTED_DIRECTORY, detail: 'all_directory' };
    }
    const candidateUrls = ranked.slice(0, 5).map((c) => c.best_url);
    const verdict = await verifyCandidates(this.router, candidateUrls, normalized, lead, {
      timeoutMs: DEFAULTS.pipeline.requestTimeoutMs,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
    });
    if (verdict.matched) {
      lead.website_discovery_method = DiscoveryMethod.SERP_COMPANY;
      lead.website_confidence = verdict.confidence;
      return { stage: this.name, status: 'success', duration_ms: Date.now() - start, provider: verdict.provider, detail: `serp=${result.provider} top=${ranked[0].host}` };
    }
    return { stage: this.name, status: 'not_found', duration_ms: Date.now() - start, reason_code: RC.DISCOVERY_EXHAUSTED, detail: `serp=${result.provider} candidates=${ranked.length}` };
  }

  private buildQuery(n: NormalizedLead): string {
    const parts = [n.company_name];
    if (n.city) parts.push(n.city);
    if (n.vat_code) parts.push(`P.IVA ${n.vat_code}`);
    parts.push('sito ufficiale');
    return parts.join(' ');
  }
}

/**
 * RDAP rescue: if no website found yet, take the strongest HyperGuesser DNS
 * survivor (or the input website if it had a directory classification) and
 * check the WHOIS payload for P.IVA / company-name match.
 */
class RdapBoostStage implements Stage {
  readonly name = 'rdap';

  async run(_ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
    const start = Date.now();
    const target = normalized.website || lead.official_website;
    if (!target) {
      return { stage: this.name, status: 'skipped', duration_ms: 0, detail: 'no_target_domain' };
    }
    const ev = await RdapValidator.checkDomainOwnership(target, normalized);
    if (ev.confidence >= 0.8) {
      lead.official_website = lead.official_website ?? target;
      lead.website_discovery_method = DiscoveryMethod.RDAP_BINGO;
      lead.website_confidence = DEFAULTS.scoring.rdapBingoConfidence;
      return { stage: this.name, status: 'success', duration_ms: Date.now() - start, evidence_count: 1, detail: ev.detail };
    }
    if (ev.confidence >= 0.4) {
      lead.official_website = lead.official_website ?? target;
      lead.website_discovery_method = DiscoveryMethod.RDAP_NAME_MATCH;
      lead.website_confidence = ev.confidence;
      return { stage: this.name, status: 'success', duration_ms: Date.now() - start, evidence_count: 1, detail: ev.detail };
    }
    return { stage: this.name, status: 'not_found', duration_ms: Date.now() - start, reason_code: RC.DISCOVERY_EXHAUSTED, detail: ev.detail || 'no_rdap_match' };
  }
}

/**
 * Shared helper: try N candidate URLs via direct_fetch; on each successful
 * fetch, run PreVerifyGate. Returns the first match or summarizes the misses.
 */
async function verifyCandidates(
  router: ProviderRouter,
  candidates: string[],
  normalized: NormalizedLead,
  lead: Lead,
  opts: { timeoutMs?: number; meta?: Record<string, string | number | boolean> }
): Promise<{
  matched: boolean;
  method?: 'piva' | 'semantic';
  confidence?: number;
  provider?: string;
  detail?: string;
  timedOut?: boolean;
}> {
  let lastDetail = '';
  let timedOut = false;
  for (const candidate of candidates) {
    const res = await router.fetch(candidate, { timeoutMs: opts.timeoutMs, meta: opts.meta });
    if (!res.html || res.status < 200 || res.status >= 400) {
      lastDetail = `${candidate} status=${res.status}${res.error ? ` err=${res.error}` : ''}`;
      if (res.error?.toLowerCase().includes('timeout')) timedOut = true;
      continue;
    }
    // Skip parked / under-construction pages — they superficially semantic-match
    // because they often mirror the brand keywords back at us.
    const htmlLower = res.html.toLowerCase();
    if (isParked(htmlLower) || isUnderConstruction(htmlLower)) {
      lastDetail = `${candidate} parked_or_construction`;
      continue;
    }
    const gate = PreVerifyGate.check(candidate, res.html, normalized);
    if (gate.status === 'VERIFIED') {
      lead.official_website = candidate;
      return {
        matched: true,
        method: 'piva',
        confidence: DEFAULTS.scoring.pivaMatchConfidence,
        provider: res.provider,
        detail: 'piva_match',
      };
    }
    if (gate.status === 'VERIFIED_SEMANTIC') {
      lead.official_website = candidate;
      return {
        matched: true,
        method: 'semantic',
        confidence: DEFAULTS.scoring.semanticMatchConfidence,
        provider: res.provider,
        detail: gate.detail,
      };
    }
    lastDetail = `${candidate} gate=${gate.status} ${gate.detail ?? ''}`;
  }
  return { matched: false, detail: lastDetail || 'no_candidate_verified', timedOut };
}
