
/**
 * HYPER GUESSER V3 (Cartesian Product Mutation)
 *
 * Generates high-probability domain variations using a strategy pattern.
 * Strategies: Phonetic, Acronym, Sector, Location + Core heuristics.
 * Enhanced with Italian SME naming conventions.
 */
import { DomainGenerationStrategy, GenerationContext } from './strategies/strategy_types';
import { PhoneticStrategy } from './strategies/phonetic_strategy';
import { AcronymStrategy } from './strategies/acronym_strategy';
import { SectorStrategy } from './strategies/sector_strategy';
import { LocationStrategy } from './strategies/location_strategy';

export class HyperGuesser {

    // Common Italian corporate suffixes to strip
    private static STOP_WORDS = [
        'srl', 's.r.l.', 'spa', 's.p.a.', 'snc', 's.n.c.', 'sas', 's.a.s.',
        'societa', 'ditta', 'impresa', 'studio', 'officina', 'di', 'e', '&',
        'ltd', 'gmbh', 'co',
    ];

    // Words that are sometimes IN the domain, sometimes not — trial both.
    private static SELECTIVE_STOP_WORDS = ['group', 'gruppo', 'holding', 'italia', 'systems', 'solutions'];

    private static GENERIC_WORDS = new Set([
        'azienda',
        'servizi',
        'service',
        'solutions',
        'official',
    ]);

    // Pluggable strategies
    private static strategies: DomainGenerationStrategy[] = [
        new PhoneticStrategy(),
        new AcronymStrategy(),
        new SectorStrategy(),
        new LocationStrategy(),
    ];

    /**
     * Generates a list of potential domains for a company.
     */
    static generate(companyName: string, city: string, province: string, category: string): string[] {
        const domains = new Set<string>();
        const suffixes = ['.it', '.com', '.eu', '.net', '.info'];

        // 1. Normalize Inputs
        const cleanName = this.normalize(companyName);
        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, '');
        const cleanCity = this.normalize(city).replace(/\s/g, '');
        const cleanProvince = province.toLowerCase().trim();
        const cleanCategory = this.normalize(category).replace(/\s/g, '');
        const words = cleanName.split(' ').filter((word) => word.length >= 3 && !this.GENERIC_WORDS.has(word));
        const firstWord = words[0] || cleanName.split(' ')[0];
        const secondWord = words.length > 1 ? words[1] : '';

        const ctx: GenerationContext = {
            companyName,
            cleanName,
            ultraCleanName,
            city,
            cleanCity,
            province,
            cleanProvince,
            category,
            cleanCategory,
            words,
            firstWord,
            secondWord,
        };

        // ===== CORE HEURISTICS (Original logic, preserved) =====

        // 2. Exact Match Variations
        this.addVariations(domains, cleanName.replace(/\s/g, ''), suffixes);
        this.addVariations(domains, cleanName.replace(/\s/g, '-'), suffixes);

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

        // 5. First Word Strategy
        if (firstWord.length >= 4) {
            this.addVariations(domains, firstWord, ['.it', '.com']);
            if (cleanCity) {
                this.addVariations(domains, `${firstWord}${cleanCity}`, suffixes);
                this.addVariations(domains, `${firstWord}-${cleanCity}`, suffixes);
            }
            if (cleanCategory.length >= 4) {
                this.addVariations(domains, `${firstWord}${cleanCategory}`, ['.it', '.com']);
            }
        }

        // 6. Multi-word combinations
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

        // ===== NEW: Selective Stop Word trials =====
        // "Rossi Group" -> try rossigroup.it AND rossi.it
        const nameWithSelective = this.normalizeWithSelectiveStopWords(companyName);
        if (nameWithSelective !== cleanName) {
            const ultraWithSelective = nameWithSelective.replace(/[^a-z0-9]/g, '');
            if (ultraWithSelective.length >= 3) {
                this.addVariations(domains, ultraWithSelective, ['.it', '.com']);
            }
        }

        // ===== STRATEGY-GENERATED DOMAINS =====
        for (const strategy of this.strategies) {
            const strategyDomains = strategy.generate(ctx);
            for (const domain of strategyDomains) {
                this.addVariations(domains, domain, ['.it', '.com']);
            }
        }

        // Smart ranking: .it first (most likely for Italian SMEs), then by length.
        const ranked = Array.from(domains)
            .filter((domain) => domain.length <= 70)
            .sort((a, b) => {
                const aHost = a.replace(/^https?:\/\//, '').replace(/^www\./, '');
                const bHost = b.replace(/^https?:\/\//, '').replace(/^www\./, '');
                // Prefer .it TLD (most common for Italian companies)
                const aIsIt = aHost.endsWith('.it') ? 0 : 1;
                const bIsIt = bHost.endsWith('.it') ? 0 : 1;
                if (aIsIt !== bIsIt) return aIsIt - bIsIt;
                return aHost.length - bHost.length;
            });

        return ranked.slice(0, 120);
    }

    /**
     * Normalize with selective stop words KEPT (e.g., "Rossi Group" -> "rossigroup")
     */
    private static normalizeWithSelectiveStopWords(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Strip dots first so "s.r.l." becomes "srl", then \b works correctly
        norm = norm.replace(/\./g, ' ');
        for (const stop of this.STOP_WORDS) {
            const plain = stop.replace(/\./g, '');
            const regex = new RegExp(`(?:^|\\s)${plain}(?:\\s|$)`, 'gi');
            norm = norm.replace(regex, ' ');
        }
        return norm.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
    }

    static normalize(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Strip dots first so "s.r.l." becomes "srl", then word-boundary matching works
        norm = norm.replace(/\./g, ' ');
        const allStops = [...this.STOP_WORDS, ...this.SELECTIVE_STOP_WORDS];
        for (const stop of allStops) {
            const plain = stop.replace(/\./g, '');
            const regex = new RegExp(`(?:^|\\s)${plain}(?:\\s|$)`, 'gi');
            norm = norm.replace(regex, ' ');
        }
        return norm
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static addVariations(set: Set<string>, base: string, suffixes: string[]) {
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
