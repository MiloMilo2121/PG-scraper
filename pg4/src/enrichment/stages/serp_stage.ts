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

/** Query free SERP providers, dedupe candidates, verify top hits. */
export class SerpStage implements Stage {
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
