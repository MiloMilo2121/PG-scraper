import type { Lead } from '../../types/lead';
import type { NormalizedLead } from '../../types/discovery';
import type { PerLeadContext, Stage } from '../../types/enrichment';
import type { StageOutcome } from '../../types/output';
import { ReasonCode as RC, DiscoveryMethod } from '../../types/output';
import { HyperGuesser } from '../../discovery/website/hyper_guesser';
import { DEFAULTS } from '../../config/defaults';
import type { ProviderRouter } from '../../providers/provider_router';
import { verifyCandidates } from './verify_candidates';

/** Generate brand+city domain permutations, DNS-resolve, then verify alive ones. */
export class HyperGuesserStage implements Stage {
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
