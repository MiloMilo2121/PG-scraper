import { z } from 'zod';

export interface NormalizedInput {
    company_name: string;
    company_name_variants: string[];
    city: string;
    provincia?: string;
    address?: string;
    phone?: string;
    email?: string;
    email_domain?: string;
    quality_score: number;
}

const PROVINCE_CODES = new Set([
    'AG', 'AL', 'AN', 'AO', 'AR', 'AP', 'AT', 'AV', 'BA', 'BT', 'BL', 'BN', 'BG', 'BI', 'BO', 'BZ', 'BS', 'BR', 'CA', 'CL', 'CB', 'CI', 'CE', 'CT', 'CZ', 'CH', 'CO', 'CS', 'CR', 'KR', 'CN', 'EN', 'FM', 'FE', 'FI', 'FG', 'FC', 'FR', 'GE', 'GO', 'GR', 'IM', 'IS', 'SP', 'AQ', 'LT', 'LE', 'LC', 'LI', 'LO', 'LU', 'MC', 'MN', 'MS', 'MT', 'VS', 'ME', 'MI', 'MO', 'MB', 'NA', 'NO', 'NU', 'OG', 'OT', 'OR', 'PD', 'PA', 'PR', 'PV', 'PG', 'PU', 'PE', 'PC', 'PI', 'PT', 'PN', 'PZ', 'PO', 'RG', 'RA', 'RC', 'RE', 'RI', 'RN', 'RM', 'RO', 'SA', 'SS', 'SV', 'SI', 'SR', 'SO', 'TA', 'TE', 'TR', 'TO', 'TP', 'TN', 'TV', 'TS', 'UD', 'VA', 'VE', 'VB', 'VC', 'VR', 'VV', 'VI', 'VT'
]);

const LEGAL_SUFFIX_REGEX = /(?:\s+|^|\W)(s\.\s*r\.\s*l\.|srl|s\.\s*p\.\s*a\.|spa|s\.\s*n\.\s*c\.|snc|s\.\s*a\.\s*s\.|sas|s\.\s*c\.\s*a\.\s*r\.\s*l\.|scarl|s\.\s*r\.\s*l\.\s*s\.|srls)(?:\s+|$|\W)/i;

export class InputNormalizer {
    public normalize(raw: Record<string, string>): NormalizedInput {
        // Encodings & Character Normalization
        const cleanString = (str: string | undefined) => {
            if (!str) return '';
            // NFC normalization
            let cleaned = str.normalize('NFC');
            // Remove BOM, Control chars, zero-width spaces
            cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
            // Normalize dashes
            cleaned = cleaned.replace(/[\u2010-\u2015]/g, '-');
            // Quote cleaning: remove ALL quotes
            cleaned = cleaned.replace(/["'«»‹›„“”‘’]/g, '');
            // Collapse whitespace & trim
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            return cleaned;
        };

        let name = cleanString(raw.company_name || raw.name || '');
        let city = cleanString(raw.city || raw.locality || '');
        let address = cleanString(raw.address || raw.street || '');
        let phone = cleanString(raw.phone || '');
        let email = cleanString(raw.email || '');

        let provincia: string | undefined;

        // 3. Province Extraction
        // Looking for City (BS), City - BS, City/BS
        const provMatch = city.match(/(.+?)\s*[\(\-\/]\s*([A-Za-z]{2})\s*[\)]?$/);
        if (provMatch && PROVINCE_CODES.has(provMatch[2].toUpperCase())) {
            city = provMatch[1].trim();
            provincia = provMatch[2].toUpperCase();
        } else if (!provMatch) {
            // Also check company_name for (BS) anomalies (like Caino (BS))
            const nameProvMatch = name.match(/(.+?)\s*[\(\-\/]\s*([A-Za-z]{2})\s*[\)]?$/);
            if (nameProvMatch && PROVINCE_CODES.has(nameProvMatch[2].toUpperCase())) {
                name = nameProvMatch[1].trim();
                provincia = nameProvMatch[2].toUpperCase();
            }
        }

        // 4. Legal Suffix Normalization
        const variants: string[] = [];
        let strippedName = name.replace(new RegExp(LEGAL_SUFFIX_REGEX.source, 'gi'), ' ').trim();
        strippedName = strippedName.replace(/\s+/g, ' ');

        if (strippedName !== name) {
            variants.push(strippedName);
            // Re-add standard suffix:
            variants.push(`${strippedName} SRL`);
            variants.push(`${strippedName} S.R.L.`);
        } else {
            variants.push(name);
        }

        // Remove duplicates and keep original
        if (!variants.includes(name)) variants.push(name);
        const uniqueVariants = Array.from(new Set(variants));

        // 6. Email Validation + Domain Extraction
        let emailDomain: string | undefined;
        if (email) {
            email = email.toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(email)) {
                const parts = email.split('@');
                if (parts.length === 2) {
                    const domain = parts[1];
                    // Skip generic providers
                    const publicProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'libero.it', 'alice.it', 'tim.it', 'tiscali.it', 'virgilio.it', 'pec.it'];
                    let isPec = domain.includes('pec') || domain.includes('legalmail') || domain.includes('cert');
                    if (!publicProviders.includes(domain) && !isPec) {
                        emailDomain = domain;
                    }
                }
            } else {
                email = ''; // Invalid email
            }
        }

        // 7. Phone Normalization
        if (phone) {
            phone = phone.replace(/[\s\-\(\)]/g, '');
            if (phone.length >= 9 && !phone.startsWith('+')) {
                phone = '+39' + (phone.startsWith('0') ? phone : phone);
            }
        }

        // 8. Quality Scoring
        let score = 0;
        if (name && city) score += 0.5;
        if (emailDomain) score += 0.2;
        if (phone || address) score += 0.15;
        if (name && city && emailDomain && (phone || address)) score = 1.0;

        // Minimum cap
        if (score === 0.0 && name) score = 0.1;

        return {
            company_name: name,
            company_name_variants: uniqueVariants,
            city,
            provincia,
            address: address || undefined,
            phone: phone || undefined,
            email: email || undefined,
            email_domain: emailDomain,
            quality_score: Math.min(1.0, score)
        };
    }

    public normalizeBatch(rows: Record<string, string>[], onProgress?: (done: number, total: number) => void): NormalizedInput[] {
        const total = rows.length;
        return rows.map((row, index) => {
            const result = this.normalize(row);
            if (onProgress) {
                onProgress(index + 1, total);
            }
            return result;
        });
    }
}
