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
