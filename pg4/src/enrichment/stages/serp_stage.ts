import type { Lead } from '../../types/lead';
import type { NormalizedLead } from '../../types/discovery';
import type { PerLeadContext, Stage } from '../../types/enrichment';
import type { StageOutcome } from '../../types/output';
import { ReasonCode as RC, DiscoveryMethod } from '../../types/output';
import { SerpDeduplicator } from '../../discovery/website/serp_deduplicator';
import { DEFAULTS } from '../../config/defaults';
import type { ProviderRouter } from '../../providers/provider_router';
import { tierCapForLead } from '../../runtime/run_context';
import { verifyCandidates } from './verify_candidates';
import { evaluateSerperGate } from '../../discovery/website/smart_serper_gate';
import { logger } from '../../runtime/logger';

/**
 * Query free SERP providers, dedupe candidates, verify top hits.
 *
 * Phase D — reason-code split. Replaces the catch-all `REJECTED_DIRECTORY`
 * with three operator-actionable signals:
 *   - `SERP_EMPTY_ALL_PROVIDERS`  every provider returned []
 *   - `SERP_DIRECTORY_ONLY`       results existed but all classified as
 *                                 directory by `SerpDeduplicator`
 *   - `SERP_REJECTED_BY_VERIFY`   candidates fetched but the verify step
 *                                 (PreVerifyGate / RDAP) rejected them
 *
 * Phase G — paid fallback. After the free pass returns no verified
 * match, optionally run a paid SERP pass (Serper) gated by:
 *   - `paidEnabled === true` on the per-lead context
 *   - per-lead remaining budget covers the paid call cost
 *   - paid provider available (key + env flag)
 * The paid pass goes through the SAME directory/preverify/RDAP
 * pipeline. Discovery method on a paid match is `SERP_PAID`.
 */
export interface SerpStageOpts {
  /**
   * Phase G — when true the stage will run a paid SERP fallback if
   * the free pass returns no verified match. The router still
   * enforces per-lead budget, key presence, and env flags. When
   * false (default), the stage behaves exactly as in Phase F.
   */
  paidFallbackEnabled?: boolean;
  /** List of provider ids to use in the paid fallback. Default `['serper']`. */
  paidProviderIds?: ReadonlyArray<string>;
}

export class SerpStage implements Stage {
  readonly name = 'serp';
  private dedup = new SerpDeduplicator();
  constructor(
    private router: ProviderRouter,
    private opts: SerpStageOpts = {},
  ) {}

  async run(ctx: PerLeadContext, lead: Lead, normalized: NormalizedLead): Promise<StageOutcome> {
    const start = Date.now();
    const query = this.buildQuery(normalized);

    // ---- Free pass (tier ≤ 1, paid disabled) --------------------------------
    const maxTier = Math.min(1, tierCapForLead(ctx, 1));
    const free = await this.router.search(query, {
      maxTier,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
    });

    if (free.results && free.results.length > 0) {
      const ranked = this.dedup.dedupe([free.results], { limit: 8 });
      if (ranked.length > 0) {
        const candidateUrls = ranked.slice(0, 5).map((c) => c.best_url);
        const verdict = await verifyCandidates(this.router, candidateUrls, normalized, lead, {
          timeoutMs: DEFAULTS.pipeline.requestTimeoutMs,
          meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name },
        });
        if (verdict.matched) {
          lead.website_discovery_method = DiscoveryMethod.SERP_COMPANY;
          lead.website_confidence = verdict.confidence;
          return {
            stage: this.name,
            status: 'success',
            duration_ms: Date.now() - start,
            provider: verdict.provider,
            detail: `serp=${free.provider} top=${ranked[0].host} ${verdict.detail ?? ''}`.trim(),
          };
        }
      }
    }

    // ---- Paid fallback (Serper / tier 2) ------------------------------------
    // R4 — SmartSerperGate is the EARLIER veto layer. The lead must
    // have a deterministic signal beyond the name (P.IVA, phone,
    // email-domain, pg_url, address+locality) AND the brand must not
    // be in COMMON_BARE_STEMS. Budget gates in ProviderRouter remain
    // as defence-in-depth.
    if (this.opts.paidFallbackEnabled === true && ctx.paidEnabled === true) {
      const decision = evaluateSerperGate(normalized, lead);
      if (!decision.allow) {
        logger.info(
          { lead_id: ctx.leadId, run_id: ctx.runId, reasons: decision.reasons },
          '[serp.paid] gate denied — skipping paid pass',
        );
      } else {
        // Use the gate's top-priority recommended query (R2 variant).
        // pg4 keeps paid as a scalpel: ONE targeted query per lead.
        const paidQuery = decision.recommendedQueries[0]?.query ?? query;
        const paidVerdict = await this.runPaidPass(
          ctx,
          lead,
          normalized,
          paidQuery,
          free.provider,
          start,
        );
        if (paidVerdict !== null) return paidVerdict;
      }
    }

