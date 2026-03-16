import { describe, expect, it } from 'vitest';
import { InputNormalizer } from '../../src/foundation/InputNormalizer';

describe('InputNormalizer', () => {
  it('normalizes website, VAT, and province from raw campaign rows', () => {
    const normalizer = new InputNormalizer();

    const result = normalizer.normalize({
      company_name: 'ACME S.R.L.',
      city: 'Milano (MI)',
      website: 'acme.it/contatti?utm_source=test',
      vat_code: 'IT12345678901',
    });

    expect(result.company_name).toBe('ACME S.R.L.');
    expect(result.city).toBe('Milano');
    expect(result.provincia).toBe('MI');
    expect(result.website).toBe('https://acme.it/contatti');
    expect(result.vat_code).toBe('12345678901');
    expect(result.quality_score).toBeGreaterThanOrEqual(0.85);
  });

  it('uses explicit province when present and strips province noise from company name', () => {
    const normalizer = new InputNormalizer();

    const result = normalizer.normalize({
      company_name: 'Beta Meccanica (BG)',
      city: 'Albino',
      province: 'BS',
    });

    expect(result.company_name).toBe('Beta Meccanica');
    expect(result.city).toBe('Albino');
    expect(result.provincia).toBe('BS');
  });
});
