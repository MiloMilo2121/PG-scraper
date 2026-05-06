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
   * Phase D.3: per-attempt delay schedule (ms) for transport-class
   * fetch failures (ECONNREFUSED / ETIMEDOUT / 502 / 503 / 504).
   * Length = max number of retries after the first fetch. Default
   * `[300, 1000, 3000]` → up to 4 attempts total. Tests pass `[]` to
   * disable retries entirely. Delays get ±20% jitter at runtime.
   */
  retryDelaysMs?: readonly number[];
  /**
   * Phase D.3: per-candidate retry budget (ms). When the cumulative
   * retry delay would exceed this, no further attempt is made for
   * THIS candidate. Default 12000 ms.
   */
  retryBudgetMs?: number;
  /**
   * Phase D.3: pluggable jitter — receives the planned delay, returns
   * the delay actually used. Tests pass `(d) => d` for determinism or
   * `() => 0` to skip the wait. Defaults to ±20% uniform jitter.
   */
  jitter?: (delayMs: number) => number;
  /**
   * Phase D.2/3: pluggable sleep function so tests can fast-forward.
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

/**
 * Phase D.4 — per-candidate verification plan. Used by callers (today
 * `HyperGuesserStage`) that have already ranked their candidates and
 * want to spend the retry budget proportional to candidate strength.
 *
 * The strong / weak split prevents the failure mode TV p64 surfaced:
 * a flapping weak candidate burns the per-stage budget before the
 * legit one gets tried. The ranker assigns a tier; this struct
 * encodes the retry policy each tier earns.
 */
export interface CandidateVerificationPlan {
  url: string;
  /** Optional override of the per-attempt retry schedule (ms). */
  retryDelaysMs?: readonly number[];
  /** Optional override of the per-candidate retry budget (ms). */
  retryBudgetMs?: number;
  /** Diagnostic — the rank score and reasons that drove this plan. */
  rankScore?: number;
  rankReasons?: readonly string[];
}

export async function verifyCandidates(
  router: ProviderRouter,
  candidates: string[],
  normalized: NormalizedLead,
  lead: Lead,
  opts: VerifyCandidatesOpts
): Promise<VerifyVerdict> {
  // Back-compat: string[] callers get the global retry policy from opts
  // / DEFAULTS for every candidate.
  const plans: CandidateVerificationPlan[] = candidates.map((url) => ({ url }));
  return verifyPlannedCandidates(router, plans, normalized, lead, opts);
}

/**
 * Phase D.4 — per-candidate retry policy variant. Each plan can override
 * the global `retryDelaysMs` / `retryBudgetMs`. Used by HyperGuesserStage
 * to give the top-ranked candidate the full retry budget while capping
 * weak candidates to a single attempt.
 *
 * Iteration order is the order of `plans` — the caller is expected to
 * sort by rank descending. Returns on first match.
 */
export async function verifyPlannedCandidates(
  router: ProviderRouter,
  plans: ReadonlyArray<CandidateVerificationPlan>,
  normalized: NormalizedLead,
  lead: Lead,
  opts: VerifyCandidatesOpts
): Promise<VerifyVerdict> {
  const rdapProbe = opts.rdapProbe ?? ((d, l, o) => RdapValidator.checkDomainOwnership(d, l, o));
  const corroborate = opts.corroborateWithRdap !== false;
  const defaultRetryDelays = opts.retryDelaysMs ?? DEFAULTS.pipeline.verifyRetryDelaysMs;
  const defaultRetryBudget = opts.retryBudgetMs ?? DEFAULTS.pipeline.verifyRetryBudgetMs;
  const jitter = opts.jitter ?? ((d: number) => d * (0.8 + Math.random() * 0.4));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastDetail = '';
  let lastRejectDetail = '';
  let timedOut = false;
  for (const plan of plans) {
    const candidate = plan.url;
    const retryDelaysMs = plan.retryDelaysMs ?? defaultRetryDelays;
    const retryBudgetMs = plan.retryBudgetMs ?? defaultRetryBudget;
    let res = await router.fetch(candidate, { timeoutMs: opts.timeoutMs, meta: opts.meta });
    // Phase D.2/D.3: scheduled retry on transport-class failures only.
    // Single retry (D.2) recovers single-blip ECONNREFUSED-then-200
    // (pianon.eu in BL). Multi-retry with backoff (D.3) recovers
    // consecutive flap (TV `direct_fetch.success_rate=0.45` ledger
    // showed many leads lost a real TP to repeated flap). Never retry
    // on 4xx (per-target outcome), 429 (would re-trigger the limit),
    // semantic reject, or parked pages.
    let retriesUsed = 0;
    let elapsedRetryMs = 0;
    while (
      retriesUsed < retryDelaysMs.length &&
      (!res.html || res.status < 200 || res.status >= 400)
    ) {
      const kind = classifyHttpFailure({ status: res.status, error: res.error });
      const upstream5xx = res.status === 502 || res.status === 503 || res.status === 504;
      // The router's "no provider succeeded" fall-through returns
      // `{ status: 0, error: <last-provider-error> }` regardless of
      // whether the upstream actually had a transport-class failure
      // or a 4xx response. classifyHttpFailure(status=0, *) is always
      // 'transport' because status=0 maps to transport unconditionally.
      // Without this guard, a `404 not found` ends up retried 3×.
      const errMsg = (res.error ?? '').toLowerCase();
      const looksLikeTransport =
        upstream5xx ||
        kind === 'timeout' ||
        /econnreset|econnrefused|enotfound|socket|fetch failed|timeout|etimedout/.test(errMsg);
      const isRetryable = looksLikeTransport;
      if (!isRetryable) break;
      const planned = retryDelaysMs[retriesUsed];
      const delay = Math.max(0, jitter(planned));
      if (elapsedRetryMs + delay > retryBudgetMs) break;
      retriesUsed++;
      elapsedRetryMs += delay;
      await sleep(delay);
      // Phase D.2: retry attempts must NOT double-count toward the
      // breaker threshold. First attempt already incremented the
      // breaker; retrying the same flapped target should not push it
      // over the trip line. Ledger still records every attempt for
      // cost / observability accounting.
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
