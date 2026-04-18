/**
 * 🗄️ SQLITE DATABASE LAYER
 *
 * Canonical local persistence with safer upserts and lightweight provenance history.
 * SQLite remains the local store; record replacement is avoided.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { config } from '../config';
import { DataMerger, DataSource } from '../utils/data_merger';

let db: Database.Database | null = null;
let activeSqlitePath: string | null = null;
let pragmasInitialized = false;

// Safely execute pragmas that might throw SQLITE_BUSY during concurrent startup
function safePragma(query: string) {
    let retries = 5;
    while (retries > 0) {
        try {
            getDb().pragma(query);
            return;
        } catch (err: any) {
            if (err.message && err.message.includes('database is locked') && retries > 1) {
                // Sleep for 50-200ms
                const sleepMs = 50 + Math.random() * 150;
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
                retries--;
            } else {
                throw err;
            }
        }
    }
}

let schemaInitialized = false;
let statementsInitialized = false;

function resolveSqlitePath(): string {
    return process.env.SQLITE_PATH || config.sqlitePath;
}

function ensureDataDir(sqlitePath: string): void {
    const dataDir = path.dirname(sqlitePath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function initializePragmas(): void {
    if (pragmasInitialized) {
        return;
    }

    safePragma('journal_mode = WAL');
    safePragma('synchronous = NORMAL');
    safePragma('cache_size = 10000');
    safePragma('temp_store = MEMORY');
    safePragma('busy_timeout = 60000');
    safePragma('wal_autocheckpoint = 1000');
    safePragma('journal_size_limit = 16777216');
    pragmasInitialized = true;
}

export function getDb(): Database.Database {
    const sqlitePath = resolveSqlitePath();
    if (db && activeSqlitePath === sqlitePath) {
        return db;
    }

    if (db) {
        closeDatabase();
    }

    ensureDataDir(sqlitePath);
    db = new Database(sqlitePath, { timeout: 60000 });
    activeSqlitePath = sqlitePath;
    initializePragmas();
    Logger.info(`🗄️ SQLite connected: ${sqlitePath} (WAL mode)`);
    return db;
}

export function closeDatabase(): void {
    if (db) {
        db.close();
    }

    db = null;
    activeSqlitePath = null;
    pragmasInitialized = false;
    schemaInitialized = false;
    statementsInitialized = false;
    upsertCompanyStmt = undefined;
    getCompanyByIdStmt = undefined;
    getCompanyByNameStmt = undefined;
    getPendingCompaniesStmt = undefined;
    upsertResultStmt = undefined;
    getResultByCompanyStmt = undefined;
    insertJobLogStmt = undefined;
    insertFieldEvidenceStmt = undefined;
    insertResultVersionStmt = undefined;
}

function getTableColumns(tableName: string): Set<string> {
    const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
}

function runMigrationStep(step: string, action: () => void): boolean {
    try {
        action();
        return true;
    } catch (error) {
        Logger.warn('DB migration step failed', { step, error: error as Error });
        return false;
    }
}

function addColumnIfMissing(tableName: string, columns: Set<string>, columnName: string, ddl: string): boolean {
    if (columns.has(columnName)) {
        return false;
    }

    const added = runMigrationStep(`${tableName}.${columnName}`, () => {
        getDb().exec(ddl);
    });

    if (added) {
        columns.add(columnName);
    }

    return added;
}

export function initializeDatabase(): void {
    if (schemaInitialized) {
        return;
    }

    const database = getDb();

    database.exec(`
        CREATE TABLE IF NOT EXISTS companies (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            city TEXT,
            province TEXT,
            zip_code TEXT,
            region TEXT,
            address TEXT,
            phone TEXT,
            website TEXT,
            category TEXT,
            source TEXT DEFAULT 'CSV',
            vat_code TEXT,
            pg_url TEXT,
            email TEXT,
            deleted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS enrichment_results (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            vat TEXT,
            revenue TEXT,
            revenue_year TEXT,
            employees TEXT,
            is_estimated_employees INTEGER DEFAULT 0,
            pec TEXT,
            email TEXT,
            website_validated TEXT,
            decision_maker_name TEXT,
            decision_maker_role TEXT,
            decision_maker_linkedin_url TEXT,
            decision_maker_confidence REAL,
            lead_score INTEGER,
            data_source TEXT,
            discovery_method TEXT,
            discovery_confidence REAL,
            reason_code TEXT,
            stage_outcomes_json TEXT,
            deleted_at DATETIME,
            enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        CREATE TABLE IF NOT EXISTS job_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL,
            status TEXT NOT NULL,
            business_status TEXT,
            error_message TEXT,
            error_category TEXT,
            reason_code TEXT,
            stage_outcomes_json TEXT,
            run_id TEXT,
            duration_ms INTEGER,
            attempt INTEGER DEFAULT 1,
            processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        CREATE TABLE IF NOT EXISTS field_evidence (
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

        CREATE TABLE IF NOT EXISTS enrichment_result_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            result_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            data_source TEXT,
            reason_code TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);
        CREATE INDEX IF NOT EXISTS idx_companies_city ON companies(city);
        CREATE INDEX IF NOT EXISTS idx_results_company ON enrichment_results(company_id);
        CREATE INDEX IF NOT EXISTS idx_results_vat ON enrichment_results(vat);
        CREATE INDEX IF NOT EXISTS idx_job_log_company ON job_log(company_id);
        CREATE INDEX IF NOT EXISTS idx_job_log_status ON job_log(status);
        CREATE INDEX IF NOT EXISTS idx_field_evidence_company ON field_evidence(company_id, field_name);
        CREATE INDEX IF NOT EXISTS idx_result_versions_company ON enrichment_result_versions(company_id);
    `);

    const companyColumns = getTableColumns('companies');
    addColumnIfMissing('companies', companyColumns, 'zip_code', `ALTER TABLE companies ADD COLUMN zip_code TEXT`);
    addColumnIfMissing('companies', companyColumns, 'region', `ALTER TABLE companies ADD COLUMN region TEXT`);
    addColumnIfMissing('companies', companyColumns, 'vat_code', `ALTER TABLE companies ADD COLUMN vat_code TEXT`);
    addColumnIfMissing('companies', companyColumns, 'pg_url', `ALTER TABLE companies ADD COLUMN pg_url TEXT`);
    addColumnIfMissing('companies', companyColumns, 'email', `ALTER TABLE companies ADD COLUMN email TEXT`);
    addColumnIfMissing('companies', companyColumns, 'deleted_at', `ALTER TABLE companies ADD COLUMN deleted_at DATETIME`);

    const enrichmentColumns = getTableColumns('enrichment_results');
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'discovery_method', `ALTER TABLE enrichment_results ADD COLUMN discovery_method TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'discovery_confidence', `ALTER TABLE enrichment_results ADD COLUMN discovery_confidence REAL`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'reason_code', `ALTER TABLE enrichment_results ADD COLUMN reason_code TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'email', `ALTER TABLE enrichment_results ADD COLUMN email TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'decision_maker_name', `ALTER TABLE enrichment_results ADD COLUMN decision_maker_name TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'decision_maker_role', `ALTER TABLE enrichment_results ADD COLUMN decision_maker_role TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'decision_maker_linkedin_url', `ALTER TABLE enrichment_results ADD COLUMN decision_maker_linkedin_url TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'decision_maker_confidence', `ALTER TABLE enrichment_results ADD COLUMN decision_maker_confidence REAL`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'stage_outcomes_json', `ALTER TABLE enrichment_results ADD COLUMN stage_outcomes_json TEXT`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'updated_at', `ALTER TABLE enrichment_results ADD COLUMN updated_at DATETIME`);
    addColumnIfMissing('enrichment_results', enrichmentColumns, 'deleted_at', `ALTER TABLE enrichment_results ADD COLUMN deleted_at DATETIME`);

    if (enrichmentColumns.has('updated_at')) {
        runMigrationStep('enrichment_results.updated_at_backfill', () => {
            database.exec(`
                UPDATE enrichment_results
                SET updated_at = COALESCE(updated_at, enriched_at, CURRENT_TIMESTAMP)
                WHERE updated_at IS NULL
            `);
        });
    }

    if (enrichmentColumns.has('deleted_at') && enrichmentColumns.has('updated_at')) {
        runMigrationStep('enrichment_results.soft_delete_dedupe', () => {
            database.exec(`
                WITH ranked AS (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY company_id
                            ORDER BY datetime(COALESCE(updated_at, enriched_at)) DESC,
                                     datetime(COALESCE(enriched_at, updated_at)) DESC,
                                     rowid DESC
                        ) AS rn
                    FROM enrichment_results
                    WHERE deleted_at IS NULL
                )
                UPDATE enrichment_results
                SET deleted_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
            `);
        });

        runMigrationStep('enrichment_results.active_unique_index', () => {
            database.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS ux_enrichment_results_company_active
                ON enrichment_results(company_id)
                WHERE deleted_at IS NULL
            `);
        });
    }

    const jobLogColumns = getTableColumns('job_log');
    addColumnIfMissing('job_log', jobLogColumns, 'business_status', `ALTER TABLE job_log ADD COLUMN business_status TEXT`);
    addColumnIfMissing('job_log', jobLogColumns, 'reason_code', `ALTER TABLE job_log ADD COLUMN reason_code TEXT`);
    addColumnIfMissing('job_log', jobLogColumns, 'stage_outcomes_json', `ALTER TABLE job_log ADD COLUMN stage_outcomes_json TEXT`);
    addColumnIfMissing('job_log', jobLogColumns, 'run_id', `ALTER TABLE job_log ADD COLUMN run_id TEXT`);
    if (jobLogColumns.has('business_status')) {
        runMigrationStep('job_log.business_status_index', () => {
            database.exec(`
                CREATE INDEX IF NOT EXISTS idx_job_log_business_status
                ON job_log(business_status)
            `);
        });
    }

    schemaInitialized = true;
    initializeStatements();
    Logger.info('✅ Database schema initialized');
}

export interface Company {
    id: string;
    company_name: string;
    city?: string;
    province?: string;
    zip_code?: string;
    region?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
    source?: string;
    vat_code?: string;
    pg_url?: string;
    email?: string;
}

export interface EnrichmentResult {
    id: string;
    company_id: string;
    vat?: string;
    revenue?: string;
    revenue_year?: string;
    employees?: string;
    is_estimated_employees: boolean;
    pec?: string;
    email?: string;
    website_validated?: string;
    decision_maker_name?: string;
    decision_maker_role?: string;
    decision_maker_linkedin_url?: string;
    decision_maker_confidence?: number;
    lead_score?: number;
    data_source?: string;
    discovery_method?: string;
    discovery_confidence?: number;
    reason_code?: string;
    stage_outcomes?: Record<string, unknown>;
    stage_outcomes_json?: string;
}

export interface FieldEvidence {
    entityType: 'company' | 'enrichment';
    entityId: string;
    companyId: string;
    fieldName: string;
    fieldValue: string;
    source?: string;
    trustScore: number;
    runId?: string;
}

let upsertCompanyStmt: any;
let getCompanyByIdStmt: any;
let getCompanyByNameStmt: any;
let getPendingCompaniesStmt: any;
let upsertResultStmt: any;
let getResultByCompanyStmt: any;
let insertJobLogStmt: any;
let insertFieldEvidenceStmt: any;
let insertResultVersionStmt: any;

function initializeStatements(): void {
    if (statementsInitialized) {
        return;
    }

    const database = getDb();

    upsertCompanyStmt = database.prepare(`
        INSERT INTO companies
        (id, company_name, city, province, zip_code, region, address, phone, website, category, source, vat_code, pg_url, email, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            company_name = COALESCE(NULLIF(excluded.company_name, ''), companies.company_name),
            city = COALESCE(NULLIF(excluded.city, ''), companies.city),
            province = COALESCE(NULLIF(excluded.province, ''), companies.province),
            zip_code = COALESCE(NULLIF(excluded.zip_code, ''), companies.zip_code),
            region = COALESCE(NULLIF(excluded.region, ''), companies.region),
            address = COALESCE(NULLIF(excluded.address, ''), companies.address),
            phone = COALESCE(NULLIF(excluded.phone, ''), companies.phone),
            website = COALESCE(NULLIF(excluded.website, ''), companies.website),
            category = COALESCE(NULLIF(excluded.category, ''), companies.category),
            source = COALESCE(NULLIF(excluded.source, ''), companies.source),
            vat_code = COALESCE(NULLIF(excluded.vat_code, ''), companies.vat_code),
            pg_url = COALESCE(NULLIF(excluded.pg_url, ''), companies.pg_url),
            email = COALESCE(NULLIF(excluded.email, ''), companies.email),
            deleted_at = NULL,
            updated_at = CURRENT_TIMESTAMP
    `);

    getCompanyByIdStmt = database.prepare('SELECT * FROM companies WHERE id = ?');
    getCompanyByNameStmt = database.prepare('SELECT * FROM companies WHERE company_name = ? AND city = ?');
    getPendingCompaniesStmt = database.prepare(`
        SELECT c.* FROM companies c
        LEFT JOIN enrichment_results er ON c.id = er.company_id AND er.deleted_at IS NULL
        WHERE er.id IS NULL AND c.deleted_at IS NULL
        LIMIT ?
    `);

    upsertResultStmt = database.prepare(`
        INSERT INTO enrichment_results
        (id, company_id, vat, revenue, revenue_year, employees, is_estimated_employees, pec, email, website_validated, decision_maker_name, decision_maker_role, decision_maker_linkedin_url, decision_maker_confidence, lead_score, data_source, discovery_method, discovery_confidence, reason_code, stage_outcomes_json, enriched_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(company_id) WHERE deleted_at IS NULL DO UPDATE SET
            vat = COALESCE(NULLIF(excluded.vat, ''), enrichment_results.vat),
            revenue = COALESCE(NULLIF(excluded.revenue, ''), enrichment_results.revenue),
            revenue_year = COALESCE(NULLIF(excluded.revenue_year, ''), enrichment_results.revenue_year),
            employees = COALESCE(NULLIF(excluded.employees, ''), enrichment_results.employees),
            is_estimated_employees = CASE
                WHEN NULLIF(excluded.employees, '') IS NOT NULL THEN excluded.is_estimated_employees
                ELSE enrichment_results.is_estimated_employees
            END,
            pec = COALESCE(NULLIF(excluded.pec, ''), enrichment_results.pec),
            email = COALESCE(NULLIF(excluded.email, ''), enrichment_results.email),
            website_validated = CASE
                WHEN excluded.reason_code = 'ENRICHMENT_ONLY_NO_WEBSITE' THEN NULL
                ELSE COALESCE(NULLIF(excluded.website_validated, ''), enrichment_results.website_validated)
            END,
            decision_maker_name = COALESCE(NULLIF(excluded.decision_maker_name, ''), enrichment_results.decision_maker_name),
            decision_maker_role = COALESCE(NULLIF(excluded.decision_maker_role, ''), enrichment_results.decision_maker_role),
            decision_maker_linkedin_url = COALESCE(NULLIF(excluded.decision_maker_linkedin_url, ''), enrichment_results.decision_maker_linkedin_url),
            decision_maker_confidence = COALESCE(excluded.decision_maker_confidence, enrichment_results.decision_maker_confidence),
            lead_score = COALESCE(excluded.lead_score, enrichment_results.lead_score),
            data_source = COALESCE(NULLIF(excluded.data_source, ''), enrichment_results.data_source),
            discovery_method = CASE
                WHEN excluded.reason_code = 'ENRICHMENT_ONLY_NO_WEBSITE' THEN NULL
                ELSE COALESCE(NULLIF(excluded.discovery_method, ''), enrichment_results.discovery_method)
            END,
            discovery_confidence = CASE
                WHEN excluded.reason_code = 'ENRICHMENT_ONLY_NO_WEBSITE' THEN NULL
                ELSE COALESCE(excluded.discovery_confidence, enrichment_results.discovery_confidence)
            END,
            reason_code = COALESCE(NULLIF(excluded.reason_code, ''), enrichment_results.reason_code),
            stage_outcomes_json = COALESCE(NULLIF(excluded.stage_outcomes_json, ''), enrichment_results.stage_outcomes_json),
            deleted_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id
    `);

    getResultByCompanyStmt = database.prepare(`
        SELECT *
        FROM enrichment_results
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY datetime(COALESCE(updated_at, enriched_at)) DESC, datetime(COALESCE(enriched_at, updated_at)) DESC, rowid DESC
        LIMIT 1
    `);

    insertJobLogStmt = database.prepare(`
        INSERT INTO job_log (company_id, status, business_status, error_message, error_category, reason_code, stage_outcomes_json, run_id, duration_ms, attempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertFieldEvidenceStmt = database.prepare(`
        INSERT INTO field_evidence (entity_type, entity_id, company_id, field_name, field_value, source, trust_score, run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertResultVersionStmt = database.prepare(`
        INSERT INTO enrichment_result_versions (result_id, company_id, snapshot_json, data_source, reason_code)
        VALUES (?, ?, ?, ?, ?)
    `);

    statementsInitialized = true;
}

function ensureReady(): void {
    if (!schemaInitialized) {
        throw new Error('Database not initialized. Call initializeDatabase() during application bootstrap.');
    }
    if (!statementsInitialized) {
        initializeStatements();
    }
}

export function insertCompany(company: Company): void {
    ensureReady();
    upsertCompanyStmt.run(
        company.id,
        company.company_name,
        company.city,
        company.province,
        company.zip_code,
        company.region,
        company.address,
        company.phone,
        company.website,
        company.category,
        company.source || 'CSV',
        company.vat_code,
        company.pg_url,
        company.email
    );

    recordFieldEvidence('company', company.id, company.id, company as unknown as Record<string, unknown>, company.source);
}

export function insertCompanies(companies: Company[]): void {
    ensureReady();
    const insertMany = getDb().transaction((items: Company[]) => {
        for (const company of items) {
            insertCompany(company);
        }
    });

    insertMany(companies);
    Logger.info(`📥 Inserted ${companies.length} companies to database`);
}

export function getCompanyById(id: string): Company | undefined {
    ensureReady();
    return getCompanyByIdStmt.get(id) as Company | undefined;
}

export function getPendingCompanies(limit: number = 100): Company[] {
    ensureReady();
    return getPendingCompaniesStmt.all(limit) as Company[];
}

export function insertEnrichmentResult(result: EnrichmentResult): void {
    ensureReady();
    const requestedId = typeof result.id === 'string' ? result.id.trim() : '';
    if (!requestedId) {
        throw new Error(`insertEnrichmentResult requires a non-empty id for company ${result.company_id}`);
    }

    const tx = getDb().transaction(() => {
        const stageOutcomesJson = result.stage_outcomes_json
            || (result.stage_outcomes ? JSON.stringify(result.stage_outcomes) : undefined);
        const persisted = upsertResultStmt.get(
            requestedId,
            result.company_id,
            result.vat,
            result.revenue,
            result.revenue_year,
            result.employees,
            result.is_estimated_employees ? 1 : 0,
            result.pec,
            result.email,
            result.website_validated,
            result.decision_maker_name,
            result.decision_maker_role,
            result.decision_maker_linkedin_url,
            result.decision_maker_confidence,
            result.lead_score,
            result.data_source,
            result.discovery_method,
            result.discovery_confidence,
            result.reason_code,
            stageOutcomesJson
        ) as { id: string } | undefined;
        const targetResultId = persisted?.id || requestedId;

        insertResultVersionStmt.run(
            targetResultId,
            result.company_id,
            JSON.stringify(result),
            result.data_source || null,
            result.reason_code || null
        );

        recordFieldEvidence('enrichment', targetResultId, result.company_id, result as unknown as Record<string, unknown>, result.data_source);
    });
    
    // Use an IMMEDIATE transaction to acquire the write lock immediately,
    // avoiding deadlocks when multiple workers try to upgrade from read to write lock.
    tx.immediate();
}

export function getEnrichmentResult(companyId: string): EnrichmentResult | undefined {
    ensureReady();
    const row = getResultByCompanyStmt.get(companyId) as (EnrichmentResult & { is_estimated_employees?: number | boolean }) | undefined;
    if (!row) {
        return undefined;
    }

    let stageOutcomes: Record<string, unknown> | undefined;
    if (typeof row.stage_outcomes_json === 'string' && row.stage_outcomes_json.trim()) {
        try {
            stageOutcomes = JSON.parse(row.stage_outcomes_json);
        } catch {
            stageOutcomes = undefined;
        }
    }

    return {
        ...row,
        is_estimated_employees: Boolean(row.is_estimated_employees),
        stage_outcomes: stageOutcomes,
    };
}

export function logJobResult(
    companyId: string,
    status: 'SUCCESS' | 'FAILED' | 'RETRYING',
    durationMs: number,
    attempt: number,
    errorMessage?: string,
    errorCategory?: string,
    reasonCode?: string,
    stageOutcomes?: Record<string, unknown>,
    runId?: string,
    businessStatus?: 'FOUND_COMPLETE' | 'ENRICHMENT_ONLY_NO_WEBSITE' | 'NOT_FOUND' | 'WORKER_EXCEPTION'
): void {
    ensureReady();
    insertJobLogStmt.run(
        companyId,
        status,
        businessStatus || null,
        errorMessage,
        errorCategory,
        reasonCode,
        stageOutcomes ? JSON.stringify(stageOutcomes) : null,
        runId,
        durationMs,
        attempt
    );
}

export function getStats(): {
    total: number;
    enriched: number;
    processed: number;
    pending: number;
    failed: number;
    found_complete: number;
    enrichment_only: number;
    not_found: number;
} {
    ensureReady();
    const database = getDb();
    const total = (database.prepare('SELECT COUNT(*) as count FROM companies WHERE deleted_at IS NULL').get() as { count: number }).count;
    const enriched = (database.prepare('SELECT COUNT(DISTINCT company_id) as count FROM enrichment_results WHERE deleted_at IS NULL').get() as { count: number }).count;
    const processed = (database.prepare(`
        SELECT COUNT(DISTINCT company_id) as count
        FROM job_log
        WHERE status IN ('SUCCESS', 'FAILED')
    `).get() as { count: number }).count;
    const failed = (database.prepare('SELECT COUNT(DISTINCT company_id) as count FROM job_log WHERE status = ?').get('FAILED') as { count: number }).count;
    const foundComplete = (database.prepare(`
        SELECT COUNT(DISTINCT company_id) as count
        FROM job_log
        WHERE status = 'SUCCESS' AND business_status = 'FOUND_COMPLETE'
    `).get() as { count: number }).count;
    const enrichmentOnly = (database.prepare(`
        SELECT COUNT(DISTINCT company_id) as count
        FROM job_log
        WHERE status = 'SUCCESS' AND business_status = 'ENRICHMENT_ONLY_NO_WEBSITE'
    `).get() as { count: number }).count;
    const notFound = (database.prepare(`
        SELECT COUNT(DISTINCT company_id) as count
        FROM job_log
        WHERE status = 'SUCCESS' AND business_status = 'NOT_FOUND'
    `).get() as { count: number }).count;
    return {
        total,
        enriched,
        processed,
        pending: Math.max(total - processed, 0),
        failed,
        found_complete: foundComplete,
        enrichment_only: enrichmentOnly,
        not_found: notFound,
    };
}

// Analytics breakdown by business status from job logs.
export function getOutcomeBreakdown(runId?: string): Record<string, number> {
    ensureReady();

    const rows = runId
        ? (getDb().prepare(`
            SELECT business_status, COUNT(*) AS cnt
            FROM job_log
            WHERE run_id = ? AND business_status IS NOT NULL AND business_status != ''
            GROUP BY business_status
        `).all(runId) as Array<{ business_status: string; cnt: number }>)
        : (getDb().prepare(`
            SELECT business_status, COUNT(*) AS cnt
            FROM job_log
            WHERE business_status IS NOT NULL AND business_status != ''
            GROUP BY business_status
        `).all() as Array<{ business_status: string; cnt: number }>);

    const result: Record<string, number> = {};
    for (const row of rows) {
        result[row.business_status] = row.cnt;
    }
    return result;
}

export function getTopReasonCodes(
    runId?: string,
    limit: number = 15
): Array<{ reason_code: string; count: number }> {
    ensureReady();

    const rows = runId
        ? (getDb().prepare(`
            SELECT reason_code, COUNT(*) AS cnt
            FROM job_log
            WHERE run_id = ? AND reason_code IS NOT NULL AND reason_code != ''
            GROUP BY reason_code
            ORDER BY cnt DESC
            LIMIT ?
        `).all(runId, limit) as Array<{ reason_code: string; cnt: number }>)
        : (getDb().prepare(`
            SELECT reason_code, COUNT(*) AS cnt
            FROM job_log
            WHERE reason_code IS NOT NULL AND reason_code != ''
            GROUP BY reason_code
            ORDER BY cnt DESC
            LIMIT ?
        `).all(limit) as Array<{ reason_code: string; cnt: number }>);

    return rows.map((row) => ({ reason_code: row.reason_code, count: row.cnt }));
}

export function getEnrichedFieldCoverage(): {
    total: number;
    website_rate: number;
    vat_rate: number;
    pec_rate: number;
    revenue_rate: number;
    employees_rate: number;
} {
    ensureReady();

    const row = getDb().prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN website_validated IS NOT NULL AND website_validated != '' THEN 1 ELSE 0 END) AS has_website,
            SUM(CASE WHEN vat IS NOT NULL AND vat != '' THEN 1 ELSE 0 END) AS has_vat,
            SUM(CASE WHEN pec IS NOT NULL AND pec != '' THEN 1 ELSE 0 END) AS has_pec,
            SUM(CASE WHEN revenue IS NOT NULL AND revenue != '' THEN 1 ELSE 0 END) AS has_revenue,
            SUM(CASE WHEN employees IS NOT NULL AND employees != '' THEN 1 ELSE 0 END) AS has_employees
        FROM enrichment_results
        WHERE deleted_at IS NULL
    `).get() as {
        total: number;
        has_website: number;
        has_vat: number;
        has_pec: number;
        has_revenue: number;
        has_employees: number;
    };

    const total = row.total || 0;
    if (total === 0) {
        return {
            total: 0,
            website_rate: 0,
            vat_rate: 0,
            pec_rate: 0,
            revenue_rate: 0,
            employees_rate: 0,
        };
    }

    return {
        total,
        website_rate: row.has_website / total,
        vat_rate: row.has_vat / total,
        pec_rate: row.has_pec / total,
        revenue_rate: row.has_revenue / total,
        employees_rate: row.has_employees / total,
    };
}

export function exportEnrichedToCSV(outputPath: string): void {
    ensureReady();
    const stmt = getDb().prepare(`
        SELECT
            c.company_name, c.city, c.province, c.address, c.phone, c.category,
            c.email AS input_email,
            er.vat, er.revenue, er.employees, er.is_estimated_employees, er.pec, er.email,
            er.website_validated,
            er.decision_maker_name, er.decision_maker_role, er.decision_maker_linkedin_url, er.decision_maker_confidence,
            er.lead_score, er.data_source, er.reason_code
        FROM companies c
        JOIN enrichment_results er ON er.id = (
            SELECT er2.id
            FROM enrichment_results er2
            WHERE er2.company_id = c.id AND er2.deleted_at IS NULL
            ORDER BY datetime(COALESCE(er2.updated_at, er2.enriched_at)) DESC, datetime(COALESCE(er2.enriched_at, er2.updated_at)) DESC, er2.rowid DESC
            LIMIT 1
        )
        WHERE c.deleted_at IS NULL
        ORDER BY COALESCE(er.lead_score, 0) DESC, c.company_name COLLATE NOCASE
    `);

    const rows = stmt.all();
    if (rows.length === 0) {
        Logger.warn('No enriched data to export');
        return;
    }

    const headers = Object.keys(rows[0] as Record<string, unknown>).join(',');
    const lines = rows.map((row) => Object.values(row as Record<string, unknown>).map(escapeCsvValue).join(','));

    fs.writeFileSync(outputPath, [headers, ...lines].join('\n'));
    Logger.info(`📤 Exported ${rows.length} enriched companies to ${outputPath}`);
}

function recordFieldEvidence(
    entityType: FieldEvidence['entityType'],
    entityId: string,
    companyId: string,
    values: Record<string, unknown>,
    source?: string
): void {
    const trustScore = resolveTrustScore(source);

    for (const [fieldName, fieldValue] of Object.entries(values)) {
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
            continue;
        }

        if (fieldName === 'id' || fieldName === 'company_id') {
            continue;
        }

        insertFieldEvidenceStmt.run(
            entityType,
            entityId,
            companyId,
            fieldName,
            stringifyEvidenceValue(fieldValue),
            source || null,
            trustScore,
            null
        );
    }
}

function resolveTrustScore(source?: string): number {
    if (!source) return 10;

    const canonical = source.toUpperCase();
    if (canonical in DataSource) {
        return DataMerger.getTrustScore(DataSource[canonical as keyof typeof DataSource]);
    }

    switch (canonical) {
        case 'CSV':
            return 30;
        case 'WEBSITE':
            return DataMerger.getTrustScore(DataSource.WEBSITE);
        case 'VIES':
            return DataMerger.getTrustScore(DataSource.VIES);
        case 'REGISTRY':
        case 'REGISTRO':
            return DataMerger.getTrustScore(DataSource.REGISTRY);
        case 'GOOGLE_MAPS':
        case 'MAPS':
            return DataMerger.getTrustScore(DataSource.GOOGLE_MAPS);
        case 'PAGINEGIALLE':
            return DataMerger.getTrustScore(DataSource.PAGINEGIALLE);
        case 'AI':
            return DataMerger.getTrustScore(DataSource.AI);
        default:
            return 10;
    }
}

function stringifyEvidenceValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function escapeCsvValue(value: unknown): string {
    const raw = value == null ? '' : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
}

const dbFacade = new Proxy({} as Database.Database, {
    get(_target, prop) {
        const instance = getDb();
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    },
});

export default dbFacade;
