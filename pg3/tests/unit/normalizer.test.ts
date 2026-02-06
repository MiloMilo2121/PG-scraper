import { describe, expect, it } from 'vitest';
import { DataNormalizer } from '../../src/enricher/utils/normalizer';

describe('DataNormalizer', () => {
  it('normalizes italian mobile phones to E.164', () => {
    const result = DataNormalizer.normalizePhone('333 1234567', 'IT');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('+393331234567');
  });

  it('rejects invalid VAT formats and accepts valid ones', () => {
    expect(DataNormalizer.validateVATFormat('01114601006')).toBe(true);
    expect(DataNormalizer.validateVATFormat('01114601007')).toBe(false);
  });

  it('detects blacklisted domains', () => {
    expect(DataNormalizer.isDomainBlacklisted('https://www.linkedin.com/company/acme')).toBe(true);
    expect(DataNormalizer.isDomainBlacklisted('https://www.acme.it')).toBe(false);
  });

  it('scores keyword relevance from text', () => {
    const result = DataNormalizer.checkKeywordRelevance('Impianti industriali e automazione robotica', [
      'automazione',
      'robotica',
      'farmaceutico',
    ]);

    expect(result.match).toBe(true);
    expect(result.matchedKeywords).toEqual(['automazione', 'robotica']);
    expect(result.score).toBeCloseTo(2 / 3, 5);
  });
});
