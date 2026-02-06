import { describe, expect, it } from 'vitest';
import { SmartDeduplicator } from '../../src/enricher/core/discovery/smart_deduplicator';
import { CompanyInput } from '../../src/enricher/types';

describe('SmartDeduplicator', () => {
  it('detects duplicate by VAT', () => {
    const d = new SmartDeduplicator();
    const existing: CompanyInput = { company_name: 'Alpha SRL', city: 'Milano', vat_code: '12345678901' };
    d.add(existing);

    const duplicate: CompanyInput = { company_name: 'Alpha Nuova', city: 'Milano', piva: '12345678901' };
    expect(d.checkDuplicate(duplicate)).toBe(existing);
  });

  it('detects duplicate by normalized phone', () => {
    const d = new SmartDeduplicator();
    const existing: CompanyInput = { company_name: 'Beta SRL', city: 'Brescia', phone: '+39 333 111 2222' };
    d.add(existing);

    const duplicate: CompanyInput = { company_name: 'Beta SRL', city: 'Brescia', phone: '333-111-2222' };
    expect(d.checkDuplicate(duplicate)).toBe(existing);
  });

  it('detects duplicate by normalized name+city', () => {
    const d = new SmartDeduplicator();
    const existing: CompanyInput = { company_name: 'Gamma S.R.L.', city: 'Verona' };
    d.add(existing);

    const duplicate: CompanyInput = { company_name: 'gamma srl', city: 'verona' };
    expect(d.checkDuplicate(duplicate)).toBe(existing);
  });

  it('returns null for new company', () => {
    const d = new SmartDeduplicator();
    d.add({ company_name: 'Delta SRL', city: 'Padova', vat_code: '11111111111' });

    const fresh: CompanyInput = { company_name: 'Epsilon SRL', city: 'Padova', vat_code: '22222222222' };
    expect(d.checkDuplicate(fresh)).toBeNull();
  });
});
