
import { CompanyInput } from '../types';

/**
 * 👯 SMART DEDUPLICATOR 👯
 * Handles fuzzy matching, fingerprinting, and merging of duplicate companies.
 */
export class Deduplicator {
    private vatIndex = new Map<string, CompanyInput>();
    private phoneIndex = new Map<string, CompanyInput>();
    private fingerPrintIndex = new Map<string, CompanyInput>();
    private domainCache = new Set<string>();

    constructor() { }

    /**
     * Checks if a company already exists.
     * Returns the EXISTING company if found, or null.
     */
    checkDuplicate(company: CompanyInput): CompanyInput | null {
        // 1. VAT Match (Official & Unique)
        const vat = company.vat_code || company.piva || company.vat;
        if (vat && this.vatIndex.has(vat)) {
            return this.vatIndex.get(vat)!;
        }

        // 2. Phone Match (High Confidence)
        const cleanPhone = this.normalizePhone(company.phone);
        if (cleanPhone && cleanPhone.length > 5 && this.phoneIndex.has(cleanPhone)) {
            return this.phoneIndex.get(cleanPhone)!;
        }

        // 3. Fingerprint Match (Name + City)
        const fingerprint = this.generateFingerprint(company.company_name, company.city);
        if (this.fingerPrintIndex.has(fingerprint)) {
            return this.fingerPrintIndex.get(fingerprint)!;
        }

        // 4. Domain Match
        if (company.website) {
            try {
                const domain = new URL(company.website).hostname.replace('www.', '');
                // We can't easily return the object from a Set<string>, so we rely on other methods mostly.
                // But if we wanted to enforce domain uniqueness we could. 
                // For now, let's stick to the indices that map to objects.
                // If we really want to check domain duplication returning the object, we'd need a map.
            } catch { }
        }

        return null;
    }

    /**
     * Registers a company into the deduplication indices.
     */
    add(company: CompanyInput) {
        // VAT
        const vat = company.vat_code || company.piva || company.vat;
        if (vat) this.vatIndex.set(vat, company);

        // Phone
        const cleanPhone = this.normalizePhone(company.phone);
        if (cleanPhone && cleanPhone.length > 5) this.phoneIndex.set(cleanPhone, company);

        // Fingerprint
        const fingerprint = this.generateFingerprint(company.company_name, company.city);
        this.fingerPrintIndex.set(fingerprint, company);

        // Domain
        if (company.website) {
            try {
                const domain = new URL(company.website).hostname.replace('www.', '');
                this.domainCache.add(domain);
            } catch { }
        }
    }

    /**
     * Merge logic:
     * - Keeps existing ID/VAT (PG priority)
     * - Takes Website from Maps (if new/better)
     * - Merges Phones
     */
    merge(existing: CompanyInput, fresh: CompanyInput): CompanyInput {
        // 1. Website: Prefer Fresh (Maps) if existing is empty
        if (!existing.website && fresh.website) {
            existing.website = fresh.website;
            existing.source = `${existing.source} + Maps`;
        }

        // 2. Phone: If different, maybe append? For now, we keep existing if present, else take fresh.
        if (!existing.phone && fresh.phone) {
            existing.phone = fresh.phone;
        }

        // 3. Address: Maps often has better addresses
        if ((!existing.address || existing.address.length < 5) && fresh.address) {
            existing.address = fresh.address;
        }

        return existing;
    }

    /**
     * Returns ALL unique companies stored in the deduplication indices.
     */
    getAll(): CompanyInput[] {
        const seen = new Set<string>();
        const all: CompanyInput[] = [];

        for (const company of this.fingerPrintIndex.values()) {
            const fp = this.generateFingerprint(company.company_name, company.city);
            if (!seen.has(fp)) {
                seen.add(fp);
                all.push(company);
            }
        }

        return all;
    }

    /**
     * Returns the current count of unique entries.
     */
    get count(): number {
        return this.fingerPrintIndex.size;
    }

    private normalizePhone(phone?: string): string {
        if (!phone) return '';
        return phone.replace(/[^0-9]/g, '');
    }

    private generateFingerprint(name: string, city: string = ''): string {
        const n = name.toLowerCase()
            .replace(/s\.r\.l\.|s\.p\.a\.|s\.n\.c\.|srl|spa|snc/g, '')
            .replace(/[^\w]/g, '');
        const c = city.toLowerCase().replace(/[^\w]/g, '');
        return `${n}_${c}`;
    }
}

