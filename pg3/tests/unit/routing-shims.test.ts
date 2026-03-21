import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('routing compatibility shims', () => {
  it('re-exports the shared routing and proxy contracts with build assembly owned by enricher runtime', async () => {
    const foundationCatalog = await import('../../src/foundation/provider_catalog');
    const sharedCatalog = (await import('../../src/shared-runtime/routing/provider_catalog')) as Record<string, unknown>;
    const foundationSelectors = await import('../../src/foundation/search_result_selectors');
    const sharedSelectors = await import('../../src/shared-runtime/routing/search_result_selectors');
    const foundationProxyTier = await import('../../src/foundation/network/proxy_tier_v9');
    const sharedProxyTier = await import('../../src/shared-runtime/network/proxy_tier_v9');

    expect(sharedCatalog.buildProviderMap).toBeUndefined();
    expect(foundationCatalog.buildProviderMap).toBeTypeOf('function');
    expect(foundationCatalog.SERP_PROVIDER_ORDER).toBe(sharedCatalog.SERP_PROVIDER_ORDER);
    expect(foundationCatalog.HTTP_PROVIDER_ORDER).toBe(sharedCatalog.HTTP_PROVIDER_ORDER);
    expect(foundationSelectors.pickLinkedInProfileResult).toBe(sharedSelectors.pickLinkedInProfileResult);
    expect(foundationSelectors.pickFinancialSearchResult).toBe(sharedSelectors.pickFinancialSearchResult);
    expect(foundationProxyTier.ProxyTier).toBe(sharedProxyTier.ProxyTier);
  });

  it('keeps provider adapter shim as a pure re-export', () => {
    const shimPath = path.resolve(__dirname, '../../src/foundation/provider_adapter.ts');
    const source = fs.readFileSync(shimPath, 'utf8');

    expect(source).toContain("export * from '../shared-runtime/routing/provider_adapter';");
    expect(source).not.toContain('enricher/');
  });
});
