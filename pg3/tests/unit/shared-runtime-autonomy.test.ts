import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SHARED_RUNTIME_ROOT = path.resolve(__dirname, '../../src/shared-runtime');

function collectTypeScriptFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('shared runtime autonomy', () => {
  it('does not import enricher, scraper, or foundation internals', () => {
    const files = collectTypeScriptFiles(SHARED_RUNTIME_ROOT);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');

      expect(source, file).not.toMatch(/\bfrom\s+['"][^'"]*(?:enricher|scraper|foundation)\//);
      expect(source, file).not.toMatch(/\bimport\(\s*['"][^'"]*(?:enricher|scraper|foundation)\//);
    }
  });
});
