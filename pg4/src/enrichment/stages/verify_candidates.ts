import type { Lead } from '../../types/lead';
import type { NormalizedLead } from '../../types/discovery';
import type { ProviderRouter } from '../../providers/provider_router';
import { PreVerifyGate } from '../../discovery/website/preverify_gate';
import { isParked, isUnderConstruction } from '../../discovery/website/content_filter';
import { DEFAULTS } from '../../config/defaults';

/**
 * Shared helper used by every stage that verifies a list of candidate
 * URLs against the normalized lead.
 *
 * Try each candidate via the router's HTTP family (default: direct_fetch).
 * On each successful fetch, skip parked/under-construction pages and run
 * the `PreVerifyGate` (PIVA digit-match → VERIFIED, semantic name+anchor
 * match → VERIFIED_SEMANTIC). Returns the first match or summarizes the
 * miss with `lastDetail` so the caller can attach it to a stage outcome.
 */
export interface VerifyCandidatesOpts {
  timeoutMs?: number;
  meta?: Record<string, string | number | boolean>;
}

export interface VerifyVerdict {
  matched: boolean;
  method?: 'piva' | 'semantic';
  confidence?: number;
  provider?: string;
  detail?: string;
  timedOut?: boolean;
}

export async function verifyCandidates(
  router: ProviderRouter,
  candidates: string[],
  normalized: NormalizedLead,
  lead: Lead,
  opts: VerifyCandidatesOpts
): Promise<VerifyVerdict> {
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
