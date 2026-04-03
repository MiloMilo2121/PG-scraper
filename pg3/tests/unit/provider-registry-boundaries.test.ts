import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('provider registry boundaries', () => {
  it('wires the canonical registry exports through the runtime composition layer', async () => {
    const sharedCatalog = (await import('../../src/shared-runtime/routing/provider_catalog')) as Record<string, unknown>;
    const runtimeCatalog = await import('../../src/enricher/runtime/provider_catalog');
    const foundationCatalog = await import('../../src/foundation/provider_catalog');

    expect(sharedCatalog.buildProviderMap).toBeUndefined();
    expect(runtimeCatalog.buildProviderMap).toBeTypeOf('function');
    expect(foundationCatalog.buildProviderMap).toBe(runtimeCatalog.buildProviderMap);
    expect(foundationCatalog.SERP_PROVIDER_ORDER).toBe(sharedCatalog.SERP_PROVIDER_ORDER);
    expect(foundationCatalog.HTTP_PROVIDER_ORDER).toBe(sharedCatalog.HTTP_PROVIDER_ORDER);
  });

  it('keeps shared-runtime neutral, runtime composition modular, and canonical imports aligned', () => {
    const sharedCatalog = readSource('shared-runtime/routing/provider_catalog.ts');
    const costRouter = readSource('shared-runtime/routing/CostRouter.ts');
    const runtimeCatalog = readSource('enricher/runtime/provider_catalog.ts');
    const runtimeComposition = readSource('enricher/runtime/runtime_composition.ts');
    const foundationCatalog = readSource('foundation/provider_catalog.ts');
    const serpRegistry = readSource('enricher/runtime/providers/serp_provider_registry.ts');
    const httpRegistry = readSource('enricher/runtime/providers/http_provider_registry.ts');
    const llmRegistry = readSource('enricher/runtime/providers/llm_provider_registry.ts');
    const registryHelpers = readSource('enricher/runtime/providers/provider_registry_helpers.ts');

    expect(sharedCatalog).toContain('SERP_PROVIDER_ORDER');
    expect(sharedCatalog).toContain('HTTP_PROVIDER_ORDER');
    expect(sharedCatalog).not.toContain('buildProviderMap');
    expect(sharedCatalog).not.toContain("from '../core/");
    expect(sharedCatalog).not.toContain("from '../utils/");
    expect(sharedCatalog).not.toContain("from '../../enricher/");

    expect(costRouter).not.toContain("from './provider_catalog'");
    expect(costRouter).toContain('ProviderOrderByFamily');

    expect(runtimeCatalog).toContain("from '../../shared-runtime/routing/provider_adapter'");
    expect(runtimeCatalog).toContain("from './providers/serp_provider_registry'");
    expect(runtimeCatalog).toContain("from './providers/http_provider_registry'");
    expect(runtimeCatalog).toContain("from './providers/llm_provider_registry'");
    expect(runtimeCatalog).toContain('export function buildProviderMap');
    expect(runtimeCatalog).not.toContain("../core/discovery/");
    expect(runtimeCatalog).not.toContain("../utils/");
    expect(runtimeCatalog).not.toContain("from '../../foundation/provider_catalog'");

    expect(serpRegistry).toContain("family: 'SERP'");
    expect(serpRegistry).toContain("import('../../core/discovery/");
    expect(httpRegistry).toContain("family: 'PROXY_FETCH'");
    expect(httpRegistry).toContain("from './provider_registry_helpers'");
    expect(llmRegistry).toContain("family: 'LLM'");
    expect(llmRegistry).toContain("from '../../../shared-runtime/ai/LLMService'");
    expect(llmRegistry).not.toContain("from 'openai'");
    expect(registryHelpers).toContain("import('../../utils/");
    expect(runtimeComposition).toContain("from '../../shared-runtime/routing/provider_catalog'");
    expect(runtimeComposition).toContain('SERP: SERP_PROVIDER_ORDER');
    expect(runtimeComposition).toContain('PROXY_FETCH: HTTP_PROVIDER_ORDER');

    expect(foundationCatalog).toContain("from '../shared-runtime/routing/provider_catalog'");
    expect(foundationCatalog).toContain("from '../enricher/runtime/provider_catalog'");
    expect(foundationCatalog).not.toContain('/core/discovery/');
    expect(foundationCatalog).not.toContain("from '../shared-runtime/routing/provider_adapter'");
  });
});
