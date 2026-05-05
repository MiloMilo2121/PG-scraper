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
