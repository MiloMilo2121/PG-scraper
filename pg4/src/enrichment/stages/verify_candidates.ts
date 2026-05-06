import type { Lead } from '../../types/lead';
import type { NormalizedLead } from '../../types/discovery';
import type { ProviderRouter } from '../../providers/provider_router';
import { PreVerifyGate } from '../../discovery/website/preverify_gate';
import { isParked, isUnderConstruction } from '../../discovery/website/content_filter';
import { RdapValidator } from '../../discovery/website/rdap_validator';
import type { RdapEvidence } from '../../discovery/website/rdap_validator';
import { classifyHttpFailure } from '../../types/providers';
import { DEFAULTS } from '../../config/defaults';

/**
 * Shared helper used by every stage that verifies a list of candidate
 * URLs against the normalized lead.
 *
 * Try each candidate via the router's HTTP family (default: direct_fetch).
 * On each successful fetch, skip parked/under-construction pages and run
 * the layered `PreVerifyGate`. Phase D: when the gate returns
 * `VERIFIED_SEMANTIC`, this layer additionally calls `RdapValidator`
 * before accepting — if RDAP detects an explicit registrant mismatch
 * (different country / region / locality than the lead), the candidate
 * is rejected with `semantic_rejected_rdap_mismatch` instead.
 *
 * The RDAP veto is conservative: missing / private RDAP data does NOT
 * count as a mismatch.
 */
export interface VerifyCandidatesOpts {
  timeoutMs?: number;
  meta?: Record<string, string | number | boolean>;
  /**
   * Phase D: pluggable RDAP probe so unit tests can drop the network.
   * Defaults to `RdapValidator.checkDomainOwnership` at runtime.
   */
  rdapProbe?: (domain: string, lead: NormalizedLead, opts: { signal?: AbortSignal }) => Promise<RdapEvidence>;
  /**
   * Phase D: opt-out for callers that already validated RDAP elsewhere
   * (or for stages where the network call would double-cost). Default
   * `true` (corroborate). Tests pass `false` to skip the network.
   */
  corroborateWithRdap?: boolean;
  /**
   * Phase D.2: number of additional attempts for transport-class
   * fetch failures (ECONNREFUSED / ETIMEDOUT / 0 / 5xx-class transport).
   * Default 1 — i.e. up to 2 attempts total per candidate. Retries are
   * NEVER attempted for 4xx, semantic rejects, parked pages, or rate
   * limits. Tests can pass 0 to disable retries entirely.
   */
  transportRetries?: number;
  /**
   * Phase D.2: pluggable jitter generator for the retry delay (ms).
   * Tests pass `() => 0` to skip the wait. Defaults to 300-700 ms.
   */
  retryDelayMs?: () => number;
  /**
   * Phase D.2: pluggable sleep function so tests can fast-forward.
   * Defaults to `setTimeout`-based real sleep at runtime.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface VerifyVerdict {
  matched: boolean;
  method?: 'piva' | 'phone' | 'semantic';
  confidence?: number;
  provider?: string;
  detail?: string;
  timedOut?: boolean;
  /** Last detailed reason the gate emitted on this lead, for upstream stages. */
  rejectDetail?: string;
}

