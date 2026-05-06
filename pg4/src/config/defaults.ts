/**
 * Hard-coded defaults. Anything tunable in production goes through env →
 * `config/env.ts` → here. No magic numbers in modules.
 */

export const DEFAULTS = {
  pipeline: {
    concurrency: 4,
    costCeilingEurPerLead: 0.10,
    requestTimeoutMs: 8000,
    perStageTimeoutMs: 12000,
    /**
     * Phase D.3 — transport-class retry schedule for `verifyCandidates`.
     * `verifyRetryDelaysMs.length` is the number of EXTRA attempts after
     * the first fetch. Delays carry ±20% jitter at runtime.
     *
     * Triggers (per attempt): `transport` / `timeout` failure kinds, or
     * upstream 502 / 503 / 504. Anything else (4xx, 429, semantic
     * reject, parked, common-stem) skips retry immediately.
     *
     * `verifyRetryBudgetMs` caps the total *delay* time spent retrying
     * any single candidate. The fetch attempts themselves can take up
     * to `requestTimeoutMs` each, so the worst-case per-candidate
     * total is roughly `verifyRetryBudgetMs + (1 + retries) *
     * requestTimeoutMs`.
     *
     * The schedule is deliberately tight (`[300, 1500]` = 1.8 s of
     * waiting + 3 fetch attempts at most) because `perStageTimeoutMs`
     * is 12 s and a stage typically iterates 3-6 candidates. p63 TV
     * proved a `[300, 1000, 3000]` schedule starves the per-stage
     * budget: one flapping candidate eats up to ~36 s, so the stage
     * times out before reaching the legit one.
     */
    verifyRetryDelaysMs: [300, 1500] as readonly number[],
    verifyRetryBudgetMs: 2500,
  },
  scraper: {
    pgMaxPages: 30,
    browserRefreshEvery: 5,
    interPageDelayMs: 3000,
    overflowThreshold: 200, // PG returns banner >200 results
    mapsMaxScrollAttempts: 40,
    mapsScrollPauseMs: 1500,
  },
  cache: {
    l1MaxMemoryMB: 50,
  },
  http: {
    userAgent: 'pg4/0.1 (https://github.com/MiloMilo2121)',
    maxRetries: 2,
    retryBaseMs: 500,
  },
  llm: {
    defaultModel: 'gpt-4o-mini',
    maxTokens: 1024,
    temperature: 0,
  },
  scoring: {
    pivaMatchConfidence: 0.95,
    semanticMatchConfidence: 0.80,
    llmOracleSemanticConfidence: 0.75,
    rdapBingoConfidence: 0.90,
  },
} as const;
