import { describe, expect, it } from 'vitest';
import {
  DDGSearchProvider,
  ExaSearchProvider,

  SerperSearchProvider,
  TavilySearchProvider,
} from '../../src/enricher/core/discovery/search_provider';
import { buildProviderMap } from '../../src/enricher/runtime/provider_catalog';
import { SERP_PROVIDER_ORDER } from '../../src/shared-runtime/routing/provider_catalog';

describe('search_provider compatibility exports', () => {
  it('keeps Serper constructor available for enrichment callers', () => {
    expect(SerperSearchProvider).toBeTypeOf('function');
    expect(new SerperSearchProvider()).toBeInstanceOf(SerperSearchProvider);
  });

  it('preserves existing DDG provider export', () => {
    expect(new DDGSearchProvider()).toBeInstanceOf(DDGSearchProvider);
  });

  it('exports official API providers for Tavily and Exa', () => {
    expect(new TavilySearchProvider()).toBeInstanceOf(TavilySearchProvider);
    expect(new ExaSearchProvider()).toBeInstanceOf(ExaSearchProvider);
  });

  it('routes SERP traffic through free-first providers before paid APIs', () => {
    expect(SERP_PROVIDER_ORDER.slice(0, 5)).toEqual([
      'DNS-MX-MINING-0',
      'CRTSH-API-1',
      'DDG-LITE-1',
      'BING-HTML-1',
      'SEARXNG-NET-1',
    ]);

    const providerMap = buildProviderMap();
    expect(providerMap.has('SERPER-API-1')).toBe(true);
    expect(providerMap.has('EXA-API-2')).toBe(true);
    expect(providerMap.has('TAVILY-API-2')).toBe(true);
    expect(providerMap.get('SERPER-API-1')?.family).toBe('SERP');
  });
});
