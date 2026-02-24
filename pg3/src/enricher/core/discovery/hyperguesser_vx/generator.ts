/**
 * HYPER GUESSER VX - GENERATOR
 * Generates an aggressive, massive amount of domain permutations.
 * Does not check validity, just generates potential targets.
 */

import { CompanyInput } from '../../../types';

export class HyperGuesserVXGenerator {
    private static STOP_WORDS = [
        'srl', 's.r.l.', 'spa', 's.p.a.', 'snc', 's.n.c.', 'sas', 's.a.s.',
        'societa', 'ditta', 'impresa', 'studio', 'officina', 'di', 'e', '&',
        'ltd', 'gmbh', 'co', 'srls', 's.r.l.s.'
    ];

    private static TLDS = ['.it', '.com', '.eu', '.net', '.org', '.srl'];

    /**
     * Generates up to ~200 domain permutations for a company
     */
    static generate(company: CompanyInput): string[] {
        const domains = new Set<string>();
        const name = company.company_name || '';
        const city = company.city || '';

        if (!name) return [];

        // 1. Core cleanups
        const cleanName = this.normalize(name);
        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, '');
        const words = cleanName.split(' ').filter(w => w.length > 1);
        const cleanCity = this.normalize(city).replace(/[^a-z0-9]/g, '');

        // 2. Base Permutations
        this.add(domains, ultraCleanName);
        this.add(domains, cleanName.replace(/\s+/g, '-'));

        // 3. Ultra Aggressive Acronyms (if multi-word)
        if (words.length > 1) {
            // First letters only (e.g. "Autofficina Coffani" -> "ac")
            const acronym = words.map(w => w[0]).join('');
            this.add(domains, acronym);

            // First 2 letters of each word
            const acro2 = words.map(w => w.substring(0, 2)).join('');
            this.add(domains, acro2);

            // First word + acronym of rest
            if (words.length > 2) {
                const firstPlusAcro = words[0] + words.slice(1).map(w => w[0]).join('');
                this.add(domains, firstPlusAcro);
            }
        }

        // 4. City Append/Prepend (very common in IT)
        if (cleanCity) {
            this.add(domains, `${ultraCleanName}${cleanCity}`);
            this.add(domains, `${cleanCity}${ultraCleanName}`);

            // First word + city
            if (words.length > 0) {
                this.add(domains, `${words[0]}${cleanCity}`);
            }

            // Acronym + city
            if (words.length > 1) {
                const acronym = words.map(w => w[0]).join('');
                this.add(domains, `${acronym}${cleanCity}`);
                this.add(domains, `${acronym}-${cleanCity}`);
            }
        }

        // 5. Word skipping (for names like "Studio Legale Rossi" -> "studiorossi", "legalerossi")
        if (words.length > 1) {
            for (let i = 0; i < words.length; i++) {
                const skipped = [...words.slice(0, i), ...words.slice(i + 1)].join('');
                this.add(domains, skipped);
            }
            // Just the first two words joined
            this.add(domains, words.slice(0, 2).join(''));
            this.add(domains, words.slice(0, 2).join('-'));

            // Just the first and last word
            if (words.length > 2) {
                this.add(domains, words[0] + words[words.length - 1]);
            }
        }

        // 6. Name with original stop words attached (some people register "rossisrl.it")
        const rawAlphaOnly = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        this.add(domains, rawAlphaOnly);

        // Convert the Set to a unique array, filtering out any extremely short domains (< 3 chars) 
        // to avoid resolving entire TLD blocks.
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

    private static normalize(text: string): string {
        let norm = text.toLowerCase();
        norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove accents
        norm = norm.replace(/\./g, ' '); // Replace dots with spaces for tokenization

        // Remove stop words
        for (const stop of this.STOP_WORDS) {
            const regex = new RegExp(`(?:^|\\s)${stop.replace(/\./g, '')}(?:\\s|$)`, 'gi');
            norm = norm.replace(regex, ' ');
        }

        return norm.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
    }
}
