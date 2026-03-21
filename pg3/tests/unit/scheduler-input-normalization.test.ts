import { describe, expect, it } from 'vitest';
import { createCsvLoadDiagnostics, normalizeCsvRowForScheduler } from '../../src/enricher/scheduler_csv';

describe('Scheduler CSV normalization', () => {
  it('maps common legacy headers to scheduler canonical fields', () => {
    const diagnostics = createCsvLoadDiagnostics();

    const normalized = normalizeCsvRowForScheduler(
      {
        ' Ragione Sociale ': 'ACME S.R.L.',
        citta: 'Milano',
        provincia: 'mi',
        CAP: '20100',
        regione: 'Lombardia',
        indirizzo: 'Via Roma 1',
        telefono: '02 123456',
        sito: 'https://acme.it',
        categoria: 'Officine meccaniche',
        fonte: 'legacy_csv',
        piva: 'IT12345678901',
        paginegialle_url: 'https://www.paginegialle.it/acme',
        mail: 'info@acme.it',
      },
      diagnostics
    );

    expect(normalized.company_name).toBe('ACME S.R.L.');
    expect(normalized.city).toBe('Milano');
    expect(normalized.province).toBe('MI');
    expect(normalized.zip_code).toBe('20100');
    expect(normalized.region).toBe('Lombardia');
    expect(normalized.address).toBe('Via Roma 1');
    expect(normalized.phone).toBe('02 123456');
    expect(normalized.website).toBe('https://acme.it');
    expect(normalized.category).toBe('Officine meccaniche');
    expect(normalized.source).toBe('legacy_csv');
    expect(normalized.vat_code).toBe('IT12345678901');
    expect(normalized.pg_url).toBe('https://www.paginegialle.it/acme');
    expect(normalized.email).toBe('info@acme.it');
    expect(diagnostics.aliasHits).toBeGreaterThan(0);
  });

  it('tracks unknown headers and keeps canonical values deterministic', () => {
    const diagnostics = createCsvLoadDiagnostics();

    const normalized = normalizeCsvRowForScheduler(
      {
        company_name: 'Beta SNC',
        Name: 'SHOULD_NOT_OVERRIDE',
        unknown_extra: 'foo',
        '': 'empty',
      },
      diagnostics
    );

    expect(normalized.company_name).toBe('Beta SNC');
    expect(Array.from(diagnostics.unknownHeaders)).toContain('unknown_extra');
  });
});
