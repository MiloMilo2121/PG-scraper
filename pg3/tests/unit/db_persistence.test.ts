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

  it('keeps a single active enrichment row per company across reruns', () => {
    dbModule.insertCompany({
      id: 'cmp-rerun',
      company_name: 'Beta',
      city: 'Milano',
    });

    dbModule.insertEnrichmentResult({
      id: 'res-rerun-1',
      company_id: 'cmp-rerun',
      revenue: '1000',
      website_validated: 'https://beta.it',
      is_estimated_employees: false,
      data_source: 'WEBSITE',
      reason_code: 'FOUND_COMPLETE',
    });

    dbModule.insertEnrichmentResult({
      id: 'res-rerun-2',
      company_id: 'cmp-rerun',
      revenue: '2000',
      website_validated: 'https://www.beta.it',
      is_estimated_employees: false,
      data_source: 'WEBSITE',
      reason_code: 'FOUND_COMPLETE',
    });

    const rawDb = dbModule.default as any;
    const active = rawDb
      .prepare('SELECT COUNT(*) as count FROM enrichment_results WHERE company_id = ? AND deleted_at IS NULL')
      .get('cmp-rerun');
    const total = rawDb
      .prepare('SELECT COUNT(*) as count FROM enrichment_results WHERE company_id = ?')
      .get('cmp-rerun');
    const latest = dbModule.getEnrichmentResult('cmp-rerun');

    expect(active.count).toBe(1);
    expect(total.count).toBe(1);
    expect(latest?.id).toBe('res-rerun-1');
    expect(latest?.revenue).toBe('2000');
    expect(latest?.website_validated).toBe('https://www.beta.it');
  });

  it('reads latest deterministic row for legacy duplicate enrichment records', () => {
    dbModule.insertCompany({
      id: 'cmp-legacy',
      company_name: 'Gamma',
      city: 'Brescia',
    });

    const rawDb = dbModule.default as any;
    rawDb
      .prepare(`
        INSERT INTO enrichment_results
        (id, company_id, revenue, is_estimated_employees, data_source, updated_at, enriched_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `)
      .run('legacy-old', 'cmp-legacy', '10', 'LEGACY', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    rawDb
      .prepare(`
        INSERT INTO enrichment_results
        (id, company_id, revenue, is_estimated_employees, data_source, updated_at, enriched_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `)
      .run('legacy-new', 'cmp-legacy', '20', 'LEGACY', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    const latest = dbModule.getEnrichmentResult('cmp-legacy');
    expect(latest?.id).toBe('legacy-new');
    expect(latest?.revenue).toBe('20');

    const stats = dbModule.getStats();
    expect(stats.enriched).toBe(3);
    expect(stats.pending).toBe(0);

    const csvPath = path.join(tempDir, 'enriched.csv');
    dbModule.exportEnrichedToCSV(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    const gammaRows = csv.split('\n').filter((line) => line.includes('"Gamma"'));
    expect(gammaRows.length).toBe(1);
    expect(gammaRows[0]).toContain('"20"');
  });
});
