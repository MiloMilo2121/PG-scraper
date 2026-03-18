import { describe, expect, it } from 'vitest';
import {
  DDGSearchProvider,
  JinaSearchProvider,
  SerperSearchProvider,
} from '../../src/enricher/core/discovery/search_provider';

describe('search_provider compatibility exports', () => {
  it('keeps Serper and Jina constructors available for enrichment callers', () => {
    expect(SerperSearchProvider).toBeTypeOf('function');
    expect(JinaSearchProvider).toBeTypeOf('function');
    expect(new SerperSearchProvider()).toBeInstanceOf(SerperSearchProvider);
    expect(new JinaSearchProvider()).toBeInstanceOf(JinaSearchProvider);
  });

  it('preserves existing DDG provider export', () => {
    expect(new DDGSearchProvider()).toBeInstanceOf(DDGSearchProvider);
  });
});
