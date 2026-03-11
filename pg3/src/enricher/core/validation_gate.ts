/**
 * 🚦 OMEGA V9: CENTRALIZED DATA VALIDATION GATE
 * Structural Optimization: Single checkpoint before DB insertion.
 *
 * Every enriched CompanyInput record must pass through this gate.
 * Validates, normalizes, deduplicates, and scores data quality BEFORE persistence.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';

export enum ValidationSeverity {
    PASS = 'PASS',
    WARNING = 'WARNING',
    REJECT = 'REJECT'
}

export enum VatValidationStatus {
    MISSING = 'MISSING',
    INVALID_FORMAT = 'INVALID_FORMAT',
    CHECKSUM_VALID = 'CHECKSUM_VALID',
}

export interface QualityBreakdown {
    identityScore: number;
    contactabilityScore: number;
    authorityScore: number;
}

export interface ValidationReport {
    severity: ValidationSeverity;
    qualityScore: number; // 0-100
    issues: string[];
    normalizedRecord: CompanyInput;
    vatStatus: VatValidationStatus;
    qualityBreakdown: QualityBreakdown;
}

type NormalizedPhone = {
    e164: string;
    national: string;
    country: string;
    type: string;
};

export class ValidationGate {

    /**
     * 🚦 Main entry point: validate and normalize a company record.
     */
    static validate(record: CompanyInput): ValidationReport {
        const issues: string[] = [];
        const normalized: CompanyInput = { ...record };

        let identityScore = 100;
        let contactabilityScore = 100;
        let authorityScore = 100;
        let vatStatus = VatValidationStatus.MISSING;

        // 1. Mandatory identity field
        if (!normalized.company_name || normalized.company_name.trim().length < 2) {
            issues.push('CRITICAL: company_name missing or too short');
            identityScore -= 70;
            authorityScore -= 20;
        }

        // 2. Phone normalization
        if (normalized.phone) {
            const phone = ValidationGate.normalizePhone(normalized.phone);
            if (!phone) {
                issues.push('Phone number invalid after normalization');
                contactabilityScore -= 25;
            } else {
                normalized.phone_raw = normalized.phone;
                normalized.phone = phone.e164;
                normalized.phone_country = phone.country;
                normalized.phone_type = phone.type;
                normalized.phone_national = phone.national;
            }
        } else {
            contactabilityScore -= 10;
        }

        // 3. Email normalization
        if (normalized.email) {
            normalized.email = normalized.email.toLowerCase().trim();
            if (!ValidationGate.isValidEmail(normalized.email)) {
                issues.push(`Email invalid: ${normalized.email}`);
                contactabilityScore -= 20;
                authorityScore -= 5;
            }
        } else {
            contactabilityScore -= 10;
        }

        if (normalized.pec) {
            normalized.pec = normalized.pec.toLowerCase().trim();
            if (!ValidationGate.isValidEmail(normalized.pec)) {
                issues.push(`PEC invalid: ${normalized.pec}`);
                contactabilityScore -= 15;
                authorityScore -= 15;
            } else {
                normalized.pec_source = normalized.pec_source || 'UNKNOWN';
            }
        } else {
            authorityScore -= 10;
        }

        // 4. VAT / P.IVA validation
        const rawVat = normalized.vat_code || normalized.piva || normalized.vat || '';
        const vatValidation = ValidationGate.normalizeVat(rawVat);
        vatStatus = vatValidation.status;

        if (vatValidation.value) {
            normalized.vat_code = vatValidation.value;
            normalized.piva = vatValidation.value;
            normalized.vat = vatValidation.value;
            normalized.vat_status = vatStatus;
        } else {
            normalized.vat_status = vatStatus;
        }

        if (vatStatus === VatValidationStatus.INVALID_FORMAT) {
            issues.push(`VAT invalid: ${rawVat}`);
            identityScore -= 20;
            authorityScore -= 35;
        } else if (vatStatus === VatValidationStatus.MISSING) {
            issues.push('No VAT/P.IVA provided');
            authorityScore -= 20;
        }

        // 5. Fiscal code validation
        if (normalized.fiscal_code) {
            const cf = normalized.fiscal_code.toUpperCase().trim();
            if (cf.length !== 16 && cf.length !== 11) {
                issues.push(`Fiscal code length invalid: ${cf.length}`);
                identityScore -= 10;
            }
            normalized.fiscal_code = cf;
        }

        // 6. Website URL normalization
        if (normalized.website) {
            const url = ValidationGate.normalizeUrl(normalized.website);
            if (!url) {
                issues.push(`Website invalid: ${normalized.website}`);
                identityScore -= 10;
                contactabilityScore -= 15;
            } else {
                normalized.website = url;
            }
        } else {
            contactabilityScore -= 15;
        }

        // 7. Address structure check
        if (!normalized.city && !normalized.address) {
            issues.push('Both city and address are missing');
            identityScore -= 25;
        }

        if (normalized.city) {
            normalized.city = ValidationGate.capitalizeWords(normalized.city.trim());
        }

        // 8. Company name sanitization
        if (normalized.company_name) {
            normalized.company_name = normalized.company_name
                .replace(/\s+/g, ' ')
                .replace(/[<>{}[\]]/g, '')
                .trim();
        }

        // 9. Domain authority cross-check
        if (normalized.email && normalized.website) {
            const emailDomain = ValidationGate.extractDomain(normalized.email);
            const websiteDomain = ValidationGate.extractDomain(normalized.website);
            if (emailDomain && websiteDomain && emailDomain !== websiteDomain) {
                issues.push(`Email domain mismatch: ${emailDomain} vs ${websiteDomain}`);
                authorityScore -= 10;
            }
        }

        // 10. Completeness-aware scoring
        const completenessFields = ['email', 'phone', 'website', 'vat_code', 'city', 'address', 'category', 'pec'];
        const filledCount = completenessFields.filter((field) => !!normalized[field]).length;
        const completenessRatio = filledCount / completenessFields.length;
        contactabilityScore = Math.min(100, contactabilityScore + Math.round(completenessRatio * 10));
        authorityScore = Math.min(100, authorityScore + Math.round(completenessRatio * 5));

        const breakdown: QualityBreakdown = {
            identityScore: ValidationGate.clampScore(identityScore),
            contactabilityScore: ValidationGate.clampScore(contactabilityScore),
            authorityScore: ValidationGate.clampScore(authorityScore),
        };

        const qualityScore = ValidationGate.clampScore(
            Math.round(
                breakdown.identityScore * 0.45 +
                breakdown.contactabilityScore * 0.35 +
                breakdown.authorityScore * 0.20
            )
        );

        let severity: ValidationSeverity;
        if (qualityScore >= 70) {
            severity = ValidationSeverity.PASS;
        } else if (qualityScore >= 40) {
            severity = ValidationSeverity.WARNING;
        } else {
            severity = ValidationSeverity.REJECT;
        }

        if (issues.length > 0 && severity !== ValidationSeverity.REJECT) {
            Logger.debug(`🚦 [ValidationGate] ${normalized.company_name}: Score=${qualityScore}, Issues=${issues.length}`);
        }

        return {
            severity,
            qualityScore,
            issues,
            normalizedRecord: normalized,
            vatStatus,
            qualityBreakdown: breakdown,
        };
    }

    private static normalizePhone(phone: string): NormalizedPhone | null {
        const parsed = parsePhoneNumberFromString(phone, 'IT');
        if (!parsed || !parsed.isValid()) {
            return null;
        }

        return {
            e164: parsed.number,
            national: parsed.formatNational(),
            country: parsed.country || 'IT',
            type: parsed.getType() || 'UNKNOWN',
        };
    }

    private static isValidEmail(email: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    private static normalizeVat(rawVat: string): { value: string | null; status: VatValidationStatus } {
        const cleanVat = (rawVat || '').replace(/^IT/i, '').replace(/\D/g, '');
        if (!cleanVat) {
            return { value: null, status: VatValidationStatus.MISSING };
        }

        if (cleanVat.length !== 11 || !ValidationGate.validateItalianVAT(cleanVat)) {
            return { value: null, status: VatValidationStatus.INVALID_FORMAT };
        }

        return { value: cleanVat, status: VatValidationStatus.CHECKSUM_VALID };
    }

    /**
     * Italian VAT (P.IVA) checksum validation.
     */
    private static validateItalianVAT(vat: string): boolean {
        if (vat.length !== 11 || !/^\d{11}$/.test(vat)) return false;

        let sum = 0;
        for (let i = 0; i < 10; i++) {
            const digit = parseInt(vat[i], 10);
            if (i % 2 === 0) {
                sum += digit;
            } else {
                const doubled = digit * 2;
                sum += doubled > 9 ? doubled - 9 : doubled;
            }
        }

        const checkDigit = (10 - (sum % 10)) % 10;
        return checkDigit === parseInt(vat[10], 10);
    }

    private static normalizeUrl(url: string): string {
        try {
            const base = /^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`;
            const parsed = new URL(base);
            parsed.protocol = parsed.protocol === 'http:' ? 'https:' : parsed.protocol;
            parsed.hostname = parsed.hostname.toLowerCase();

            // Drop obvious marketing params while preserving meaningful paths.
            for (const key of [...parsed.searchParams.keys()]) {
                if (/^(utm_|gclid|fbclid|msclkid)/i.test(key)) {
                    parsed.searchParams.delete(key);
                }
            }

            const normalized = parsed.toString().replace(/\/$/, '');
            return normalized;
        } catch {
            return '';
        }
    }

    private static extractDomain(value: string): string {
        try {
            if (value.includes('@')) {
                return value.split('@')[1].toLowerCase();
            }
            return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return '';
        }
    }

    private static capitalizeWords(text: string): string {
        return text.replace(/\b\w/g, (c) => c.toUpperCase());
    }

    private static clampScore(score: number): number {
        return Math.max(0, Math.min(100, score));
    }
}
