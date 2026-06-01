import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseFatturatoItaliaPage } from '../../src/enrichment/financial/fatturato_italia_parser';

// Local SYNTHETIC fixtures — no live network, no real scraped data.
const fixDir = path.join(__dirname, '../fixtures/financial');
const read = (f: string) => fs.readFileSync(path.join(fixDir, f), 'utf8');

describe('parseFatturatoItaliaPage — chart-var page', () => {
  const r = parseFatturatoItaliaPage(read('fatturato_company_chart.html'), 'https://www.fatturatoitalia.it/esempio-spa-01654010345');

  it('extracts the latest revenue + year from the JS chart series', () => {
    expect(r.revenue_amount).toBe(40_503_424_402);
    expect(r.revenue_year).toBe('2023');
    expect(r.revenue).toBe('€ 40.503.424.402');
  });
  it('extracts utile and full 5-year history', () => {
    expect(r.utile).toBe(1_200_000_000);
    expect(r.history).toHaveLength(5);
    expect(r.history[0]).toMatchObject({ year: 2023, fatturato: 40_503_424_402 });
  });
  it('extracts company name, checksum-valid VAT and employees', () => {
    expect(r.company_name).toBe('ESEMPIO SPA');
    expect(r.vat_code).toBe('01654010345');
    expect(r.employees).toBe('8200');
  });
  it('assigns high confidence when chart data is present', () => {
    expect(r.confidence).toBe(0.9);
    expect(r.source_url).toContain('fatturatoitalia.it');
  });
});

describe('parseFatturatoItaliaPage — grid fallback page', () => {
  const r = parseFatturatoItaliaPage(read('fatturato_company_grid.html'));

  it('picks the most recent fatturato from the label/value grid', () => {
    expect(r.revenue_amount).toBe(1_500_000);
    expect(r.revenue_year).toBe('2022');
  });
  it('reads utile, employees, name and VAT from the grid', () => {
    expect(r.utile).toBe(120_000);
    expect(r.employees).toBe('25');
    expect(r.company_name).toBe('ACME SRL');
    expect(r.vat_code).toBe('00159560366');
  });
  it('assigns medium confidence for grid-only revenue', () => {
    expect(r.confidence).toBe(0.75);
    expect(r.history).toHaveLength(0);
  });
});

describe('parseFatturatoItaliaPage — company without bilancio', () => {
  const r = parseFatturatoItaliaPage(read('fatturato_no_data.html'));

  it('finds the entity but no revenue', () => {
    expect(r.company_name).toBe('BETA SNC');
    expect(r.vat_code).toBe('00159560366');
    expect(r.revenue_amount).toBeUndefined();
    expect(r.revenue).toBeUndefined();
  });
  it('assigns low confidence (entity only, no financials)', () => {
    expect(r.confidence).toBe(0.4);
  });
});

describe('parseFatturatoItaliaPage — guards', () => {
  it('returns an empty, zero-confidence result for empty/nullish html', () => {
    expect(parseFatturatoItaliaPage('')).toMatchObject({ confidence: 0, history: [] });
    expect(parseFatturatoItaliaPage(undefined)).toMatchObject({ confidence: 0, history: [] });
  });
  it('returns zero confidence for an unrelated page', () => {
    const r = parseFatturatoItaliaPage('<html><body><p>pagina non trovata</p></body></html>');
    expect(r.confidence).toBe(0);
    expect(r.revenue_amount).toBeUndefined();
  });
});
