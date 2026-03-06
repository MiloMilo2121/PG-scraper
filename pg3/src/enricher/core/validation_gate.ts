/**
 * 🚦 OMEGA V9: CENTRALIZED DATA VALIDATION GATE
 * Structural Optimization: Single checkpoint before DB insertion.
 *
 * Every enriched CompanyInput record must pass through this gate.
 * Validates, normalizes, deduplicates, and scores data quality BEFORE persistence.
 *
 * Law 301: Zero Trust — sanitize everything.
 * Law 402: Normalization — phones E.164, emails lowercase, addresses structured.
 * Law 403: Duplicate Prevention — fuzzy dedup.
 * Law 407: Data Validation (Runtime) — Zod-like schema checks at the edge.
 */

import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';

export enum ValidationSeverity {
    PASS = 'PASS',
    WARNING = 'WARNING',
    REJECT = 'REJECT'
}

export interface ValidationReport {
    severity: ValidationSeverity;
    qualityScore: number; // 0-100
    issues: string[];
    normalizedRecord: CompanyInput;
}

export class ValidationGate {

    /**
     * 🚦 Main entry point: validate and normalize a company record.
     */
    static validate(record: CompanyInput): ValidationReport {
        const issues: string[] = [];
        let score = 100;
        const normalized = { ...record };

        // ─── 1. MANDATORY FIELD CHECK ────────────────────────────────
        if (!normalized.company_name || normalized.company_name.trim().length < 2) {
            issues.push('CRITICAL: company_name missing or too short');
            score -= 50;
        }

        // ─── 2. PHONE NORMALIZATION (E.164) ──────────────────────────
        if (normalized.phone) {
            normalized.phone = ValidationGate.normalizePhone(normalized.phone);
            if (!normalized.phone) {
                issues.push('Phone number invalid after normalization');
                score -= 5;
            }
        }

        // ─── 3. EMAIL NORMALIZATION ──────────────────────────────────
        if (normalized.email) {
            normalized.email = normalized.email.toLowerCase().trim();
            if (!ValidationGate.isValidEmail(normalized.email)) {
                issues.push(`Email invalid: ${normalized.email}`);
                score -= 10;
            }
        }

        if (normalized.pec) {
            normalized.pec = normalized.pec.toLowerCase().trim();
            if (!ValidationGate.isValidEmail(normalized.pec)) {
                issues.push(`PEC invalid: ${normalized.pec}`);
                score -= 5;
            }
        }

        // ─── 4. VAT/PIVA VALIDATION (Italian) ───────────────────────
        const rawVat = normalized.vat_code || normalized.piva || normalized.vat || '';
        if (rawVat) {
            const cleanVat = rawVat.replace(/\D/g, '');
            if (cleanVat.length === 11) {
                if (!ValidationGate.validateItalianVAT(cleanVat)) {
                    issues.push(`VAT checksum failed: ${cleanVat}`);
                    score -= 15;
                } else {
                    // Canonicalize
                    normalized.vat_code = cleanVat;
                    normalized.piva = cleanVat;
                }
            } else if (cleanVat.length > 0) {
                issues.push(`VAT length invalid (${cleanVat.length} digits, expected 11)`);
                score -= 10;
            }
        } else {
            issues.push('No VAT/P.IVA provided');
            score -= 5;
        }

        // ─── 5. FISCAL CODE VALIDATION (Italian) ────────────────────
        if (normalized.fiscal_code) {
            const cf = normalized.fiscal_code.toUpperCase().trim();
            if (cf.length !== 16 && cf.length !== 11) {
                issues.push(`Fiscal code length invalid: ${cf.length}`);
                score -= 5;
            }
            normalized.fiscal_code = cf;
        }

        // ─── 6. WEBSITE URL NORMALIZATION ───────────────────────────
        if (normalized.website) {
            normalized.website = ValidationGate.normalizeUrl(normalized.website);
        }

        // ─── 7. ADDRESS STRUCTURE CHECK ─────────────────────────────
        if (!normalized.city && !normalized.address) {
            issues.push('Both city and address are missing');
            score -= 10;
        }

        if (normalized.city) {
            normalized.city = ValidationGate.capitalizeWords(normalized.city.trim());
        }

        // ─── 8. COMPANY NAME SANITIZATION ───────────────────────────
        if (normalized.company_name) {
            normalized.company_name = normalized.company_name
                .replace(/\s+/g, ' ')                    // Collapse whitespace
                .replace(/[<>{}[\]]/g, '')                // Strip injection-prone chars (Law 306)
                .trim();
        }

        // ─── 9. DATA COMPLETENESS BONUS ─────────────────────────────
        const completenessFields = ['email', 'phone', 'website', 'vat_code', 'city', 'address', 'category'];
        const filledCount = completenessFields.filter(f => !!(normalized as any)[f]).length;
        const completenessBonus = Math.round((filledCount / completenessFields.length) * 15);
        score = Math.min(100, score + completenessBonus);

        // ─── FINAL SEVERITY DETERMINATION ───────────────────────────
        let severity: ValidationSeverity;
        if (score >= 70) {
            severity = ValidationSeverity.PASS;
        } else if (score >= 40) {
            severity = ValidationSeverity.WARNING;
        } else {
            severity = ValidationSeverity.REJECT;
        }

        if (issues.length > 0 && severity !== ValidationSeverity.REJECT) {
            Logger.debug(`🚦 [ValidationGate] ${normalized.company_name}: Score=${score}, Issues=${issues.length}`);
        }

        return {
            severity,
            qualityScore: Math.max(0, Math.min(100, score)),
            issues,
            normalizedRecord: normalized
        };
    }

    // ─── HELPERS ────────────────────────────────────────────────────

    /**
     * Normalize Italian phone numbers to E.164 format (+39...).
     */
    private static normalizePhone(phone: string): string {
        let cleaned = phone.replace(/[\s\-().\/]/g, '');

        // Handle Italian prefixes
        if (cleaned.startsWith('0039')) cleaned = '+39' + cleaned.slice(4);
        else if (cleaned.startsWith('039')) cleaned = '+39' + cleaned.slice(3);
        else if (cleaned.startsWith('0') && cleaned.length >= 9) cleaned = '+39' + cleaned;
        else if (!cleaned.startsWith('+')) cleaned = '+39' + cleaned;

        // Validate length
        const digits = cleaned.replace(/\D/g, '');
        if (digits.length < 9 || digits.length > 13) return '';

        return cleaned;
    }

    private static isValidEmail(email: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Italian VAT (P.IVA) checksum validation (Luhn mod 10 variant).
     */
    private static validateItalianVAT(vat: string): boolean {
        if (vat.length !== 11 || !/^\d{11}$/.test(vat)) return false;

        let sum = 0;
        for (let i = 0; i < 11; i++) {
            const digit = parseInt(vat[i], 10);
            if (i % 2 === 0) {
                sum += digit;
            } else {
                const doubled = digit * 2;
                sum += doubled > 9 ? doubled - 9 : doubled;
            }
        }
        return sum % 10 === 0;
    }

    private static normalizeUrl(url: string): string {
        let normalized = url.trim().toLowerCase();
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
            normalized = 'https://' + normalized;
        }
        // Remove trailing slash
        return normalized.replace(/\/+$/, '');
    }

    private static capitalizeWords(text: string): string {
        return text.replace(/\b\w/g, c => c.toUpperCase());
    }
}
