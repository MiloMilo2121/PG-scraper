/**
 * 🔀 MULTI-SOURCE MERGER
 * Task 39: Merge data from multiple sources with trust hierarchy
 * 
 * Trust Hierarchy (highest to lowest):
 * 1. Registro Imprese (official registry)
 * 2. VIES (EU VAT validation)
 * 3. Company Website
 * 4. PagineGialle
 * 5. Google Maps
 * 6. AI Extraction
 */

import { Logger } from './logger';

export enum DataSource {
    REGISTRY = 'REGISTRY',       // Highest trust
    VIES = 'VIES',
    WEBSITE = 'WEBSITE',
    PAGINEGIALLE = 'PAGINEGIALLE',
    GOOGLE_MAPS = 'GOOGLE_MAPS',
    AI = 'AI',
    UNKNOWN = 'UNKNOWN',         // Lowest trust
}

const TRUST_SCORES: Record<DataSource, number> = {
    [DataSource.REGISTRY]: 100,
    [DataSource.VIES]: 95,
    [DataSource.WEBSITE]: 80,
    [DataSource.PAGINEGIALLE]: 70,
    [DataSource.GOOGLE_MAPS]: 60,
    [DataSource.AI]: 50,
    [DataSource.UNKNOWN]: 10,
};

export interface SourcedValue<T> {
    value: T;
    source: DataSource;
    timestamp?: Date;
}

export interface MergedCompany {
    company_name: string;
    address?: string;
    city?: string;
    province?: string;
    phone?: string;
    website?: string;
    vat?: string;
    revenue?: string;
    employees?: string;
    pec?: string;
    email?: string;
    sources: {
        [key: string]: DataSource;
    };
}

export class DataMerger {
    /**
     * Merge multiple records into one, preferring higher-trust sources
     */
    static merge<T extends Record<string, any>>(
        records: Array<{ data: Partial<T>; source: DataSource }>
    ): { merged: Partial<T>; sources: Record<string, DataSource> } {
        const merged: Partial<T> = {};
        const sources: Record<string, DataSource> = {};
        const fieldTrust: Record<string, number> = {};

        // Sort by trust (highest first)
        const sorted = [...records].sort(
            (a, b) => TRUST_SCORES[b.source] - TRUST_SCORES[a.source]
        );

        for (const record of sorted) {
            for (const [key, value] of Object.entries(record.data)) {
                if (value === undefined || value === null || value === '') continue;

                const currentTrust = fieldTrust[key] || 0;
                const newTrust = TRUST_SCORES[record.source];

                // Only update if new source has higher trust
                if (newTrust > currentTrust) {
                    (merged as any)[key] = value;
                    sources[key] = record.source;
                    fieldTrust[key] = newTrust;
                }
            }
        }

        return { merged, sources };
    }

    /**
     * Merge two company records
     */
    static mergeCompanies(
        existing: MergedCompany,
        newData: Partial<MergedCompany>,
        source: DataSource
    ): MergedCompany {
        const { merged, sources } = this.merge([
            { data: existing, source: DataSource.UNKNOWN },
            { data: newData, source },
        ]);

        return {
            ...merged,
            company_name: merged.company_name || existing.company_name,
            sources: { ...existing.sources, ...sources },
        } as MergedCompany;
    }

    /**
     * Get trust score for a field
     */
    static getTrustScore(source: DataSource): number {
        return TRUST_SCORES[source] || 0;
    }
}
