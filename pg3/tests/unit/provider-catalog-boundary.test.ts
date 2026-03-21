import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SHARED_PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/shared-runtime/routing/provider_catalog.ts');
const RUNTIME_PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/enricher/runtime/provider_catalog.ts');

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
    expect(source).toContain("from '../../shared-runtime/routing/provider_adapter'");
    expect(source).not.toContain("from '../../shared-runtime/routing/provider_catalog'");
    expect(source).toContain("import('../core/discovery/");
    expect(source).toContain("import('../utils/");
  });

  it('exports the neutral routing orders only', async () => {
    const module = (await import('../../src/shared-runtime/routing/provider_catalog')) as Record<string, unknown>;

    expect(module.SERP_PROVIDER_ORDER).toBeDefined();
    expect(module.HTTP_PROVIDER_ORDER).toBeDefined();
    expect(module.buildProviderMap).toBeUndefined();
  });
});
