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

  // =========================================================================
  // NEW REGRESSION TESTS for 80%+ Discovery Rate Fixes
  // =========================================================================

  it('matches company name as substring in compound text', () => {
    const company: CompanyInput = {
      company_name: 'Rossi Impianti SRL',
      city: 'Milano',
    };

    // The name tokens appear as part of larger words (e.g., "rossiimpianti" in URL text)
    const text = 'benvenuti nel sito di rossiimpianti dove troverete i migliori servizi per la vostra casa a milano';
    const coverage = CompanyMatcher.nameCoverage(company.company_name, text);

    // With substring fallback, both "rossi" (5 chars) and "impianti" (8 chars) should match
    expect(coverage).toBeGreaterThanOrEqual(0.5);
  });

  it('does not hard-cap confidence when domain strongly matches', () => {
    const company: CompanyInput = {
      company_name: 'Pavireflex SRL',
      city: 'Brescia',
    };

    // Domain matches perfectly, but name doesn't appear with word boundaries in text
    const text = 'soluzioni per pavimenti e rivestimenti dal 1990 a brescia contatti chi siamo';
    const result = CompanyMatcher.evaluate(company, 'https://pavireflex.it', text, 'Home');

    // Previously this would be capped at 0.35 because nameCoverage < 0.4
    // Now domainCoverage >= 0.5 prevents the hard cap
    expect(result.confidence).toBeGreaterThan(0.35);
    expect(result.signals.domainCoverage).toBeGreaterThanOrEqual(0.5);
  });

  it('supports 2-char brand tokens', () => {
    const tokens = CompanyMatcher.tokenizeCompanyName('AB Meccanica SRL');

    // "AB" (2 chars) should be kept, "meccanica" (9 chars) should be kept
    expect(tokens).toContain('ab');
    expect(tokens).toContain('meccanica');
  });

  it('gives full domainCoverage for short brand names', () => {
    const company: CompanyInput = {
      company_name: 'MCM SRL',
      city: 'Milano',
    };

    const result = CompanyMatcher.evaluate(company, 'https://mcm-srl.it', '', '');

    // "mcm" is 3 chars -> should now match in domain (lowered from 5)
    expect(result.signals.domainCoverage).toBeGreaterThanOrEqual(0.5);
  });

  it('applies synergy bonus when domain and name both match', () => {
    const company: CompanyInput = {
      company_name: 'Tecno Service SRL',
      city: 'Napoli',
    };

    // Strong domain match + strong name match in text
    const text = 'tecno service offre assistenza tecnica professionale a napoli e provincia. contatti e servizi.';
    const result = CompanyMatcher.evaluate(company, 'https://tecnoservice.it', text, 'Tecno Service');

    // domainCoverage >= 0.8, nameCoverage >= 0.4 -> synergy bonus should fire
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
