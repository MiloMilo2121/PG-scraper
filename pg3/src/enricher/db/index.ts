/**
 * 🗄️ SQLITE DATABASE LAYER
 * Task 3: Persistent storage with WAL mode for concurrent access
 * 
 * Tables:
 * - companies: Raw input data
 * - enrichment_results: Enriched data with audit trail
 * - job_log: Processing history
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { config } from '../config';

// Use environment or default
const SQLITE_PATH = process.env.SQLITE_PATH || config.sqlitePath;

// Ensure data directory exists
const dataDir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database with WAL mode + production-safe pragmas
const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 10000');
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 30000');          // 30s wait on lock instead of immediate SQLITE_BUSY
db.pragma('wal_autocheckpoint = 1000');     // Checkpoint every 1000 pages to bound WAL growth
db.pragma('journal_size_limit = 16777216'); // 16MB max WAL size

Logger.info(`🗄️ SQLite connected: ${SQLITE_PATH} (WAL mode)`);
let schemaInitialized = false;
let statementsInitialized = false;

/**
 * 📋 Initialize database schema
 */
export function initializeDatabase(): void {
    if (schemaInitialized) {
        return;
    }

    db.exec(`
        -- 📥 Input companies (raw data from CSV)
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 📊 Enrichment results (output data)
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
            enriched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        -- 📜 Job processing log (audit trail)
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

        -- 🏷️ Indexes for fast lookups
        CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(company_name);
        CREATE INDEX IF NOT EXISTS idx_companies_city ON companies(city);
        CREATE INDEX IF NOT EXISTS idx_results_company ON enrichment_results(company_id);
        CREATE INDEX IF NOT EXISTS idx_results_vat ON enrichment_results(vat);
        CREATE INDEX IF NOT EXISTS idx_job_log_company ON job_log(company_id);
        CREATE INDEX IF NOT EXISTS idx_job_log_status ON job_log(status);
    `);

    // Lightweight migrations for existing DBs (CREATE TABLE IF NOT EXISTS won't add new columns).
    try {
        const cols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
        const names = new Set(cols.map((c) => c.name));
        const addIfMissing = (name: string, ddl: string) => {
            if (!names.has(name)) {
                db.exec(ddl);
            }
        };
        addIfMissing('zip_code', `ALTER TABLE companies ADD COLUMN zip_code TEXT`);
        addIfMissing('region', `ALTER TABLE companies ADD COLUMN region TEXT`);
        addIfMissing('vat_code', `ALTER TABLE companies ADD COLUMN vat_code TEXT`);
        addIfMissing('pg_url', `ALTER TABLE companies ADD COLUMN pg_url TEXT`);
        addIfMissing('email', `ALTER TABLE companies ADD COLUMN email TEXT`);

        // Enrichment results migrations
        const erCols = db.prepare(`PRAGMA table_info(enrichment_results)`).all() as Array<{ name: string }>;
        const erNames = new Set(erCols.map((c) => c.name));
        const addErIfMissing = (name: string, ddl: string) => {
            if (!erNames.has(name)) db.exec(ddl);
        };
        addErIfMissing('discovery_method', `ALTER TABLE enrichment_results ADD COLUMN discovery_method TEXT`);
        addErIfMissing('discovery_confidence', `ALTER TABLE enrichment_results ADD COLUMN discovery_confidence REAL`);
        addErIfMissing('reason_code', `ALTER TABLE enrichment_results ADD COLUMN reason_code TEXT`);

        // Job log migrations
        const jlCols = db.prepare(`PRAGMA table_info(job_log)`).all() as Array<{ name: string }>;
        const jlNames = new Set(jlCols.map((c) => c.name));
        const addJlIfMissing = (name: string, ddl: string) => {
            if (!jlNames.has(name)) db.exec(ddl);
        };
        addJlIfMissing('reason_code', `ALTER TABLE job_log ADD COLUMN reason_code TEXT`);
        addJlIfMissing('run_id', `ALTER TABLE job_log ADD COLUMN run_id TEXT`);
    } catch (e) {
        Logger.warn('DB migration check failed (continuing)', { error: e as Error });
    }

    schemaInitialized = true;
    initializeStatements();
    Logger.info('✅ Database schema initialized');
}

// 📦 Type Definitions
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

let insertCompanyStmt: any;
let getCompanyByIdStmt: any;
let getCompanyByNameStmt: any;
let getPendingCompaniesStmt: any;
let insertResultStmt: any;
let getResultByCompanyStmt: any;
let insertJobLogStmt: any;

function initializeStatements(): void {
    if (statementsInitialized) {
        return;
    }

    insertCompanyStmt = db.prepare(`
        INSERT OR REPLACE INTO companies
        (id, company_name, city, province, zip_code, region, address, phone, website, category, source, vat_code, pg_url, email, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    getCompanyByIdStmt = db.prepare('SELECT * FROM companies WHERE id = ?');
    getCompanyByNameStmt = db.prepare('SELECT * FROM companies WHERE company_name = ? AND city = ?');
    getPendingCompaniesStmt = db.prepare(`
        SELECT c.* FROM companies c
        LEFT JOIN enrichment_results er ON c.id = er.company_id
        WHERE er.id IS NULL
        LIMIT ?
    `);

    insertResultStmt = db.prepare(`
        INSERT OR REPLACE INTO enrichment_results
        (id, company_id, vat, revenue, revenue_year, employees, is_estimated_employees, pec, website_validated, lead_score, data_source, discovery_method, discovery_confidence, reason_code, enriched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    getResultByCompanyStmt = db.prepare('SELECT * FROM enrichment_results WHERE company_id = ?');

    insertJobLogStmt = db.prepare(`
        INSERT INTO job_log (company_id, status, error_message, error_category, reason_code, run_id, duration_ms, attempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    insertCompanyStmt.run(
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
}

export function insertCompanies(companies: Company[]): void {
    ensureReady();
    const insertMany = db.transaction((items: Company[]) => {
        for (const c of items) {
            insertCompanyStmt.run(
                c.id,
                c.company_name,
                c.city,
                c.province,
                c.zip_code,
                c.region,
                c.address,
                c.phone,
                c.website,
                c.category,
                c.source || 'CSV',
                c.vat_code,
                c.pg_url,
                c.email
            );
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
    insertResultStmt.run(
        result.id,
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

// 📊 Statistics
export function getStats(): { total: number; enriched: number; pending: number; failed: number } {
    ensureReady();
    const total = (db.prepare('SELECT COUNT(*) as count FROM companies').get() as { count: number }).count;
    const enriched = (db.prepare('SELECT COUNT(*) as count FROM enrichment_results').get() as { count: number }).count;
    const failed = (db.prepare('SELECT COUNT(DISTINCT company_id) as count FROM job_log WHERE status = ?').get('FAILED') as { count: number }).count;
    return {
        total,
        enriched,
        pending: total - enriched,
        failed,
    };
}

// 📤 Export to CSV
export function exportEnrichedToCSV(outputPath: string): void {
    ensureReady();
    const stmt = db.prepare(`
        SELECT 
            c.company_name, c.city, c.province, c.address, c.phone, c.category,
            er.vat, er.revenue, er.employees, er.pec, er.lead_score, er.data_source
        FROM companies c
        JOIN enrichment_results er ON c.id = er.company_id
        ORDER BY er.lead_score DESC
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

function escapeCsvValue(value: unknown): string {
    const raw = value == null ? '' : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
}

export default db;
