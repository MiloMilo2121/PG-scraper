import { CompanyInput } from '../../../types';
import { ItalianNerParser } from './italian_ner_parser';

export class HyperGuesserVXGenerator {
    private static TLDS = ['.it', '.com', '.eu', '.net', '.org', '.srl'];

    /**
     * Generates an intelligent, aggressive set of domain permutations for a company
     * powered by an Italian NER parser.
     */
    static generate(company: CompanyInput): string[] {
        const domains = new Set<string>();
        const name = company.company_name || '';
        const city = company.city || '';

        if (!name) return [];

        // 1. Intelligent NER parsing
        const ner = ItalianNerParser.parse(name);
        const coreBrand = ner.coreBrand;
        const brandTokens = ner.brandTokens;

        // Use clean versions for URL formulation
        const cleanName = coreBrand.replace(/[^a-z0-9]/g, '');
        const cleanCity = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

        // 2. Base Brand Permutations
        this.add(domains, cleanName);
        this.add(domains, brandTokens.join('-'));

        // Include original raw string cleaned (some domains include the descriptors like "studiolegale...")
        const rawClean = ner.normalized.replace(/[^a-z0-9]/g, '');
        this.add(domains, rawClean);
        this.add(domains, ner.normalized.replace(/\s+/g, '-'));

        // Include original with legal entity stripped
        const noEntity = name.toLowerCase().replace(ner.legalEntity || '', '').replace(/[^a-z0-9]/g, '');
        this.add(domains, noEntity);


        // 3. Ultra Aggressive Acronyms (if multi-word brand)
        if (brandTokens.length > 1) {
            // First letters only (e.g. "Coffani Massimiliano" -> "cm")
            const acronym = brandTokens.map(w => w[0]).join('');
            this.add(domains, acronym);

            // First 2 letters of each word
            const acro2 = brandTokens.map(w => w.substring(0, 2)).join('');
            this.add(domains, acro2);

            // First word + acronym of rest
            if (brandTokens.length > 2) {
                const firstPlusAcro = brandTokens[0] + brandTokens.slice(1).map(w => w[0]).join('');
                this.add(domains, firstPlusAcro);
            }
        }

        // 4. City Append/Prepend (very common in ITA local businesses)
        if (cleanCity) {
            this.add(domains, `${cleanName}${cleanCity}`);
            this.add(domains, `${cleanCity}${cleanName}`);

            // First word + city
            if (brandTokens.length > 0) {
                this.add(domains, `${brandTokens[0]}${cleanCity}`);
            }

            // Acronym + city
            if (brandTokens.length > 1) {
                const acronym = brandTokens.map(w => w[0]).join('');
                this.add(domains, `${acronym}${cleanCity}`);
                this.add(domains, `${acronym}-${cleanCity}`);
            }
        }

        // 5. Descriptors + Brand (e.g., "Autofficina Coffani")
        if (ner.descriptors.length > 0) {
            const primaryDesc = ner.descriptors[0];
            this.add(domains, `${primaryDesc}${cleanName}`);
            this.add(domains, `${cleanName}${primaryDesc}`);
            this.add(domains, `${primaryDesc}-${cleanName}`);
        }

        // Convert the Set to a unique array, filtering out any extremely short domains (< 3 chars)
        // to avoid resolving entire TLD blocks unnecessarily.
        return Array.from(domains).filter(d => d.length >= 3 && d.length <= 60);
    }

    private static add(domains: Set<string>, base: string) {
        if (!base || base.length < 2) return;
        const cleanBase = base.replace(/^-|-$/g, '').replace(/-{2,}/g, '-');
        if (cleanBase.length < 2) return;

        for (const tld of this.TLDS) {
            domains.add(`${cleanBase}${tld}`);
        }
    }
}
