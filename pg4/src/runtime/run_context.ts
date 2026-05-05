import crypto from 'crypto';
import { CostLedger } from './cost_ledger';
import { MemoryCache } from './cache';
import { Backpressure } from './backpressure';
import { RateLimiter } from './rate_limiter';
import { getConfig } from '../config/env';
import type { ResolvedConfig } from '../config/env';
import type { PerLeadContext, RunContext } from '../types/enrichment';

/**
 * Container for the shared infrastructure used across a whole run
 * (one CLI invocation processes one CSV).
 */
export interface Run {
  ctx: RunContext;
  cfg: ResolvedConfig;
  ledger: CostLedger;
  cache: MemoryCache;
  backpressure: Backpressure;
  rate: RateLimiter;
}

export function createRun(): Run {
  const cfg = getConfig();
  const ledger = new CostLedger();
  const cache = new MemoryCache({ maxEntries: 10_000 });
  const backpressure = new Backpressure({
    initialConcurrency: cfg.pipeline.concurrency,
    maxConcurrency: cfg.pipeline.concurrency * 2,
  });
  const rate = new RateLimiter();
  const ctx: RunContext = {
    runId: `run-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    startedAt: Date.now(),
    costCeilingEur: cfg.pipeline.costCeilingEurPerLead,
    abort: new AbortController().signal,
  };
  return { ctx, cfg, ledger, cache, backpressure, rate };
}

export function createPerLeadContext(run: Run): PerLeadContext {
  return {
    runId: run.ctx.runId,
    leadId: crypto.randomUUID(),
    startedAt: Date.now(),
    costEur: 0,
    providersUsed: new Set(),
    layersAttempted: [],
    abort: run.ctx.abort,
  };
}
