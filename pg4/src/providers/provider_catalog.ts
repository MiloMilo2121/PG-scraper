import type { HttpProvider, LLMProvider, SerpProvider } from '../types/providers';
import { ProviderRouter } from './provider_router';
import type { CostLedger } from '../runtime/cost_ledger';
import { getEnv } from '../config/env';
import { logger } from '../runtime/logger';

import { DirectFetchProvider } from './http/direct_fetch';

/**
 * The provider registry. Adds providers in tier order. Missing API keys are
 * tolerated — the provider is still listed but `available()` returns false
 * and the router skips it.
 *
 * In Phase 1 only `direct_fetch` is wired (HTTP tier 0). Phase 2 wires DNS/MX
 * + crt.sh + DDG-lite (free SERP). Phase 3 wires paid providers behind their
 * feature flags.
 */
export function buildProviderCatalog(ledger: CostLedger): ProviderRouter {
  const env = getEnv();

  const serps: SerpProvider[] = [
    // Phase 2 will add: DnsMxProvider, CrtshProvider, DdgLiteProvider, BingHtmlProvider
    // Phase 3 will add: SerperProvider, ExaProvider, TavilyProvider, PerplexityProvider
  ];

  const https: HttpProvider[] = [new DirectFetchProvider()];
  // Phase 3: BrightDataProvider, FirecrawlProvider, OracleCrawl4aiProvider

  const llms: LLMProvider[] = [
    // Phase 3: OpenAIProvider, OpenRouterProvider, DeepseekProvider
  ];

  const router = new ProviderRouter(serps, https, llms, ledger);

  if (env.NODE_ENV !== 'test') {
    logger.info({ providers: router.describe() }, '[ProviderCatalog] capability surface at boot');
  }

  return router;
}
