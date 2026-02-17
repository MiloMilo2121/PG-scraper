
/**
 * 🔮 HYPER GUESSER V2 🔮
 * Generates high-probability domain variations.
 * Enhanced with "Clean Name" logic and International TLDs.
 */
export class HyperGuesser {

    // Common Italian corporate suffixes to strip
    private static STOP_WORDS = [
        'srl', 's.r.l.', 'spa', 's.p.a.', 'snc', 's.n.c.', 'sas', 's.a.s.',
        'societa', 'ditta', 'impresa', 'studio', 'officina', 'di', 'e', '&',
        'ltd', 'gmbh', 'co'
    ];

    // Selective Stop Words: Removed only in normalization, but kept for variation generation if meaningful
    private static SELECTIVE_STOP_WORDS = [
        'group', 'gruppo', 'solutions', 'service', 'servizi', 'systems', 'sistemi'
    ];

    private static GENERIC_WORDS = new Set([
        'azienda',
        'servizi',
        'service',
        'solutions',
        'italia',
        'official',
    ]);

    /**
     * Generates a list of potential domains for a company.
     */
    static generate(companyName: string, city: string, province: string, category: string): string[] {
        const domains = new Set<string>();
        const suffixes = ['.it', '.com', '.eu', '.net'];

        // 1. Normalize Inputs
        const cleanName = this.normalize(companyName);

        // Strategy: Handle "&" -> "e"
        const nameWithAnd = companyName.toLowerCase().replace(/&/g, 'e');
        const cleanNameAnd = this.normalize(nameWithAnd);

        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, ''); // No spaces/dashes
        const ultraCleanNameAnd = cleanNameAnd.replace(/[^a-z0-9]/g, '');

        const cleanCity = this.normalize(city).replace(/\s/g, '');
        const cleanProvince = province.toLowerCase().trim();
        const cleanCategory = this.normalize(category).replace(/\s/g, '');
        const words = cleanName.split(' ').filter((word) => word.length >= 2 && !this.GENERIC_WORDS.has(word)); // Allow 2-char words (e.g. "2M")
        const firstWord = words[0] || cleanName.split(' ')[0];
        const secondWord = words.length > 1 ? words[1] : '';

        // 2. Exact Match Variations (Standard)
        this.addVariations(domains, cleanName.replace(/\s/g, ''), suffixes); // pavireflex.it
        this.addVariations(domains, cleanName.replace(/\s/g, '-'), suffixes); // pavi-reflex.it

        // 2b. Phonetic "&" -> "e" variation
        if (companyName.includes('&')) {
            this.addVariations(domains, ultraCleanNameAnd, suffixes); // marioefigli.it
        }

        // 3. Ultra Clean (Aggressive - Removing ALL stop words including selective)
        if (ultraCleanName.length > 3) {
            this.addVariations(domains, ultraCleanName, suffixes);
        }

        const ultraCleanFully = this.normalizeFully(cleanName).replace(/[^a-z0-9]/g, '');
        if (ultraCleanFully.length > 3 && ultraCleanFully !== ultraCleanName) {
            this.addVariations(domains, ultraCleanFully, suffixes);
        }

        // 4. City/Province Combinations
        if (cleanCity) {
            this.addVariations(domains, `${ultraCleanName}${cleanCity}`, suffixes);
            this.addVariations(domains, `${ultraCleanName}-${cleanCity}`, suffixes);
            // Also try with fully normalized name
            if (ultraCleanFully !== ultraCleanName) {
                this.addVariations(domains, `${ultraCleanFully}${cleanCity}`, suffixes);
            }
            this.addVariations(domains, `${ultraCleanName}${cleanProvince}`, suffixes);
            this.addVariations(domains, `${cleanCity}${ultraCleanName}`, suffixes);
        }

        // 5. First Word Strategy (Riskier but high recall if the first token is meaningful)
        if (firstWord.length >= 3) {
            this.addVariations(domains, firstWord, ['.it', '.com']);
            if (cleanCity) {
                this.addVariations(domains, `${firstWord}${cleanCity}`, suffixes);
                this.addVariations(domains, `${firstWord}-${cleanCity}`, suffixes);
            }
            if (cleanCategory.length >= 4) {
                this.addVariations(domains, `${firstWord}${cleanCategory}`, ['.it', '.com']);
            }
        }

