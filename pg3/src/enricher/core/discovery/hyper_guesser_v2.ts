
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
        'ltd', 'gmbh', 'co', 'group', 'gruppo'
    ];

    /**
     * Generates a list of potential domains for a company.
     */
    static generate(companyName: string, city: string, province: string, category: string): string[] {
        const domains = new Set<string>();
        const suffixes = ['.it', '.com', '.eu', '.net', '.org', '.biz', '.info']; // Expanded TLDs

        // 1. Normalize Inputs
        const cleanName = this.normalize(companyName);
        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, ''); // No spaces/dashes
        const cleanCity = this.normalize(city).replace(/\s/g, '');
        const cleanProvince = province.toLowerCase().trim();
        const firstWord = cleanName.split(' ')[0];

        // 2. Exact Match Variations
        this.addVariations(domains, cleanName.replace(/\s/g, ''), suffixes); // pavireflex.it
        this.addVariations(domains, cleanName.replace(/\s/g, '-'), suffixes); // pavi-reflex.it

        // 3. Ultra Clean (Aggressive)
        if (ultraCleanName.length > 3) {
            this.addVariations(domains, ultraCleanName, suffixes);
        }

        // 4. City/Province Combinations
        if (cleanCity) {
            this.addVariations(domains, `${ultraCleanName}${cleanCity}`, suffixes);
            this.addVariations(domains, `${ultraCleanName}-${cleanCity}`, suffixes);
            this.addVariations(domains, `${ultraCleanName}${cleanProvince}`, suffixes);
        }

        // 5. First Word Strategy (Riskier but high recall)
        if (firstWord.length >= 4) {
            this.addVariations(domains, firstWord, ['.it', '.com']); // Strictly common TLDs to avoid noise
            if (cleanCity) {
                this.addVariations(domains, `${firstWord}${cleanCity}`, suffixes);
                this.addVariations(domains, `${firstWord}-${cleanCity}`, suffixes);
            }
        }

        // 6. "Italia" Suffix
        this.addVariations(domains, `${ultraCleanName}italia`, suffixes);
        this.addVariations(domains, `${firstWord}italia`, suffixes);

        return Array.from(domains);
    }

    private static normalize(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        // Remove stop words
        for (const stop of this.STOP_WORDS) {
            const regex = new RegExp(`\\b${stop}\\b`, 'gi');
            norm = norm.replace(regex, '');
        }
        return norm.trim();
    }

    private static addVariations(set: Set<string>, base: string, suffixes: string[]) {
        if (!base || base.length < 3) return;
        suffixes.forEach(s => {
            set.add(`https://www.${base}${s}`);
            set.add(`https://${base}${s}`);
        });
    }
}
