
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
        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, ''); // No spaces/dashes
        const cleanCity = this.normalize(city).replace(/\s/g, '');
        const cleanProvince = province.toLowerCase().trim();
        const cleanCategory = this.normalize(category).replace(/\s/g, '');
        const words = cleanName.split(' ').filter((word) => word.length >= 3 && !this.GENERIC_WORDS.has(word));
        const firstWord = words[0] || cleanName.split(' ')[0];
        const secondWord = words.length > 1 ? words[1] : '';

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
            this.addVariations(domains, `${cleanCity}${ultraCleanName}`, suffixes);
        }

        // 5. First Word Strategy (Riskier but high recall if the first token is meaningful)
        if (firstWord.length >= 4) {
            this.addVariations(domains, firstWord, ['.it', '.com']); // Strictly common TLDs to avoid noise
            if (cleanCity) {
                this.addVariations(domains, `${firstWord}${cleanCity}`, suffixes);
                this.addVariations(domains, `${firstWord}-${cleanCity}`, suffixes);
            }
            if (cleanCategory.length >= 4) {
                this.addVariations(domains, `${firstWord}${cleanCategory}`, ['.it', '.com']);
            }
        }

        // 6. Multi-word combinations are common for artisan SMBs
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
        if (cleanCategory.length >= 4) {
            this.addVariations(domains, `${ultraCleanName}${cleanCategory}`, ['.it', '.com']);
        }

        // Stable ranking: shorter and cleaner domains first.
        const ranked = Array.from(domains)
            .filter((domain) => domain.length <= 70)
            .sort((a, b) => {
                const aHost = a.replace(/^https?:\/\//, '').replace(/^www\./, '');
                const bHost = b.replace(/^https?:\/\//, '').replace(/^www\./, '');
                return aHost.length - bHost.length;
            });

        return ranked.slice(0, 80);
    }

    private static normalize(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        // Remove stop words
        for (const stop of this.STOP_WORDS) {
            const regex = new RegExp(`\\b${stop}\\b`, 'gi');
            norm = norm.replace(regex, '');
        }
        return norm
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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
