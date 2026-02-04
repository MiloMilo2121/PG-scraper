import { CompanyInput } from '../../types';

export class SmartDeduplicator {
    private vatIndex = new Map<string, CompanyInput>();
    private phoneIndex = new Map<string, CompanyInput>();
    private nameIndex = new Map<string, CompanyInput>();

    constructor() { }

    /**
     * Checks if a company is already verified/stored.
     * Returns the existing company object if it's a duplicate, or null if it's new.
     * 
     * Deduplication Logic:
     * 1. VAT Match (100% confidence)
     * 2. Phone Match (High confidence if valid mobile/landline)
     * 3. Fuzzy Name + City Match (Medium confidence)
     */
    checkDuplicate(company: CompanyInput): CompanyInput | null {
        // 1. VAT Check
        // Check standard 'vat_code', or aliases 'piva', 'vat'
        const vat = company.vat_code || company.piva || company.vat;
        if (vat && this.vatIndex.has(vat)) {
            return this.vatIndex.get(vat)!;
        }

        // 2. Phone Check (Clean and normalize phone first)
        const cleanPhone = this.normalizePhone(company.phone);
        if (cleanPhone && cleanPhone.length > 5 && this.phoneIndex.has(cleanPhone)) {
            return this.phoneIndex.get(cleanPhone)!;
        }

        // 3. Name + City Check
        if (company.company_name && company.city) {
            const uniqueKey = this.generateNameKey(company.company_name, company.city);
            if (this.nameIndex.has(uniqueKey)) {
                return this.nameIndex.get(uniqueKey)!;
            }
        }

        return null;
    }

    /**
     * Adds a company to the internal indices.
     */
    add(company: CompanyInput): void {
        // Index by VAT
        const vat = company.vat_code || company.piva || company.vat;
        if (vat) {
            this.vatIndex.set(vat, company);
        }

        // Index by Phone
        const cleanPhone = this.normalizePhone(company.phone);
        if (cleanPhone && cleanPhone.length > 5) {
            this.phoneIndex.set(cleanPhone, company);
        }

        // Index by Name+City
        if (company.company_name && company.city) {
            const uniqueKey = this.generateNameKey(company.company_name, company.city);
            this.nameIndex.set(uniqueKey, company);
        }
    }

    private normalizePhone(phone?: string): string {
        if (!phone) return '';
        return phone.replace(/[^0-9]/g, '');
    }

    private generateNameKey(name: string, city: string): string {
        return `${this.normalizeString(name)}|${this.normalizeString(city)}`;
    }

    private normalizeString(str?: string): string {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/s\.r\.l\.|srl|s\.n\.c\.|snc|s\.p\.a\.|spa|ditta|societa/g, '') // Remove corporate types
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ') // Collapse spaces
            .trim();
    }
}
