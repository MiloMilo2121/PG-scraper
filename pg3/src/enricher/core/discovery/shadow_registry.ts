import Database from 'better-sqlite3';
import * as fs from 'fs';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';

export interface RegistryRecord {
    piva: string;
    company_name: string;
    confidence: number;
}

/**
 * 🕵️‍♂️ SHADOW REGISTRY (OMEGA 6.2-U)
 * Handles zero-cost local database lookups for known companies via exact match or FTS.
 * Prevents wasteful external requests for entities we already hold in the registry.
 */
export class ShadowRegistry {
    private db: Database.Database | null = null;
    private isHealthy = false;

    // By default mounts a registry.db if present
    constructor(dbPath: string = './data/registry.db') {
        try {
            if (fs.existsSync(dbPath)) {
                // Open in readonly mode to prevent locking issues across multiple processes
                this.db = new Database(dbPath, { readonly: true });
                this.isHealthy = true;
                Logger.info(`[ShadowRegistry] Successfully mounted local registry from ${dbPath}`);
            } else {
                Logger.warn(`[ShadowRegistry] Database file not found at ${dbPath}. Lookups will safely return null.`);
            }
        } catch (err) {
            Logger.error('[ShadowRegistry] Failed to mount local SQLite registry.', { error: err as Error });
        }
    }

    /**
     * Attempts to find a company in the local shadow registry using exact match or FTS.
     * @param company The company details to search for.
     */
    public async find(company: CompanyInput): Promise<RegistryRecord | null> {
        if (!this.isHealthy || !this.db) return null;

        try {
            // Normalize inputs
            const inputCity = (company.city || '').toLowerCase().trim();
            const inputProv = (company.province || '').toLowerCase().trim();

            // Build simple variants (e.g., stripping SPA/SRL)
            const cleanName = company.company_name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const variants = [company.company_name, cleanName];

            // 1. Exact Name + Location Match
            const stmt = this.db.prepare(`
                SELECT piva, ragione_sociale 
                FROM companies 
                WHERE (LOWER(ragione_sociale) = ? OR LOWER(normalized_name) = ?) 
                AND (LOWER(provincia) = ? OR LOWER(citta) = ?)
                LIMIT 1
            `);

            for (const variant of variants) {
                const normVariant = variant.toLowerCase().replace(/[^a-z0-9]/g, '');
                const result = stmt.get(variant.toLowerCase(), normVariant, inputProv, inputCity) as { piva: string, ragione_sociale: string } | undefined;

                if (result) {
                    return {
                        piva: result.piva,
                        company_name: result.ragione_sociale,
                        confidence: 0.90 // Extremely high, verified registry match
                    };
                }
            }

            // 2. Fallback: Levenshtein/Fuzzy Search using FTS5 (if configured)
            // Warning: requires companies_fts virtual table to be present
            const ftsStmt = this.db.prepare(`
                SELECT piva, ragione_sociale 
                FROM companies_fts 
                WHERE companies_fts MATCH ? 
                LIMIT 5
            `);

            const baseName = cleanName;
            const query = `"${baseName}" AND "${inputCity || inputProv || ''}"`;

            const matches = ftsStmt.all(query) as { piva: string, ragione_sociale: string }[];
            if (matches.length > 0) {
                return {
                    piva: matches[0].piva,
                    company_name: matches[0].ragione_sociale,
                    confidence: 0.80 // Lower confidence because it's a fuzzy text search
                };
            }

            return null;

        } catch (err: any) {
            // Quiet fail or log specific errors like missing table
            if (err.message && err.message.includes('no such table')) {
                // Table missing, handled gracefully
                this.isHealthy = false;
                Logger.warn(`[ShadowRegistry] Lookup failed (Missing table). Disabling feature.`);
            } else {
                Logger.warn(`[ShadowRegistry] Lookup failed: ${err.message}`);
            }
            return null;
        }
    }

    public getStatus(): boolean {
        return this.isHealthy;
    }
}
