import type { AnyProvider, HttpProvider, LLMProvider, SerpProvider } from '../types/providers';
import type { CostLedger } from '../runtime/cost_ledger';
import { CircuitBreaker } from '../runtime/circuit_breaker';
import { logger } from '../runtime/logger';

export interface RouteOptions {
  /** Cap the maximum tier to use (e.g. 1 = free + cheap only). */
  maxTier?: number;
  /** Cap how many providers to try in this call. */
  maxProviders?: number;
  signal?: AbortSignal;
}

/**
 * Cost-tiered provider selector. Iterates ascending by tier and skips
 * unavailable providers (missing key / disabled by feature flag / circuit
 * breaker open).
 *
 * The router is family-aware: SERP / HTTP / LLM each have their own ordered
 * registry; callers ask the router to "search/fetch/complete" and it returns
 * the first non-empty success.
 *
 * Circuit breaker (Phase 3.7) trips a provider after N consecutive failures
 * within a window — protects against crt.sh 5xx storms, Bing Cloudflare-
 * Turnstile loops, RDAP outages.
 */
export class ProviderRouter {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly serps: SerpProvider[],
    private readonly https: HttpProvider[],
    private readonly llms: LLMProvider[],
    private readonly ledger: CostLedger,
    breaker?: CircuitBreaker
  ) {
    this.breaker = breaker ?? new CircuitBreaker();
  }

  async search(query: string, opts: RouteOptions = {}) {
    const candidates = this.filter(this.serps, opts);
    for (const p of candidates) {
      try {
        const results = await p.search(query, { signal: opts.signal });
        // Empty result is NOT a failure for the breaker — it's a normal miss.
        // Only thrown errors trip the breaker.
        this.ledger.record(p.id, p.family, p.costPerCallEur, results.length > 0);
        this.breaker.recordSuccess(p.id);
        if (results.length > 0) return { provider: p.id, results };
      } catch (err) {
        this.ledger.record(p.id, p.family, p.costPerCallEur, false);
        this.breaker.recordFailure(p.id);
        logger.warn({ provider: p.id, err: (err as Error).message }, '[Router] serp provider failed');
      }
    }
    return { provider: 'none', results: [] };
  }

  async fetch(url: string, opts: RouteOptions & { timeoutMs?: number } = {}) {
    const candidates = this.filter(this.https, opts);
    let lastError: string | undefined;
    for (const p of candidates) {
      try {
        const res = await p.fetch(url, { timeoutMs: opts.timeoutMs, signal: opts.signal });
        const ok = res.status >= 200 && res.status < 400 && !!res.html;
        this.ledger.record(p.id, p.family, res.cost_eur || p.costPerCallEur, ok);
        if (ok) {
          this.breaker.recordSuccess(p.id);
          return { ...res, provider: p.id };
        }
        // 4xx/5xx that smell like network-level breakage are breaker events.
        // 404 / 403 on a single URL aren't — they're per-target outcomes.
        if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
          this.breaker.recordFailure(p.id);
        }
        lastError = res.error;
      } catch (err) {
        this.ledger.record(p.id, p.family, p.costPerCallEur, false);
        this.breaker.recordFailure(p.id);
        lastError = (err as Error).message;
      }
    }
    return { provider: 'none', status: 0, html: undefined, error: lastError, duration_ms: 0, cost_eur: 0 };
  }

  async complete(req: Parameters<LLMProvider['complete']>[0], opts: RouteOptions = {}) {
    const candidates = this.filter(this.llms, opts);
    for (const p of candidates) {
      try {
        const res = await p.complete(req, { signal: opts.signal });
        this.ledger.record(p.id, p.family, res.cost_eur || p.costPerCallEur, true);
        this.breaker.recordSuccess(p.id);
        return res;
      } catch (err) {
        this.ledger.record(p.id, p.family, p.costPerCallEur, false);
        this.breaker.recordFailure(p.id);
        logger.warn({ provider: p.id, err: (err as Error).message }, '[Router] llm provider failed');
      }
    }
    return null;
  }

  /** Allow the catalog to tune circuit-breaker thresholds per provider. */
  configureBreaker(providerId: string, cfg: Parameters<CircuitBreaker['configure']>[1]): void {
    this.breaker.configure(providerId, cfg);
  }

  /** Diagnostic snapshot of the breaker (used by boot logging). */
  describeBreaker() {
    return this.breaker.snapshot();
  }

  /** Diagnostic: list capability surface (for boot-time logging). */
  describe() {
    const fmt = (p: AnyProvider) => `${p.id}@T${p.tier}${p.available() ? '' : '(disabled)'}`;
    return {
      serp: this.serps.map(fmt),
      http: this.https.map(fmt),
      llm: this.llms.map(fmt),
    };
  }

  private filter<T extends AnyProvider>(arr: T[], opts: RouteOptions): T[] {
    return arr
      .filter((p) => p.available())
      .filter((p) => this.breaker.allow(p.id))
      .filter((p) => opts.maxTier === undefined || p.tier <= opts.maxTier)
      .sort((a, b) => a.tier - b.tier)
      .slice(0, opts.maxProviders ?? Number.MAX_SAFE_INTEGER);
  }
}
