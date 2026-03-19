import { describe, expect, it } from 'vitest';
import {
  BraveApiSearchProvider,
  DDGSearchProvider,
  JinaSearchProvider,
  SerperSearchProvider,
  TavilySearchProvider,
} from '../../src/enricher/core/discovery/search_provider';
import { buildProviderMap, SERP_PROVIDER_ORDER } from '../../src/foundation/provider_catalog';

describe('search_provider compatibility exports', () => {
  it('keeps Serper and Jina constructors available for enrichment callers', () => {
    expect(SerperSearchProvider).toBeTypeOf('function');
    expect(JinaSearchProvider).toBeTypeOf('function');
    expect(new SerperSearchProvider()).toBeInstanceOf(SerperSearchProvider);
    expect(new JinaSearchProvider()).toBeInstanceOf(JinaSearchProvider);
  });

  it('preserves existing DDG provider export', () => {
    expect(new DDGSearchProvider()).toBeInstanceOf(DDGSearchProvider);
  });

  it('exports official API providers for Brave and Tavily', () => {
    expect(new BraveApiSearchProvider()).toBeInstanceOf(BraveApiSearchProvider);
    expect(new TavilySearchProvider()).toBeInstanceOf(TavilySearchProvider);
  });

  it('routes SERP traffic through official APIs before HTML scraping', () => {
    expect(SERP_PROVIDER_ORDER.slice(0, 3)).toEqual([
      'SERPER-API-1',
      'BRAVE-API-1',
      'TAVILY-API-2',
    ]);

    const providerMap = buildProviderMap();
    expect(providerMap.has('SERPER-API-1')).toBe(true);
    expect(providerMap.has('BRAVE-API-1')).toBe(true);
    expect(providerMap.has('TAVILY-API-2')).toBe(true);
  });
});
