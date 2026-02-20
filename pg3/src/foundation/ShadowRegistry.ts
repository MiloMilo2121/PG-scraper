import Database from 'better-sqlite3';
import { NormalizedInput } from './InputNormalizer';
import * as fs from 'fs';

export interface RegistryRecord {
    piva: string;
    ragione_sociale: string;
    confidence: number;
}

export class ShadowRegistry {
    private db: Database.Database | null = null;
    private isHealthy = false;

    constructor(dbPath: string) {
        try {
            if (fs.existsSync(dbPath)) {
                // Open in readonly mode to prevent locking issues across multiple processes
                this.db = new Database(dbPath, { readonly: true });
                this.isHealthy = true;
            } else {
                console.warn(`[ShadowRegistry] Database file not found at ${dbPath}. Lookups will safely return null.`);
            }
        } catch (err) {
            console.error('[ShadowRegistry] Failed to mount local SQLite registry.', err);
        }
    }

    public async find(input: NormalizedInput): Promise<RegistryRecord | null> {
        if (!this.isHealthy || !this.db) return null;

        try {
            // First pass: try to match P.IVA if one was passed in via CSV somehow (rare but possible)
            // (Assuming InputNormalizer didn't extract it, but if we had a PIVA col we could check it here)

            // Second pass: try company name variants
            const stmt = this.db.prepare(`
                SELECT piva, ragione_sociale 
                FROM companies 
                WHERE (ragione_sociale = ? OR normalized_name = ?) 
                AND (provincia = ? OR citta = ?)
                LIMIT 1
            `);

            for (const variant of input.company_name_variants) {
                const normVariant = variant.toLowerCase().replace(/[^a-z0-9]/g, '');
                const result = stmt.get(variant, normVariant, input.provincia || '', input.city || '') as { piva: string, ragione_sociale: string } | undefined;

                if (result) {
                    return {
                        piva: result.piva,
                        ragione_sociale: result.ragione_sociale,
                        confidence: 0.90 // Extremely high, verified registry match
                    };
                }
            }

            // Fallback: Levenshtein/Fuzzy Search
            // Assuming we have a `search_index` virtual table using FTS5
            const ftsStmt = this.db.prepare(`
                SELECT piva, ragione_sociale 
                FROM companies_fts 
                WHERE companies_fts MATCH ? 
                LIMIT 5
            `);

            // Use the base company name (without SRL parts) for FTS
            const baseName = input.company_name_variants[0];
            const query = `"${baseName}" AND "${input.city || input.provincia || ''}"`;

            const matches = ftsStmt.all(query) as { piva: string, ragione_sociale: string }[];
            if (matches.length > 0) {
                return {
                    piva: matches[0].piva,
                    ragione_sociale: matches[0].ragione_sociale,
                    confidence: 0.80 // Lower confidence because it's a fuzzy text search
                };
            }

            return null;

        } catch (err) {
            // Quiet fail
            return null;
        }
    }

    public getStatus(): boolean {
        return this.isHealthy;
    }
}
