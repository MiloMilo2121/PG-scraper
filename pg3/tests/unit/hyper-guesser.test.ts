import { describe, expect, it } from 'vitest';
import { HyperGuesser } from '../../src/enricher/core/discovery/hyper_guesser_v2';

describe('HyperGuesser', () => {
  it('generates normalized company domains and keeps bounded output', () => {
    const domains = HyperGuesser.generate('Rossi Impianti S.R.L.', 'Milano', 'MI', 'Idraulico');

    expect(domains.length).toBeGreaterThan(0);
    expect(domains.length).toBeLessThanOrEqual(80);
    expect(domains.some((d) => d.includes('rossiimpianti.it'))).toBe(true);
  });

  it('includes city/category enriched combinations for better recall', () => {
    const domains = HyperGuesser.generate('Fabbro Fast', 'Roma', 'RM', 'Fabbro');

    expect(domains.some((d) => d.includes('fabbrofastroma.it') || d.includes('fabbro-fast-roma.it'))).toBe(true);
  });
});
