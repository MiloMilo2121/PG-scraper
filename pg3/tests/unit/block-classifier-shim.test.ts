import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('block classifier compatibility shim', () => {
  it('re-exports the shared block classifier contract', async () => {
    const enricherBlockClassifier = await import('../../src/enricher/core/security/block_classifier');
    const sharedBlockClassifier = await import('../../src/shared-runtime/security/block_classifier');

    expect(enricherBlockClassifier.BlockClassifier).toBe(sharedBlockClassifier.BlockClassifier);
    expect(enricherBlockClassifier.BlockType).toBe(sharedBlockClassifier.BlockType);
    expect(enricherBlockClassifier.BlockType.NONE).toBe(sharedBlockClassifier.BlockType.NONE);
    expect(enricherBlockClassifier.BlockType.CAPTCHA).toBe(sharedBlockClassifier.BlockType.CAPTCHA);
  });

  it('keeps the enricher block classifier file as a pure re-export', () => {
    const shimPath = path.resolve(__dirname, '../../src/enricher/core/security/block_classifier.ts');
    const source = fs.readFileSync(shimPath, 'utf8');

    expect(source).toBe("export * from '../../../shared-runtime/security/block_classifier';\n");
  });
});
