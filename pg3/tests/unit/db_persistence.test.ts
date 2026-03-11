import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DB persistence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-db-test-'));
  const sqlitePath = path.join(tempDir, 'test.sqlite');

  let dbModule: typeof import('../../src/enricher/db');

  beforeAll(async () => {
    process.env.SQLITE_PATH = sqlitePath;
    vi.resetModules();
    dbModule = await import('../../src/enricher/db');
    dbModule.initializeDatabase();
  });

  afterAll(() => {
    delete process.env.SQLITE_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves existing company fields when a later upsert has blanks', () => {
    dbModule.insertCompany({
      id: 'cmp-1',
      company_name: 'Acme',
      city: 'Padova',
      email: 'info@acme.it',
      website: 'https://acme.it',
    });

    dbModule.insertCompany({
      id: 'cmp-1',
      company_name: 'Acme',
      city: '',
      email: '',
    });

    const company = dbModule.getCompanyById('cmp-1');
    expect(company?.city).toBe('Padova');
    expect(company?.email).toBe('info@acme.it');
    expect(company?.website).toBe('https://acme.it');
  });

  it('records result snapshots and field evidence', () => {
    dbModule.insertEnrichmentResult({
      id: 'res-1',
      company_id: 'cmp-1',
      vat: '01114601006',
      pec: 'pec@acme.pec.it',
      is_estimated_employees: false,
      data_source: 'WEBSITE',
      reason_code: 'MATCHED_SITE',
    });

    const rawDb = dbModule.default as any;
    const versions = rawDb.prepare('SELECT COUNT(*) as count FROM enrichment_result_versions WHERE result_id = ?').get('res-1');
    const evidence = rawDb.prepare('SELECT COUNT(*) as count FROM field_evidence WHERE entity_id = ?').get('res-1');

    expect(versions.count).toBe(1);
    expect(evidence.count).toBeGreaterThan(0);
  });
});
