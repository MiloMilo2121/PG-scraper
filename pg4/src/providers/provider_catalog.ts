import type { HttpProvider, LLMProvider, SerpProvider } from '../types/providers';
import { ProviderRouter } from './provider_router';
import type { CostLedger } from '../runtime/cost_ledger';
import { CircuitBreaker } from '../runtime/circuit_breaker';
import { getEnv } from '../config/env';
import { logger } from '../runtime/logger';

import { DirectFetchProvider } from './http/direct_fetch';
import { DnsMxProvider } from './serp/dns_mx';
import { CrtshProvider } from './serp/crtsh';
import { DdgLiteProvider } from './serp/ddg_lite';
import { BingHtmlProvider } from './serp/bing_html';
import { SerperProvider } from './serp/serper';

/**
 * The provider registry. Adds providers in tier order. Missing API keys are
 * tolerated — the provider is still listed but `available()` returns false
 * and the router skips it.
 *
 * Phase 1: only `direct_fetch` (HTTP tier 0).
 * Phase 3: free SERP providers (dns_mx, crtsh, ddg_lite, bing_html).
 * Phase 3+: paid providers behind feature flags.
 */
export function buildProviderCatalog(ledger: CostLedger): ProviderRouter {
  const env = getEnv();

  const serps: SerpProvider[] = [
    new DnsMxProvider(),
    new CrtshProvider(),
    new DdgLiteProvider(),
    new BingHtmlProvider(),
    new SerperProvider(), // Phase G — paid tier 2; available() gated by SERPER_ENABLED + SERPER_API_KEY
    // Phase 3+: ExaProvider, TavilyProvider, PerplexityProvider
  ];

  const https: HttpProvider[] = [new DirectFetchProvider()];
  // Phase 3+: BrightDataProvider, FirecrawlProvider, OracleCrawl4aiProvider

  const llms: LLMProvider[] = [
    // Phase 3+: OpenAIProvider, OpenRouterProvider, DeepseekProvider
  ];

  // Phase F.2 — per-provider breaker tuning. The default global config
  // (5 failures / 60 s / 120 s cooldown) was tripping `direct_fetch`
  // on multi-province free-only runs because:
  //   - direct_fetch is a per-target tool (success rate depends on
  //     each upstream domain, not on direct_fetch itself), so 5
  //     consecutive flapping targets trip the breaker
  //   - once OPEN, ALL future leads in the run lose verify capability
  //     (every stage calls verifyCandidates), starving the rest of
  //     the run
  //   - direct_fetch is FREE — no cost penalty for retrying — so the
  //     breaker is over-protective for this provider
  //
  // p82 / p83 PD runs both ended with `direct_fetch` OPEN
  // (`consecutiveFailures=5`, `lastFailureKind=transport`) despite
  // healthy bing_html / D.3 retry. Loosening the per-key config so
  // direct_fetch tolerates wider bursts of transport flap, with a
  // shorter cooldown so it recovers fast when the network heals.
  // Other providers (paid SERPs, etc.) keep the strict default.
  const breaker = new CircuitBreaker();
  breaker.configure('direct_fetch', {
    failureThreshold: 15,
    windowMs: 60_000,
    cooldownMs: 30_000,
  });

  const router = new ProviderRouter(serps, https, llms, ledger, breaker);

  if (env.NODE_ENV !== 'test') {
    logger.info({ providers: router.describe() }, '[ProviderCatalog] capability surface at boot');
  }

  return router;
}
