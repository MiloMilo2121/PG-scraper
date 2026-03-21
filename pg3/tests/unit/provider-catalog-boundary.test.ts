import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/shared-runtime/routing/provider_catalog.ts');

describe('provider catalog boundary', () => {
  it('stays neutral and does not expose concrete provider assembly', () => {
    const source = fs.readFileSync(PROVIDER_CATALOG_PATH, 'utf8');

    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/enricher\//);
    expect(source).not.toContain('buildProviderMap');
    expect(source).toContain('SERP_PROVIDER_ORDER');
    expect(source).toContain('HTTP_PROVIDER_ORDER');
  });

  it('exports the neutral routing orders only', async () => {
    const module = (await import('../../src/shared-runtime/routing/provider_catalog')) as Record<string, unknown>;

    expect(module.SERP_PROVIDER_ORDER).toBeDefined();
    expect(module.HTTP_PROVIDER_ORDER).toBeDefined();
    expect(module.buildProviderMap).toBeUndefined();
  });
});
