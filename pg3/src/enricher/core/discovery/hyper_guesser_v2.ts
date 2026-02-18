/**
 * HYPER GUESSER V3
 * Strategy-based domain generation engine.
 * Orchestrates multiple generation strategies for maximum coverage.
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

    private static strategies: DomainGenerationStrategy[] = [
        new PhoneticStrategy(),
        new AcronymStrategy(),
        new SectorStrategy(),
        new LocationStrategy()
    ];

    /**
     * Generates a list of potential domains for a company using all registered strategies.
     */
    static generate(companyName: string, city: string, province: string, category: string): string[] {
        const domains = new Set<string>();

        // 1. Prepare Context
        const ctx: GenerationContext = this.buildContext(companyName, city, province, category);

        // 2. Base Variations (Legacy Core Logic - kept for stability)
        this.generateBaseVariations(ctx, domains);

        // 3. Execute Strategies
        for (const strategy of this.strategies) {
            try {
                const candidates = strategy.generate(ctx);
                candidates.forEach((d) => this.addVariations(domains, d, ['.it', '.com', '.eu']));
            } catch (e) {
                // Strategy failure shouldn't crash the whole guesser
                console.warn(`[HyperGuesser] Strategy ${strategy.name} failed:`, e);
            }
        }

        // Smart ranking: .it first (most likely for Italian SMEs), then by length, then penalize dashes.
        const ranked = Array.from(domains)
            .filter((domain) => domain.length <= 70)
            .sort((a, b) => {
                const aHost = a.replace(/^https?:\/\//, '').replace(/^www\./, '');
                const bHost = b.replace(/^https?:\/\//, '').replace(/^www\./, '');
                // Prefer .it TLD (most common for Italian companies)
                const aIsIt = aHost.endsWith('.it') ? 0 : 1;
                const bIsIt = bHost.endsWith('.it') ? 0 : 1;
                if (aIsIt !== bIsIt) return aIsIt - bIsIt;
                // Then by length (shorter = more likely)
                if (aHost.length !== bHost.length) return aHost.length - bHost.length;
                // Penalize dashes slightly to prefer cleaner domains
                const aDashes = (aHost.match(/-/g) || []).length;
                const bDashes = (bHost.match(/-/g) || []).length;
                return aDashes - bDashes;
            });

        return ranked.slice(0, 80);
    }

    private static buildContext(name: string, city: string, province: string, category: string): GenerationContext {
        const cleanName = this.normalize(name);
        const ultraCleanName = cleanName.replace(/[^a-z0-9]/g, '');
        const words = cleanName.split(' ').filter((word) => word.length >= 2 && !this.GENERIC_WORDS.has(word));

        return {
            companyName: name,
            cleanName,
            ultraCleanName,
            city: this.normalize(city),
            cleanCity: this.normalize(city).replace(/\s/g, ''),
            province: province.toLowerCase().trim(),
            cleanProvince: province.toLowerCase().trim(),
            category: this.normalize(category),
            cleanCategory: this.normalize(category).replace(/\s/g, ''),
            words,
            firstWord: words[0] || cleanName.split(' ')[0],
            secondWord: words.length > 1 ? words[1] : ''
        };
    }

    private static generateBaseVariations(ctx: GenerationContext, domains: Set<string>) {
        const suffixes = ['.it', '.com', '.eu'];
        const { cleanName, ultraCleanName } = ctx;

        // Exact Match
        this.addVariations(domains, cleanName.replace(/\s/g, ''), suffixes);
        this.addVariations(domains, cleanName.replace(/\s/g, '-'), suffixes);

        // Ultra Clean
        if (ultraCleanName.length > 3) {
            this.addVariations(domains, ultraCleanName, suffixes);
        }

        // Selective Stop Words Logic: try with selective words kept
        const nameWithSelective = this.normalizeWithSelectiveStopWords(ctx.companyName);
        if (nameWithSelective && nameWithSelective !== cleanName.replace(/\s/g, '')) {
            this.addVariations(domains, nameWithSelective.replace(/\s/g, ''), suffixes);
        }
    }

    /**
     * Normalize with selective stop words KEPT (e.g., "Rossi Group" -> "rossigroup")
     */
    private static normalizeWithSelectiveStopWords(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Strip dots first so "s.r.l." becomes "srl", then matching works
        norm = norm.replace(/\./g, ' ');
        norm = this.normalizeCorporateAbbreviations(norm);
        for (const stop of this.STOP_WORDS) {
            const plain = stop.replace(/\./g, '');
            const regex = new RegExp(`(?:^|\\s)${plain}(?:\\s|$)`, 'gi');
            norm = norm.replace(regex, ' ');
        }
        return norm.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
    }

    /* Helper Methods */

    public static normalize(text: string): string {
        if (!text) return '';
        let norm = text.toLowerCase();
        norm = norm.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Strip dots first so "s.r.l." becomes "srl", then word-boundary matching works
        norm = norm.replace(/\./g, ' ');
        norm = this.normalizeCorporateAbbreviations(norm);
        const allStops = [...this.STOP_WORDS, ...this.SELECTIVE_STOP_WORDS];
        for (const stop of allStops) {
            const plain = stop.replace(/\./g, '');
            const regex = new RegExp(`(?:^|\\s)${plain}(?:\\s|$)`, 'gi');
            norm = norm.replace(regex, ' ');
        }

        norm = norm.replace(/\./g, '');
        return norm.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
    }

    private static normalizeCorporateAbbreviations(text: string): string {
        return text
            .replace(/\bs\s*r\s*l\b/gi, 'srl')
            .replace(/\bs\s*p\s*a\b/gi, 'spa')
            .replace(/\bs\s*n\s*c\b/gi, 'snc')
            .replace(/\bs\s*a\s*s\b/gi, 'sas');
    }

    public static normalizeFully(text: string): string {
        let norm = this.normalize(text);
        for (const stop of this.SELECTIVE_STOP_WORDS) {
            const regex = new RegExp(`\\b${stop}\\b`, 'gi');
            norm = norm.replace(regex, '');
        }
        return norm.replace(/\s+/g, '').trim();
    }

    private static addVariations(set: Set<string>, base: string, suffixes: string[]) {
        if (!base || base.length < 3) return;
        const safeBase = base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (safeBase.length < 3) return;
        suffixes.forEach(s => {
            set.add(`https://www.${safeBase}${s}`);
            set.add(`https://${safeBase}${s}`);
        });
    }
}
