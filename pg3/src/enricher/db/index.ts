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

const SQLITE_PATH = process.env.SQLITE_PATH || config.sqlitePath;

const dataDir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 10000');
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 30000');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('journal_size_limit = 16777216');

Logger.info(`🗄️ SQLite connected: ${SQLITE_PATH} (WAL mode)`);

let schemaInitialized = false;
let statementsInitialized = false;

export function initializeDatabase(): void {
    if (schemaInitialized) {
        return;
    }

    db.exec(`
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
            website_validated TEXT,
            lead_score INTEGER,
            data_source TEXT,
            discovery_method TEXT,
            discovery_confidence REAL,
            reason_code TEXT,
            deleted_at DATETIME,
            enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        CREATE TABLE IF NOT EXISTS job_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            error_category TEXT,
            reason_code TEXT,
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

    try {
        const cols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
        const names = new Set(cols.map((col) => col.name));
        const addIfMissing = (name: string, ddl: string) => {
            if (!names.has(name)) db.exec(ddl);
        };

        addIfMissing('zip_code', `ALTER TABLE companies ADD COLUMN zip_code TEXT`);
        addIfMissing('region', `ALTER TABLE companies ADD COLUMN region TEXT`);
        addIfMissing('vat_code', `ALTER TABLE companies ADD COLUMN vat_code TEXT`);
        addIfMissing('pg_url', `ALTER TABLE companies ADD COLUMN pg_url TEXT`);
        addIfMissing('email', `ALTER TABLE companies ADD COLUMN email TEXT`);
        addIfMissing('deleted_at', `ALTER TABLE companies ADD COLUMN deleted_at DATETIME`);

        const erCols = db.prepare(`PRAGMA table_info(enrichment_results)`).all() as Array<{ name: string }>;
        const erNames = new Set(erCols.map((col) => col.name));
        const addErIfMissing = (name: string, ddl: string) => {
            if (!erNames.has(name)) db.exec(ddl);
        };

        addErIfMissing('discovery_method', `ALTER TABLE enrichment_results ADD COLUMN discovery_method TEXT`);
        addErIfMissing('discovery_confidence', `ALTER TABLE enrichment_results ADD COLUMN discovery_confidence REAL`);
        addErIfMissing('reason_code', `ALTER TABLE enrichment_results ADD COLUMN reason_code TEXT`);
        addErIfMissing('updated_at', `ALTER TABLE enrichment_results ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
        addErIfMissing('deleted_at', `ALTER TABLE enrichment_results ADD COLUMN deleted_at DATETIME`);

        const jlCols = db.prepare(`PRAGMA table_info(job_log)`).all() as Array<{ name: string }>;
        const jlNames = new Set(jlCols.map((col) => col.name));
        const addJlIfMissing = (name: string, ddl: string) => {
            if (!jlNames.has(name)) db.exec(ddl);
        };

        addJlIfMissing('reason_code', `ALTER TABLE job_log ADD COLUMN reason_code TEXT`);
        addJlIfMissing('run_id', `ALTER TABLE job_log ADD COLUMN run_id TEXT`);
    } catch (error) {
        Logger.warn('DB migration check failed (continuing)', { error: error as Error });
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
    website_validated?: string;
    lead_score?: number;
    data_source?: string;
    discovery_method?: string;
    discovery_confidence?: number;
    reason_code?: string;
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
let getActiveResultIdByCompanyStmt: any;
let softDeleteOtherActiveResultsStmt: any;
let getResultByCompanyStmt: any;
let insertJobLogStmt: any;
let insertFieldEvidenceStmt: any;
let insertResultVersionStmt: any;

function initializeStatements(): void {
    if (statementsInitialized) {
        return;
    }

    upsertCompanyStmt = db.prepare(`
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

    getCompanyByIdStmt = db.prepare('SELECT * FROM companies WHERE id = ?');
    getCompanyByNameStmt = db.prepare('SELECT * FROM companies WHERE company_name = ? AND city = ?');
    getPendingCompaniesStmt = db.prepare(`
        SELECT c.* FROM companies c
        LEFT JOIN enrichment_results er ON c.id = er.company_id AND er.deleted_at IS NULL
        WHERE er.id IS NULL AND c.deleted_at IS NULL
        LIMIT ?
    `);

    upsertResultStmt = db.prepare(`
        INSERT INTO enrichment_results
        (id, company_id, vat, revenue, revenue_year, employees, is_estimated_employees, pec, website_validated, lead_score, data_source, discovery_method, discovery_confidence, reason_code, enriched_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            company_id = COALESCE(NULLIF(excluded.company_id, ''), enrichment_results.company_id),
            vat = COALESCE(NULLIF(excluded.vat, ''), enrichment_results.vat),
            revenue = COALESCE(NULLIF(excluded.revenue, ''), enrichment_results.revenue),
            revenue_year = COALESCE(NULLIF(excluded.revenue_year, ''), enrichment_results.revenue_year),
            employees = COALESCE(NULLIF(excluded.employees, ''), enrichment_results.employees),
            is_estimated_employees = COALESCE(excluded.is_estimated_employees, enrichment_results.is_estimated_employees),
            pec = COALESCE(NULLIF(excluded.pec, ''), enrichment_results.pec),
            website_validated = COALESCE(NULLIF(excluded.website_validated, ''), enrichment_results.website_validated),
            lead_score = COALESCE(excluded.lead_score, enrichment_results.lead_score),
            data_source = COALESCE(NULLIF(excluded.data_source, ''), enrichment_results.data_source),
            discovery_method = COALESCE(NULLIF(excluded.discovery_method, ''), enrichment_results.discovery_method),
            discovery_confidence = COALESCE(excluded.discovery_confidence, enrichment_results.discovery_confidence),
            reason_code = COALESCE(NULLIF(excluded.reason_code, ''), enrichment_results.reason_code),
            deleted_at = NULL,
            updated_at = CURRENT_TIMESTAMP
    `);

    getActiveResultIdByCompanyStmt = db.prepare(`
        SELECT id
        FROM enrichment_results
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY datetime(COALESCE(updated_at, enriched_at)) DESC, datetime(COALESCE(enriched_at, updated_at)) DESC, rowid DESC
        LIMIT 1
    `);

    softDeleteOtherActiveResultsStmt = db.prepare(`
        UPDATE enrichment_results
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE company_id = ? AND id <> ? AND deleted_at IS NULL
    `);

    getResultByCompanyStmt = db.prepare(`
        SELECT *
        FROM enrichment_results
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY datetime(COALESCE(updated_at, enriched_at)) DESC, datetime(COALESCE(enriched_at, updated_at)) DESC, rowid DESC
        LIMIT 1
    `);

    insertJobLogStmt = db.prepare(`
        INSERT INTO job_log (company_id, status, error_message, error_category, reason_code, run_id, duration_ms, attempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertFieldEvidenceStmt = db.prepare(`
        INSERT INTO field_evidence (entity_type, entity_id, company_id, field_name, field_value, source, trust_score, run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertResultVersionStmt = db.prepare(`
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
    const insertMany = db.transaction((items: Company[]) => {
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
    const existing = getActiveResultIdByCompanyStmt.get(result.company_id) as { id: string } | undefined;
    const requestedId = typeof result.id === 'string' ? result.id.trim() : '';
    const targetResultId = existing?.id || requestedId;
    if (!targetResultId) {
        throw new Error(`insertEnrichmentResult requires a non-empty id for company ${result.company_id}`);
    }

    upsertResultStmt.run(
        targetResultId,
        result.company_id,
        result.vat,
        result.revenue,
        result.revenue_year,
        result.employees,
        result.is_estimated_employees ? 1 : 0,
        result.pec,
        result.website_validated,
        result.lead_score,
        result.data_source,
        result.discovery_method,
        result.discovery_confidence,
        result.reason_code
    );

    // Keep exactly one active current row per company.
    softDeleteOtherActiveResultsStmt.run(result.company_id, targetResultId);

    insertResultVersionStmt.run(
        targetResultId,
        result.company_id,
        JSON.stringify(result),
        result.data_source || null,
        result.reason_code || null
    );

    recordFieldEvidence('enrichment', targetResultId, result.company_id, result as unknown as Record<string, unknown>, result.data_source);
}

export function getEnrichmentResult(companyId: string): EnrichmentResult | undefined {
    ensureReady();
    return getResultByCompanyStmt.get(companyId) as EnrichmentResult | undefined;
}

export function logJobResult(
    companyId: string,
    status: 'SUCCESS' | 'FAILED' | 'RETRYING',
    durationMs: number,
    attempt: number,
    errorMessage?: string,
    errorCategory?: string,
    reasonCode?: string,
    runId?: string
): void {
    ensureReady();
    insertJobLogStmt.run(companyId, status, errorMessage, errorCategory, reasonCode, runId, durationMs, attempt);
}

export function getStats(): { total: number; enriched: number; pending: number; failed: number } {
    ensureReady();
    const total = (db.prepare('SELECT COUNT(*) as count FROM companies WHERE deleted_at IS NULL').get() as { count: number }).count;
    const enriched = (db.prepare('SELECT COUNT(DISTINCT company_id) as count FROM enrichment_results WHERE deleted_at IS NULL').get() as { count: number }).count;
    const failed = (db.prepare('SELECT COUNT(DISTINCT company_id) as count FROM job_log WHERE status = ?').get('FAILED') as { count: number }).count;
    return {
        total,
        enriched,
        pending: Math.max(total - enriched, 0),
        failed,
    };
}

export function exportEnrichedToCSV(outputPath: string): void {
    ensureReady();
    const stmt = db.prepare(`
        SELECT
            c.company_name, c.city, c.province, c.address, c.phone, c.category,
            er.vat, er.revenue, er.employees, er.pec, er.lead_score, er.data_source
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

export default db;
