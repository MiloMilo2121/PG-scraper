/**
 * Per-key circuit breaker.
 *
 * Phase 3.7 audit of pg3 logs found:
 *   - 89 `CRTSH_ERROR: DB returned non-200 status. Status: 502/503` in a
 *     single batch — crt.sh routinely 5xx-storms, but pg3 retried it for
 *     every lead.
 *   - Repeated `CLOUDFLARE_TURNSTILE on bing.com via scraper_client` —
 *     once Bing serves a captcha to your IP, the next ~1000 calls also
 *     get the captcha. pg3 kept calling.
 *   - `ENOTFOUND rdap.nic.it` storms when the registry was down.
 *
 * The breaker enforces: after N consecutive failures inside `windowMs`,
 * trip OPEN; after `cooldownMs` move to HALF_OPEN; the next outcome
 * decides whether to close back or re-open. While OPEN, callers see the
 * key as unavailable and route around it — exactly like a feature flag.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitConfig {
  failureThreshold: number; // consecutive failures before tripping
  windowMs: number; // window over which failures count
  cooldownMs: number; // OPEN → HALF_OPEN delay
}

interface CircuitInternal {
  state: CircuitState;
  consecutiveFailures: number;
  firstFailureTs: number;
  openedAt: number;
  /** Last failure kind reported by the caller — informational only. */
  lastFailureKind?: string;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 120_000,
};

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitInternal>();
  private readonly cfg: CircuitConfig;
  private readonly perKeyConfig = new Map<string, CircuitConfig>();
  private readonly now: () => number;

  constructor(cfg: Partial<CircuitConfig> = {}, opts: { now?: () => number } = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.now = opts.now ?? (() => Date.now());
  }

  /** Override the global config for one specific key (e.g. `crtsh`). */
  configure(key: string, cfg: Partial<CircuitConfig>): void {
    this.perKeyConfig.set(key, { ...this.cfg, ...cfg });
  }

  /** True when the key is allowed to make a call right now. */
  allow(key: string): boolean {
    const s = this.states.get(key);
    if (!s) return true;
    if (s.state === 'closed') return true;
    if (s.state === 'half_open') return true;
    // OPEN: check cooldown
    const cfg = this.cfgFor(key);
    if (this.now() - s.openedAt >= cfg.cooldownMs) {
      s.state = 'half_open';
      return true;
    }
    return false;
  }

  recordSuccess(key: string): void {
    const s = this.states.get(key);
    if (!s) return;
    // Any success resets the breaker.
    s.state = 'closed';
    s.consecutiveFailures = 0;
    s.firstFailureTs = 0;
    s.openedAt = 0;
  }

  /**
   * Record a punitive failure. `kind` is informational and surfaces in
   * `snapshot()`; it does NOT change the trip math, which gives every
   * call site a single, simple contract: "if you call `recordFailure`,
   * the breaker treats it as a real failure". Empty SERP results MUST
   * NOT call this — pg3's logs proved free SERP returns empty more
   * often than not, and the breaker would lock down DDG/crt.sh
   * permanently.
   */
  recordFailure(key: string, kind?: string): void {
    const cfg = this.cfgFor(key);
    const t = this.now();
    let s = this.states.get(key);
    if (!s) {
      s = { state: 'closed', consecutiveFailures: 0, firstFailureTs: 0, openedAt: 0 };
      this.states.set(key, s);
    }
    s.lastFailureKind = kind;
    if (s.state === 'half_open') {
      // A failure in the trial run reopens the circuit.
      s.state = 'open';
      s.openedAt = t;
      s.consecutiveFailures += 1;
      return;
    }
    // Reset the window if too much time passed since the first failure.
    if (s.firstFailureTs === 0 || t - s.firstFailureTs > cfg.windowMs) {
      s.firstFailureTs = t;
      s.consecutiveFailures = 1;
    } else {
      s.consecutiveFailures += 1;
    }
    if (s.consecutiveFailures >= cfg.failureThreshold) {
      s.state = 'open';
      s.openedAt = t;
    }
  }

  /** Diagnostic: snapshot of all keys for boot/runtime logging. */
  snapshot(): Array<{ key: string; state: CircuitState; consecutiveFailures: number; lastFailureKind?: string }> {
    return Array.from(this.states.entries()).map(([k, v]) => ({
      key: k,
      state: v.state,
      consecutiveFailures: v.consecutiveFailures,
      lastFailureKind: v.lastFailureKind,
    }));
  }

  private cfgFor(key: string): CircuitConfig {
    return this.perKeyConfig.get(key) ?? this.cfg;
  }
}
