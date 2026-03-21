import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PROVIDER_CATALOG_PATH = path.resolve(__dirname, '../../src/shared-runtime/routing/provider_catalog.ts');

describe('provider catalog boundary', () => {
  it('avoids static imports from enricher internals', () => {
    const source = fs.readFileSync(PROVIDER_CATALOG_PATH, 'utf8');

    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/enricher\//);
    expect(source).toContain("import('../../enricher/");
    expect(source).toContain('readLocalOracleFetchCostEur');
  });
});
