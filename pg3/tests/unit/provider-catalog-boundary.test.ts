import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SHARED_PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/shared-runtime/routing/provider_catalog.ts');
const RUNTIME_PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/enricher/runtime/provider_catalog.ts');
const SERP_REGISTRY_PATH = path.resolve(__dirname, '../../src/enricher/runtime/providers/serp_provider_registry.ts');
const HTTP_REGISTRY_PATH = path.resolve(__dirname, '../../src/enricher/runtime/providers/http_provider_registry.ts');
const LLM_REGISTRY_PATH = path.resolve(__dirname, '../../src/enricher/runtime/providers/llm_provider_registry.ts');

describe('provider catalog boundary', () => {
  it('stays neutral and does not expose concrete provider assembly', () => {
    const source = fs.readFileSync(SHARED_PROVIDER_CATALOG_PATH, 'utf8');

    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/enricher\//);
    expect(source).not.toContain("import('../");
    expect(source).not.toContain('buildProviderMap');
    expect(source).toContain('SERP_PROVIDER_ORDER');
    expect(source).toContain('HTTP_PROVIDER_ORDER');
  });

  it('keeps concrete provider assembly inside enricher runtime', () => {
    const source = fs.readFileSync(RUNTIME_PROVIDER_CATALOG_PATH, 'utf8');

    expect(source).toContain('export function buildProviderMap');
    expect(source).toContain("from './providers/serp_provider_registry'");
    expect(source).toContain("from './providers/http_provider_registry'");
    expect(source).toContain("from './providers/llm_provider_registry'");
    expect(source).not.toContain("../core/discovery/");
    expect(source).not.toContain("../utils/");
    expect(source).not.toContain("from 'openai'");
  });

  it('exports the neutral routing orders only', async () => {
    const module = (await import('../../src/shared-runtime/routing/provider_catalog')) as Record<string, unknown>;

    expect(module.SERP_PROVIDER_ORDER).toBeDefined();
    expect(module.HTTP_PROVIDER_ORDER).toBeDefined();
    expect(module.buildProviderMap).toBeUndefined();
  });

  it('splits provider families into dedicated registries', () => {
    const serpRegistry = fs.readFileSync(SERP_REGISTRY_PATH, 'utf8');
    const httpRegistry = fs.readFileSync(HTTP_REGISTRY_PATH, 'utf8');
    const llmRegistry = fs.readFileSync(LLM_REGISTRY_PATH, 'utf8');

    expect(serpRegistry).toContain('buildSerpProviderEntries');
    expect(serpRegistry).toContain("family: 'SERP'");
    expect(httpRegistry).toContain('buildHttpProviderEntries');
    expect(httpRegistry).toContain("family: 'PROXY_FETCH'");
    expect(llmRegistry).toContain('buildLlmProviderEntries');
    expect(llmRegistry).toContain("family: 'LLM'");
    expect(llmRegistry).toContain("from '../../../shared-runtime/ai/LLMService'");
    expect(llmRegistry).not.toContain("from 'openai'");
  });
});
