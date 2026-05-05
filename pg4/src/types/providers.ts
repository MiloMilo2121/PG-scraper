/**
 * Provider interfaces. Every provider declares its family, tier, and cost.
 * The router selects ascending by tier, gated by feature flags + key presence.
 */

export type ProviderFamily = 'serp' | 'http' | 'llm';

export interface SerpResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
  source_provider: string;
}

export interface HttpFetchResult {
  status: number;
  html?: string;
  finalUrl?: string;
  duration_ms: number;
  cost_eur: number;
  provider: string;
  error?: string;
}

export interface LLMCompletionRequest {
  system?: string;
  prompt: string;
  json_schema?: unknown;
  max_tokens?: number;
  temperature?: number;
}

export interface LLMCompletionResult {
  content: string;
  cost_eur: number;
  model: string;
  provider: string;
}

/** Base provider — every provider implements this. */
export interface Provider {
  readonly id: string;
  readonly family: ProviderFamily;
  readonly tier: number;
  readonly costPerCallEur: number;
  /** Returns true if API key + feature flag are both set. */
  available(): boolean;
}

export interface SerpProvider extends Provider {
  family: 'serp';
  search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<SerpResult[]>;
}

export interface HttpProvider extends Provider {
  family: 'http';
  fetch(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<HttpFetchResult>;
}

export interface LLMProvider extends Provider {
  family: 'llm';
  complete(req: LLMCompletionRequest, opts?: { signal?: AbortSignal }): Promise<LLMCompletionResult>;
}

export type AnyProvider = SerpProvider | HttpProvider | LLMProvider;

/**
 * Tagged error for "the provider's response was a Cloudflare/captcha
 * block page", as opposed to "the provider returned a legitimate empty
 * result set". The router uses this to drive the circuit breaker
 * aggressively (block hits cost more than empty misses).
 */
export class ProviderBlockError extends Error {
  readonly providerId: string;
  constructor(providerId: string, message = 'provider returned a block page') {
    super(message);
    this.name = 'ProviderBlockError';
    this.providerId = providerId;
  }
}

/** Classified failure kind used by router → ledger + breaker. */
export type FailureKind = 'blocked' | 'rate_limit' | 'transport' | 'timeout' | 'other';

export function classifyHttpFailure(opts: { status?: number; error?: string }): FailureKind {
  const msg = (opts.error ?? '').toLowerCase();
  if (opts.status === 429 || /rate.?limit|429/.test(msg)) return 'rate_limit';
  if (msg.includes('timeout') || msg.includes('etimedout')) return 'timeout';
  if (
    opts.status === 0 ||
    opts.status === 502 ||
    opts.status === 503 ||
    opts.status === 504 ||
    /econnreset|econnrefused|enotfound|socket|fetch failed/.test(msg)
  ) {
    return 'transport';
  }
  return 'other';
}
