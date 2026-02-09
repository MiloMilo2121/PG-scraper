import { describe, expect, it } from 'vitest';
import { CompanyMatcher } from '../../src/enricher/core/discovery/company_matcher';
import { CompanyInput } from '../../src/enricher/types';

describe('CompanyMatcher', () => {
  it('returns 1.0 confidence on exact VAT match', () => {
    const company: CompanyInput = {
      company_name: 'Rossi Impianti SRL',
      city: 'Milano',
      vat_code: '12345678901',
    };

    const text = 'Rossi Impianti SRL - Contatti - Partita IVA 12345678901';
    const result = CompanyMatcher.evaluate(company, 'https://rossi-impianti.it', text, 'Rossi Impianti');

    expect(result.confidence).toBe(1);
    expect(result.signals.vatMatch).toBe(true);
  });

  it('gives high confidence on phone + name + city coherence', () => {
    const company: CompanyInput = {
      company_name: 'Fabbro Fast Srl',
      city: 'Roma',
      phone: '+39 06 12345678',
    };

    const text = `
      Fabbro Fast pronto intervento
      Siamo operativi a Roma 24 ore su 24.
      Chiama subito 06-12345678
      Contatti e assistenza.
    `;
    const result = CompanyMatcher.evaluate(company, 'https://fabbrofastroma.it', text, 'Fabbro Fast Roma');

    expect(result.signals.phoneMatch).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps low confidence when signals are weak', () => {
    const company: CompanyInput = {
      company_name: 'Officina Bianchi SRL',
      city: 'Torino',
      phone: '011998877',
    };

    const text = 'Benvenuto nel nostro blog di cucina e viaggi internazionali.';
    const result = CompanyMatcher.evaluate(company, 'https://example.com', text, 'Travel Blog');

    expect(result.confidence).toBeLessThan(0.4);
  });
});
