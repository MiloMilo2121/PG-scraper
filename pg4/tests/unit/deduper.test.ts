import { describe, it, expect } from 'vitest';
import { dedupeLeads, Deduplicator } from '../../src/discovery/deduper';

describe('Deduplicator', () => {
  it('dedupes by phone digits', () => {
    const out = dedupeLeads([
      { company_name: 'A', city: 'Milano', phone: '+39 02 1234567' },
      { company_name: 'B', city: 'Milano', phone: '0212-3456-7' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('dedupes by name + city when phone differs but identity matches', () => {
    const out = dedupeLeads([
      { company_name: 'Mario Rossi', city: 'Milano', phone: '021' },
      { company_name: 'mario   rossi', city: 'milano', phone: '022' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('treats different cities as different leads', () => {
    const out = dedupeLeads([
      { company_name: 'Mario Rossi', city: 'Milano' },
      { company_name: 'Mario Rossi', city: 'Roma' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('dedupes by website host (www stripping)', () => {
    const out = dedupeLeads([
      { company_name: 'A', website: 'https://www.example.it/' },
      { company_name: 'B', website: 'http://example.it/about' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('merges fields from incoming into existing without overwriting', () => {
    const dd = new Deduplicator();
    const a = { company_name: 'A', city: 'Milano', phone: '+39021' };
    dd.add(a);
    const b = { company_name: 'A', city: 'Milano', address: 'Via X', website: 'https://a.it' };
    dd.merge(a, b);
    expect(a.address).toBe('Via X');
    expect(a.website).toBe('https://a.it');
    expect(a.phone).toBe('+39021');
  });
});