        // 6. Multi-word combinations (Artisan SMBs)
        if (firstWord && secondWord) {
            this.addVariations(domains, `${firstWord}${secondWord}`, ['.it', '.com']);
            this.addVariations(domains, `${firstWord}-${secondWord}`, ['.it', '.com']);
            if (cleanCity) {
                this.addVariations(domains, `${firstWord}${secondWord}${cleanCity}`, ['.it', '.com']);
            }
        }

        // 7. "Italia" Suffix
        this.addVariations(domains, `${ultraCleanName}italia`, suffixes);
        this.addVariations(domains, `${firstWord}italia`, suffixes);

        // 8. Category & Generic Suffixes (NEW)
        if (cleanCategory.length >= 3) {
            this.addVariations(domains, `${ultraCleanName}${cleanCategory}`, ['.it', '.com']);
            // e.g. "startuplab" -> "startup" + "lab"
        }

        // 9. Selective Stop Words as Suffixes (Recovered Logic)
        // e.g. "Rossi Group" -> "rossigroup.it" (kept by normalize) vs "rossi.it" (handled by normalizeFully)
        for (const selective of this.SELECTIVE_STOP_WORDS) {
            if (cleanName.includes(selective)) {
                this.addVariations(domains, cleanName.replace(/\s/g, ''), suffixes);
            }
        }

        // 9. Acronym Strategy (NEW)
        // "Officine Meccaniche Rossi" -> "OMR"
        if (words.length >= 2) {
            const acronym = words.map(w => w[0]).join('');
            if (acronym.length >= 3) {
                this.addVariations(domains, acronym, ['.it', '.com']); // omr.it
                if (cleanCity) {
                    this.addVariations(domains, `${acronym}${cleanCity}`, ['.it', '.com']); // omrmilano.it
                    this.addVariations(domains, `${acronym}-${cleanCity}`, ['.it', '.com']); // omr-milano.it
                }
                this.addVariations(domains, `${acronym}srl`, ['.it']); // omrsrl.it
            }
        }

        // 10. Common Corporate Suffixes (NEW)
        // sometimes they include "srl" in the domain
        this.addVariations(domains, `${ultraCleanName}srl`, ['.it', '.com']);

        // Stable ranking: shorter and cleaner domains first.
        const ranked = Array.from(domains)
            .filter((domain) => domain.length <= 70)
            .sort((a, b) => {
                const aHost = a.replace(/^https?:\/\//, '').replace(/^www\./, '');
                const bHost = b.replace(/^https?:\/\//, '').replace(/^www\./, '');
                // Penalize dashes slightly in sorting to prefer cleaner domains
                const aDashes = (aHost.match(/-/g) || []).length;
                const bDashes = (bHost.match(/-/g) || []).length;
                if (aHost.length !== bHost.length) return aHost.length - bHost.length;
                return aDashes - bDashes;
            });

        return ranked.slice(0, 150); // Increased limit from 80 to 150 to accommodate new strategies
    }

    private static normalize(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        // Remove mandatory stop words (e.g. srl, spa)
        // Sort stop words by length desc to handle "s.r.l." before "srl"
        const sortedStop = [...this.STOP_WORDS].sort((a, b) => b.length - a.length);
        for (const stop of sortedStop) {
            const escaped = stop.replace(/\./g, '\\.');
            const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
            norm = norm.replace(regex, '');
        }

        // Remove dots but keep spaces
        norm = norm.replace(/\./g, '');

        return norm
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Aggressive normalization including Selective Stop Words (for pure domain generation)
     */
    private static normalizeFully(text: string): string {
        let norm = this.normalize(text);
        for (const stop of this.SELECTIVE_STOP_WORDS) {
            const regex = new RegExp(`\\b${stop}\\b`, 'gi');
            norm = norm.replace(regex, '');
        }
        return norm.replace(/\s+/g, '').trim();
    }

    private static addVariations(set: Set<string>, base: string, suffixes: string[]) {
        if (!base || base.length < 3) return;
        const safeBase = base
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        if (safeBase.length < 3) return;
        suffixes.forEach(s => {
            set.add(`https://www.${safeBase}${s}`);
            set.add(`https://${safeBase}${s}`);
        });
    }
}
