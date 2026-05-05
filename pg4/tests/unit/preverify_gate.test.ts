import { describe, it, expect } from 'vitest';
import { PreVerifyGate } from '../../src/discovery/website/preverify_gate';
import { normalizeLead } from '../../src/discovery/input_normalizer';

describe('PreVerifyGate', () => {
  it('VERIFIED when P.IVA digits appear in body', () => {
    const lead = normalizeLead({ company_name: 'Acme', city: 'Milano', vat_code: '12345678901' });
    const html =
      '<html><head><title>Acme</title></head><body>Acme è una società italiana. P.IVA 12345678901, sede legale via Roma 1, Milano. Tutti i diritti riservati.</body></html>';
    const r = PreVerifyGate.check('https://acme.it', html, lead);
    expect(r.status).toBe('VERIFIED');
    expect(r.evidence).toBe('piva_match');
  });

  it('VERIFIED_SEMANTIC when name tokens match in body+title with location anchor', () => {
    const lead = normalizeLead({ company_name: 'Beauty Center Verona', city: 'Verona' });
    const html = '<html><head><title>Beauty Center Verona — il tuo centro estetico</title></head><body>Beauty Center Verona offre trattamenti estetici a Verona</body></html>';
    const r = PreVerifyGate.check('https://beauty-verona.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
  });

  it('REJECTED when no signals match', () => {
    const lead = normalizeLead({ company_name: 'Acme SRL', city: 'Milano', vat_code: '12345678901' });
    const html = '<html><body>Welcome to a totally unrelated site</body></html>';
    const r = PreVerifyGate.check('https://random.com', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('REJECTED for empty html', () => {
    const lead = normalizeLead({ company_name: 'A', city: 'B' });
    expect(PreVerifyGate.check('https://x.it', '', lead).status).toBe('REJECTED');
  });
});
