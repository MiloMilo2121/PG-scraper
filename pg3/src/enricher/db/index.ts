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

// Use environment or default
const SQLITE_PATH = process.env.SQLITE_PATH || './data/antigravity.db';

// Ensure data directory exists
const dataDir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database with WAL mode
const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 10000');
db.pragma('temp_store = MEMORY');

Logger.info(`🗄️ SQLite connected: ${SQLITE_PATH} (WAL mode)`);

/**
 * 📋 Initialize database schema
 */
export function initializeDatabase(): void {
    db.exec(`
        -- 📥 Input companies (raw data from CSV)
        CREATE TABLE IF NOT EXISTS companies (
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

    Logger.info('✅ Database schema initialized');
}

// 📦 Type Definitions
export interface Company {
    id: string;
    company_name: string;
    city?: string;
    province?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
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
}

// 📥 Company Operations
const insertCompanyStmt = db.prepare(`
    INSERT OR REPLACE INTO companies (id, company_name, city, province, address, phone, website, category, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const getCompanyByIdStmt = db.prepare('SELECT * FROM companies WHERE id = ?');
const getCompanyByNameStmt = db.prepare('SELECT * FROM companies WHERE company_name = ? AND city = ?');
const getPendingCompaniesStmt = db.prepare(`
    SELECT c.* FROM companies c
    LEFT JOIN enrichment_results er ON c.id = er.company_id
    WHERE er.id IS NULL
    LIMIT ?
`);

export function insertCompany(company: Company): void {
    insertCompanyStmt.run(
        company.id,
        company.company_name,
        company.city,
        company.province,
        company.address,
        company.phone,
        company.website,
        company.category
    );
}

export function insertCompanies(companies: Company[]): void {
    const insertMany = db.transaction((items: Company[]) => {
        for (const c of items) {
            insertCompanyStmt.run(c.id, c.company_name, c.city, c.province, c.address, c.phone, c.website, c.category);
        }
    });
    insertMany(companies);
    Logger.info(`📥 Inserted ${companies.length} companies to database`);
}

export function getCompanyById(id: string): Company | undefined {
    return getCompanyByIdStmt.get(id) as Company | undefined;
}

export function getPendingCompanies(limit: number = 100): Company[] {
    return getPendingCompaniesStmt.all(limit) as Company[];
}

// 📊 Enrichment Result Operations
const insertResultStmt = db.prepare(`
    INSERT OR REPLACE INTO enrichment_results 
    (id, company_id, vat, revenue, revenue_year, employees, is_estimated_employees, pec, website_validated, lead_score, data_source, enriched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const getResultByCompanyStmt = db.prepare('SELECT * FROM enrichment_results WHERE company_id = ?');

export function insertEnrichmentResult(result: EnrichmentResult): void {
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
        result.data_source
    );
}

export function getEnrichmentResult(companyId: string): EnrichmentResult | undefined {
    return getResultByCompanyStmt.get(companyId) as EnrichmentResult | undefined;
}

// 📜 Job Log Operations
const insertJobLogStmt = db.prepare(`
    INSERT INTO job_log (company_id, status, error_message, error_category, duration_ms, attempt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

export function logJobResult(
    companyId: string,
    status: 'SUCCESS' | 'FAILED' | 'RETRYING',
    durationMs: number,
    attempt: number,
    errorMessage?: string,
    errorCategory?: string
): void {
    insertJobLogStmt.run(companyId, status, errorMessage, errorCategory, durationMs, attempt);
}

// 📊 Statistics
export function getStats(): { total: number; enriched: number; pending: number; failed: number } {
    const total = (db.prepare('SELECT COUNT(*) as count FROM companies').get() as any).count;
    const enriched = (db.prepare('SELECT COUNT(*) as count FROM enrichment_results').get() as any).count;
    const failed = (db.prepare('SELECT COUNT(DISTINCT company_id) as count FROM job_log WHERE status = ?').get('FAILED') as any).count;
    return {
        total,
        enriched,
        pending: total - enriched,
        failed,
    };
}

// 📤 Export to CSV
export function exportEnrichedToCSV(outputPath: string): void {
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
    const lines = rows.map(row => Object.values(row as Record<string, unknown>).map(v => `"${v || ''}"`).join(','));

    fs.writeFileSync(outputPath, [headers, ...lines].join('\n'));
    Logger.info(`📤 Exported ${rows.length} enriched companies to ${outputPath}`);
}

// Initialize on import
initializeDatabase();

export default db;
