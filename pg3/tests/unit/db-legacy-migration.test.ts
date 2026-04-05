import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DB legacy migration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-db-legacy-'));
  const sqlitePath = path.join(tempDir, 'legacy.sqlite');

  let dbModule: typeof import('../../src/enricher/db');

  beforeAll(async () => {
    const legacyDb = new Database(sqlitePath);
    legacyDb.exec(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        city TEXT,
        province TEXT,
        address TEXT,
        phone TEXT,
        website TEXT,
        category TEXT,
        source TEXT DEFAULT 'CSV',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE enrichment_results (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vat TEXT,
        revenue TEXT,
        revenue_year TEXT,
        employees TEXT,
        is_estimated_employees INTEGER DEFAULT 0,
        pec TEXT,
        website_validated TEXT,
        lead_score INTEGER,
        data_source TEXT,
        enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id)
      );

      CREATE TABLE job_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        error_category TEXT,
        duration_ms INTEGER,
        attempt INTEGER DEFAULT 1,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE field_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT NOT NULL,
        source TEXT,
        trust_score INTEGER DEFAULT 0,
        run_id TEXT,
        observed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE enrichment_result_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        data_source TEXT,
        reason_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    legacyDb.close();

    process.env.SQLITE_PATH = sqlitePath;
    vi.resetModules();
    dbModule = await import('../../src/enricher/db');
    dbModule.initializeDatabase();
  });

  afterAll(() => {
    delete process.env.SQLITE_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('repairs legacy enrichment schema and keeps pending-company queries usable', () => {
    const rawDb = dbModule.default as any;
    const enrichmentColumns = rawDb.prepare('PRAGMA table_info(enrichment_results)').all() as Array<{ name: string }>;
    const companyColumns = rawDb.prepare('PRAGMA table_info(companies)').all() as Array<{ name: string }>;
    const jobLogColumns = rawDb.prepare('PRAGMA table_info(job_log)').all() as Array<{ name: string }>;

    expect(enrichmentColumns.map((column) => column.name)).toContain('updated_at');
    expect(enrichmentColumns.map((column) => column.name)).toContain('deleted_at');
    expect(companyColumns.map((column) => column.name)).toContain('deleted_at');
    expect(jobLogColumns.map((column) => column.name)).toContain('business_status');

    dbModule.insertCompany({
      id: 'legacy-1',
      company_name: 'Legacy Co',
      city: 'Verona',
    });

    const pending = dbModule.getPendingCompanies(10);
    expect(pending.map((company) => company.id)).toContain('legacy-1');
  });
});