export async function verifyCandidates(
  router: ProviderRouter,
  candidates: string[],
  normalized: NormalizedLead,
  lead: Lead,
  opts: VerifyCandidatesOpts
): Promise<VerifyVerdict> {
  const rdapProbe = opts.rdapProbe ?? ((d, l, o) => RdapValidator.checkDomainOwnership(d, l, o));
  const corroborate = opts.corroborateWithRdap !== false;
  const transportRetries = opts.transportRetries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? (() => 300 + Math.floor(Math.random() * 400));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastDetail = '';
  let lastRejectDetail = '';
  let timedOut = false;
  for (const candidate of candidates) {
    let res = await router.fetch(candidate, { timeoutMs: opts.timeoutMs, meta: opts.meta });
    // Phase D.2: single retry on transport-class failures only.
    // Network flap (ECONNREFUSED on `pianon.eu` was the canonical case)
    // costs us real TPs without any logic problem; one retry with
    // 300-700 ms jitter typically recovers them. Never retry on 4xx,
    // semantic rejects, parked pages, or rate-limit signals.
    let retriesUsed = 0;
    while (
      retriesUsed < transportRetries &&
      (!res.html || res.status < 200 || res.status >= 400)
    ) {
      const kind = classifyHttpFailure({ status: res.status, error: res.error });
      if (kind !== 'transport' && kind !== 'timeout') break;
      retriesUsed++;
      await sleep(retryDelayMs());
      // Phase D.2: retry attempts must NOT double-count toward the
      // breaker threshold. The first attempt already incremented the
      // breaker; retrying the same flapped target should not push the
      // breaker over the trip line just because the network blip
      // repeats. Without this, p53 BL re-runs lost ~14 TPs to breaker
      // amplification (dropped from 19 found to 5 — 8 found).
      res = await router.fetch(candidate, {
        timeoutMs: opts.timeoutMs,
        meta: opts.meta,
        bypassBreakerRecord: true,
      });
    }
    if (!res.html || res.status < 200 || res.status >= 400) {
      lastDetail = `${candidate} status=${res.status}${res.error ? ` err=${res.error}` : ''}${retriesUsed > 0 ? ` retries=${retriesUsed}` : ''}`;
      if (res.error?.toLowerCase().includes('timeout')) timedOut = true;
      continue;
    }
    // Skip parked / under-construction pages — they superficially semantic-match
    // because they often mirror the brand keywords back at us.
    const htmlLower = res.html.toLowerCase();
    if (isParked(htmlLower) || isUnderConstruction(htmlLower)) {
      lastDetail = `${candidate} parked_or_construction`;
      lastRejectDetail = 'tiny_or_parked';
      continue;
    }
    const gate = PreVerifyGate.check(candidate, res.html, normalized);
    if (gate.status === 'VERIFIED' && gate.evidence === 'piva_match') {
      lead.official_website = candidate;
      return {
        matched: true,
        method: 'piva',
        confidence: DEFAULTS.scoring.pivaMatchConfidence,
        provider: res.provider,
        detail: 'piva_match',
      };
    }
    if (gate.status === 'VERIFIED' && gate.evidence === 'phone_match') {
      // Phone digit-match is strong but not as strong as PIVA. We use
      // phone-match as a "do not even bother RDAP-ing this one" anchor —
      // the operator's own phone number being on the page is hard to
      // fake without coordination.
      lead.official_website = candidate;
      return {
        matched: true,
        method: 'phone',
        confidence: DEFAULTS.scoring.pivaMatchConfidence,
        provider: res.provider,
        detail: 'phone_match',
      };
    }
    if (gate.status === 'VERIFIED_SEMANTIC') {
      // Phase D — RDAP corroborate before accepting a semantic-only match.
      // RDAP veto on explicit registrant mismatch (different country /
      // region / locality). Missing data is NOT a mismatch.
      if (corroborate) {
        try {
          const rdap = await rdapProbe(candidate, normalized, {});
          if (rdap.mismatch) {
            lastRejectDetail = `rdap_mismatch:${rdap.mismatch_reason ?? 'unspecified'}`;
            lastDetail = `${candidate} rdap_mismatch ${rdap.mismatch_reason ?? ''}`;
            continue;
          }
          // Optional small confidence boost when RDAP positively confirms
          // a vCard / payload name match.
          if (rdap.confidence >= 0.4) {
            lead.official_website = candidate;
            return {
              matched: true,
              method: 'semantic',
              confidence: Math.min(0.9, DEFAULTS.scoring.semanticMatchConfidence + 0.1),
              provider: res.provider,
              detail: `${gate.detail} rdap_confirmed=${rdap.evidence}`,
            };
          }
        } catch (err) {
          // RDAP transport failure does not veto; proceed with the
          // gate's verdict but keep the original (lower) confidence.
          // We log into rejectDetail for downstream observability.
          lastRejectDetail = `rdap_error:${(err as Error).message}`;
        }
      }
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
    if (gate.detail) lastRejectDetail = gate.detail;
  }
  return { matched: false, detail: lastDetail || 'no_candidate_verified', timedOut, rejectDetail: lastRejectDetail || undefined };
}
