
import { CompanyInput } from '../core/company_types';
// import leven from 'leven'; // Removed to avoid dependency issues, using custom impl

/**
 * 👯 DEDUPLICATOR 👯
 * Task 20: Fuzzy Matching & Duplicate Detection
 */
export class Deduplicator {

    // Cache of seen entities (P.IVA -> Company)
    private static pivaCache = new Set<string>();
    // Cache of seen URLs (Domain -> Company)
    private static domainCache = new Set<string>();

    /**
     * Checks if a company is a duplicate based on P.IVA or Domain.
     * Returns TRUE if duplicate.
     */
    static isDuplicate(company: CompanyInput | Partial<CompanyInput>): boolean {
        if (company.piva && this.pivaCache.has(company.piva)) {
            // console.log(`[Dedupe] Duplicate P.IVA: ${company.piva}`);
            return true;
        }

        if (company.website) {
            try {
                const domain = new URL(company.website).hostname.replace('www.', '');
                if (this.domainCache.has(domain)) {
                    // console.log(`[Dedupe] Duplicate Domain: ${domain}`);
                    return true;
                }
            } catch { }
        }

        return false;
    }

    static register(company: CompanyInput | Partial<CompanyInput>) {
        if (company.piva) this.pivaCache.add(company.piva);
        if (company.website) {
            try {
                const domain = new URL(company.website).hostname.replace('www.', '');
                this.domainCache.add(domain);
            } catch { }
        }
    }

    /**
     * Fuzzy Match Name. Returns true if similarity > 90%
     */
    static isFuzzyDuplicate(name1: string, name2: string): boolean {
        const n1 = name1.toLowerCase().replace(/srl|spa|snc/g, '').trim();
        const n2 = name2.toLowerCase().replace(/srl|spa|snc/g, '').trim();

        if (n1 === n2) return true;

        // Simple Levenshtein ratio (if no lib, implement simple)
        const dist = this.levenshtein(n1, n2);
        const maxLen = Math.max(n1.length, n2.length);
        const similarity = 1 - (dist / maxLen);

        return similarity > 0.9; // 90% Similarity threshold
    }

    // Custom lightweight Levenshtein implementation
    private static levenshtein(a: string, b: string): number {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }
}
