import crypto from 'crypto';
import { InputRow, NormalizedEntity } from '../../types';

export class Normalizer {

    static normalize(row: InputRow): NormalizedEntity {
        const company_norm = this.normalizeCompany(row.company_name);
        const phones = this.normalizePhone(row.phone);
        const address_tokens = this.normalizeAddress(row.address);
        const city_norm = this.normalizeCity(row.city);
        const province_norm = row.province ? row.province.toUpperCase().trim() : '';

        const fingerprint = this.generateFingerprint(company_norm, phones.formatted[0] || '', city_norm);

        return {
            company_name: company_norm,
            vat_id: row.vat_id ? row.vat_id.replace(/[^0-9]/g, '') : undefined,
            city: city_norm,
            province: province_norm,
            address_tokens: address_tokens,
            phones: phones.formatted,
            raw_phones: phones.raw,
            fingerprint: fingerprint,
            source_row: row
        };
    }

    static normalizeCompany(name: string): string {
        if (!name) return '';
        let n = name.toLowerCase().trim();
        // Remove legal suffixes/prefixes
        n = n.replace(/(^|\s)(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?s\.?|soc\.?|coop\.?|societ[aà]'?\s+cooperativa|s\.?c\.?r\.?l\.?|s\.?c\.?|s\.?r\.?s\.?)(?=\s|$)/g, ' ');
        // Remove punctuation
        n = n.replace(/[.,/\-&()]/g, ' ');
        // Remove common stopwords
        n = n.replace(/\b(ristorante|pizzeria|hotel|albergo|caffe|osteria|trattoria|impresa|ditta|studio)\b/g, '');
        // Remove articles
        n = n.replace(/\b(il|lo|la|i|gli|le|un|uno|una)\b/g, '');
        // Normalize spaces
        return n.replace(/\s+/g, ' ').trim();
    }

    static normalizePhone(phone?: string): { formatted: string[], raw: string[] } {
        if (!phone) return { formatted: [], raw: [] };

        // Split multiple phones: only on ; or / surrounded by spaces, or " - "
        // Actually, "02/12345" is one number. "02/12345 / 333..." is two.
        // Let's split on ";" or " - " (dash with spaces) or "/" ONLY IF spaces around?
        // Or just treat / as non-separator if it's tight? 
        // Safer: Split by ";" primarily. 
        // If we rely on input formatting, we might miss some. 
        // Let's assume ";" is the clear delimiter for multi-value CSV fields usually.
        // If someone put "02 12345 / 333 456" in one field...
        // Let's retry split logic:
        const roughSplit = phone.split(/[;]|\s\/\s/); // Split on ; OR " / "
        const formatted: string[] = [];
        const raw: string[] = [];

        for (const p of roughSplit) {
            // Clean non-digits (keep +)
            let clean = p.replace(/[^0-9+]/g, '');
            // Handle 0039 prefix
            if (clean.startsWith('0039')) clean = '+' + clean.substring(2);
            // Handle Italy defaults if missing prefix and starts with 0 (landline) or 3 (mobile)
            // Actually strictly speaking we want to keep it simple.

            const digitOnly = clean.replace(/\+/g, '');
            if (digitOnly.length < 5) continue; // Noise

            // Standardize IT format +39...
            let standard = clean;
            if (!standard.startsWith('+')) {
                // Assume IT if 9-10 digits and starts with 3 or 0.
                // But input might be local only.
                // We'll keep it as is if we are unsure, but ideally prefix +39 for matching.
                if (standard.startsWith('0') || standard.startsWith('3')) {
                    standard = '+39' + standard;
                }
            }

            formatted.push(standard);
            raw.push(digitOnly);
        }

        // Dedup
        return {
            formatted: [...new Set(formatted)],
            raw: [...new Set(raw)]
        };
    }

    static normalizeAddress(address?: string): string[] {
        if (!address) return [];
        let a = address.toLowerCase();
        // Remove generic prefixes
        a = a.replace(/^(via|viale|piazza|corso|vicolo|strada|piazzale|largo)\s+/g, '');
        // Remove civic number logic (digits at end)
        a = a.replace(/,\s*\d+.*$/, '');
        // Tokenize
        return a.split(/\s+/).filter(t => t.length > 2);
    }

    static normalizeCity(city?: string): string {
        if (!city) return '';
        return city.toLowerCase().trim().replace(/[.,]/g, '');
    }

    static generateFingerprint(name: string, phone: string, city: string): string {
        return crypto.createHash('md5').update(`${name}|${phone}|${city}`).digest('hex');
    }
}
