import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('shared browser runtime boundaries', () => {
  it('keeps BrowserPool on shared-runtime imports only', () => {
    const browserPool = readSource('shared-runtime/browser/BrowserPool.ts');

    expect(browserPool).toContain("from '../security/block_classifier'");
    expect(browserPool).not.toContain("from '../../enricher/config'");
    expect(browserPool).not.toContain("from '../../enricher/core/security/block_classifier'");
  });
});
