import type { HttpProvider, LLMProvider, SerpProvider } from '../types/providers';
import { ProviderRouter } from './provider_router';
import type { CostLedger } from '../runtime/cost_ledger';
import { getEnv } from '../config/env';
import { logger } from '../runtime/logger';

import { DirectFetchProvider } from './http/direct_fetch';
import { DnsMxProvider } from './serp/dns_mx';
import { CrtshProvider } from './serp/crtsh';
import { DdgLiteProvider } from './serp/ddg_lite';
import { BingHtmlProvider } from './serp/bing_html';

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
    // Phase 3+: SerperProvider, ExaProvider, TavilyProvider, PerplexityProvider
  ];

  const https: HttpProvider[] = [new DirectFetchProvider()];
  // Phase 3+: BrightDataProvider, FirecrawlProvider, OracleCrawl4aiProvider

  const llms: LLMProvider[] = [
    // Phase 3+: OpenAIProvider, OpenRouterProvider, DeepseekProvider
  ];

  const router = new ProviderRouter(serps, https, llms, ledger);

  if (env.NODE_ENV !== 'test') {
    logger.info({ providers: router.describe() }, '[ProviderCatalog] capability surface at boot');
  }

  return router;
}