    // ---- Free-only failure paths --------------------------------------------
    if (!free.results || free.results.length === 0) {
      return {
        stage: this.name,
        status: 'not_found',
        duration_ms: Date.now() - start,
        reason_code: RC.SERP_EMPTY_ALL_PROVIDERS,
        detail: 'no_serp_results',
      };
    }
    const ranked = this.dedup.dedupe([free.results], { limit: 8 });
    if (ranked.length === 0) {
      return {
        stage: this.name,
        status: 'not_found',
        duration_ms: Date.now() - start,
        reason_code: RC.SERP_DIRECTORY_ONLY,
        detail: `serp=${free.provider} input=${free.results.length} dropped_all_as_directory`,
      };
    }
    return {
      stage: this.name,
      status: 'not_found',
      duration_ms: Date.now() - start,
      reason_code: RC.SERP_REJECTED_BY_VERIFY,
      detail: `serp=${free.provider} candidates=${ranked.length}`,
    };
  }

  /**
   * Phase G — paid SERP fallback. Returns a populated `StageOutcome`
   * when the paid pass yields a verified match, or `null` to let the
   * free-pass failure paths run.
   */
  private async runPaidPass(
    ctx: PerLeadContext,
    lead: Lead,
    normalized: NormalizedLead,
    query: string,
    freeProvider: string,
    start: number,
  ): Promise<StageOutcome | null> {
    const remaining = (ctx.costCeilingEur ?? 0) - ctx.costEur;
    const paidIds = this.opts.paidProviderIds; // undefined → router picks any paid provider
    // Phase G fix — `paidOnly: true` excludes free providers. Without
    // this, router's tier-ascending loop returns on the first free
    // provider that produces results (bing_html), so Serper is never
    // reached. p90 first-attempt ledger showed 372 paid-pass calls
    // and 0 actual Serper calls because of this.
    // Phase G hotfix — `runCostCeilingEur` threaded so the router
    // can enforce the run-level cap. p90 second-attempt blew past
    // the €0.10 cap (spent €0.229) because the cap was previously
    // threaded but never gated.
    const paid = await this.router.search(query, {
      paidEnabled: true,
      paidOnly: true,
      remainingLeadBudgetEur: remaining,
      runCostCeilingEur: ctx.runCostCeilingEur,
      includeProviderIds: paidIds,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name, pass: 'paid' },
    });
    if (!paid.results || paid.results.length === 0) return null;
    const ranked = this.dedup.dedupe([paid.results], { limit: 8 });
    if (ranked.length === 0) return null;
    const candidateUrls = ranked.slice(0, 5).map((c) => c.best_url);
    const verdict = await verifyCandidates(this.router, candidateUrls, normalized, lead, {
      timeoutMs: DEFAULTS.pipeline.requestTimeoutMs,
      meta: { lead_id: ctx.leadId, run_id: ctx.runId, stage: this.name, pass: 'paid' },
    });
    if (verdict.matched) {
      lead.website_discovery_method = DiscoveryMethod.SERP_PAID;
      lead.website_confidence = verdict.confidence;
      // Phase G.1 — providers_used must record the PAID SERP that
      // produced the candidate, not just the HTTP fetcher used to
      // verify it. Without this every SERP_PAID lead reports only
      // `direct_fetch` and the cost-attribution chain breaks.
      ctx.providersUsed.add(paid.provider);
      return {
        stage: this.name,
        status: 'success',
        duration_ms: Date.now() - start,
        provider: verdict.provider,
        detail: `serp_free=${freeProvider} serp_paid=${paid.provider} top=${ranked[0].host} ${verdict.detail ?? ''}`.trim(),
      };
    }
    return null;
  }

  private buildQuery(n: NormalizedLead): string {
    const parts = [n.company_name];
    if (n.city) parts.push(n.city);
    if (n.vat_code) parts.push(`P.IVA ${n.vat_code}`);
    parts.push('sito ufficiale');
    return parts.join(' ');
  }
}
