/**
 * 🔍 FUZZY DEDUPLICATION ENGINE
 * Task 32: Detect and merge duplicate companies
 */

import levenshtein from 'fast-levenshtein';
import { DataNormalizer } from './normalizer';
import { Logger } from './logger';

export interface DedupeResult {
    isDuplicate: boolean;
    matchedWith?: string;
    similarity: number;
}

export class Deduplicator {
    private knownCompanies: Map<string, string> = new Map(); // cleanedName -> originalName
    private threshold: number;

    constructor(similarityThreshold: number = 0.85) {
        this.threshold = similarityThreshold;
    }

    /**
     * Check if a company is a duplicate
     */
    check(companyName: string, city?: string): DedupeResult {
        const cleaned = DataNormalizer.cleanCompanyName(companyName);
        const key = city ? `${cleaned}|${city.toLowerCase()}` : cleaned;

        // Exact match
        if (this.knownCompanies.has(key)) {
            return {
                isDuplicate: true,
                matchedWith: this.knownCompanies.get(key),
                similarity: 1.0,
            };
        }

        // Fuzzy match
        for (const [existingKey, originalName] of this.knownCompanies) {
            const existingCleaned = existingKey.split('|')[0];
            const similarity = this.calculateSimilarity(cleaned, existingCleaned);

            if (similarity >= this.threshold) {
                return {
                    isDuplicate: true,
                    matchedWith: originalName,
                    similarity,
                };
            }
        }

        // Not a duplicate - add to known
        this.knownCompanies.set(key, companyName);
        return {
            isDuplicate: false,
            similarity: 0,
        };
    }

    /**
     * Calculate similarity between two strings (0-1)
     */
    private calculateSimilarity(a: string, b: string): number {
        if (a === b) return 1;

        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;

        const distance = levenshtein.get(a, b);
        return 1 - distance / maxLen;
    }

    /**
     * Bulk deduplication of company list
     */
    deduplicateList<T extends { company_name: string; city?: string }>(
        companies: T[]
    ): { unique: T[]; duplicates: T[] } {
        const unique: T[] = [];
        const duplicates: T[] = [];

        for (const company of companies) {
            const result = this.check(company.company_name, company.city);
            if (result.isDuplicate) {
                duplicates.push(company);
            } else {
                unique.push(company);
            }
        }

        Logger.info(`🔍 Deduplication: ${companies.length} -> ${unique.length} unique (${duplicates.length} duplicates)`);
        return { unique, duplicates };
    }

    /**
     * Clear known companies
     */
    reset(): void {
        this.knownCompanies.clear();
    }

    /**
     * Get statistics
     */
    getStats(): { totalKnown: number } {
        return { totalKnown: this.knownCompanies.size };
    }
}

export const deduplicator = new Deduplicator();
