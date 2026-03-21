import { describe, expect, it } from 'vitest';
import { QuerySanitizer } from '../../src/foundation/QuerySanitizer';

describe('QuerySanitizer', () => {
  it('builds broader company discovery variants using piva, email domain, phone, and address hints', () => {
    const sanitizer = new QuerySanitizer();
    const variants = sanitizer.buildQueryVariants({
      company_name: 'ACME S.R.L.',
      company_name_variants: ['ACME', 'ACME S.R.L.'],
      city: 'Milano',
      provincia: 'MI',
      address: 'Via Roma 10, Milano',
      phone: '+39 02 1234567',
      email_domain: 'mail.acme.it',
      quality_score: 0.95,
    }, 'company', '12345678901');

    expect(variants.some((variant) => variant.includes('"12345678901"'))).toBe(true);
    expect(variants.some((variant) => variant.includes('site:mail.acme.it'))).toBe(true);
    expect(variants.some((variant) => variant.includes('"39021234567"'))).toBe(true);
    expect(variants.some((variant) => variant.includes('"Via Roma 10"'))).toBe(true);
    expect(variants.length).toBeLessThanOrEqual(12);
  });
});
