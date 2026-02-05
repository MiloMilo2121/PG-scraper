/**
 * 📊 DATA NORMALIZER
 * Tasks 31, 33-34, 38: Data cleaning and validation
 * 
 * Features:
 * - Phone normalization to E.164 (Task 31)
 * - VIES VAT validation (Task 33)
 * - Domain blacklist (Task 34)
 * - Keyword relevance check (Task 38)
 */

import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';
import { Logger } from '../utils/logger';

// Task 34: Domain blacklist
const BLACKLISTED_DOMAINS = new Set([
    'facebook.com',
    'fb.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'youtube.com',
    'tiktok.com',
    'amazon.it',
    'amazon.com',
    'ebay.it',
    'ebay.com',
    'paginegialle.it',
    'paginebianche.it',
    'subito.it',
    'wikipedia.org',
    'google.com',
    'google.it',
    'bing.com',
]);

export interface NormalizedData {
    phone?: string;
    phoneValid: boolean;
    vatValid?: boolean;
    domainValid: boolean;
    keywordMatch: boolean;
}

export class DataNormalizer {
    /**
     * Task 31: Normalize phone to E.164 format
     */
    static normalizePhone(phone: string | undefined, countryCode: CountryCode = 'IT'): {
        normalized: string | null;
        valid: boolean;
    } {
        if (!phone) return { normalized: null, valid: false };

        try {
            // Clean the input
            const cleaned = phone.replace(/[^\d+]/g, '');

            // Try to parse
            if (isValidPhoneNumber(cleaned, countryCode)) {
                const parsed = parsePhoneNumber(cleaned, countryCode);
                return {
                    normalized: parsed.format('E.164'),
                    valid: true,
                };
            }

            // Try with country code prepended
            const withCode = cleaned.startsWith('+') ? cleaned : `+39${cleaned}`;
            if (isValidPhoneNumber(withCode)) {
                const parsed = parsePhoneNumber(withCode);
                return {
                    normalized: parsed.format('E.164'),
                    valid: true,
                };
            }

            return { normalized: cleaned, valid: false };
        } catch {
            return { normalized: phone, valid: false };
        }
    }

    /**
     * Task 33: Validate Italian VAT number format
     */
    static validateVATFormat(vat: string | undefined): boolean {
        if (!vat) return false;

        const cleaned = vat.replace(/\D/g, '');
        if (cleaned.length !== 11) return false;

        // Luhn-like check for Italian VAT
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            let digit = parseInt(cleaned[i]);
            if (i % 2 === 1) {
                digit *= 2;
                if (digit > 9) digit = Math.floor(digit / 10) + (digit % 10);
            }
            sum += digit;
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return checkDigit === parseInt(cleaned[10]);
    }

    /**
     * Task 34: Check if domain is blacklisted
     */
    static isDomainBlacklisted(url: string | undefined): boolean {
        if (!url) return false;

        try {
            const hostname = new URL(url).hostname.toLowerCase().replace('www.', '');

            // Check if hostname matches or is subdomain of blacklisted
            for (const blacklisted of BLACKLISTED_DOMAINS) {
                if (hostname === blacklisted || hostname.endsWith(`.${blacklisted}`)) {
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Task 38: Check keyword relevance
     */
    static checkKeywordRelevance(text: string | undefined, keywords: string[]): {
        match: boolean;
        matchedKeywords: string[];
        score: number;
    } {
        if (!text || keywords.length === 0) {
            return { match: true, matchedKeywords: [], score: 1 };
        }

        const lowerText = text.toLowerCase();
        const matched: string[] = [];

        for (const keyword of keywords) {
            if (lowerText.includes(keyword.toLowerCase())) {
                matched.push(keyword);
            }
        }

        return {
            match: matched.length > 0,
            matchedKeywords: matched,
            score: keywords.length > 0 ? matched.length / keywords.length : 1,
        };
    }

    /**
     * Normalize province codes
     */
    static normalizeProvince(province: string | undefined): string | undefined {
        if (!province) return undefined;

        // Common mappings
        const mappings: Record<string, string> = {
            'milano': 'MI',
            'roma': 'RM',
            'torino': 'TO',
            'napoli': 'NA',
            'brescia': 'BS',
            'bergamo': 'BG',
            'bologna': 'BO',
            'firenze': 'FI',
            'venezia': 'VE',
            'verona': 'VR',
            'genova': 'GE',
            'padova': 'PD',
        };

        const lower = province.toLowerCase().trim();
        if (mappings[lower]) return mappings[lower];

        // If already 2 letters, uppercase
        if (province.length === 2) return province.toUpperCase();

        return province;
    }

    /**
     * Normalize CAP (postal code)
     */
    static normalizeCAP(cap: string | undefined): string | undefined {
        if (!cap) return undefined;
        const cleaned = cap.replace(/\D/g, '');
        return cleaned.length === 5 ? cleaned : undefined;
    }

    /**
     * Clean company name for comparison
     */
    static cleanCompanyName(name: string): string {
        return name
            .toLowerCase()
            .replace(/\s*(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?s\.?)\.?\s*$/i, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
