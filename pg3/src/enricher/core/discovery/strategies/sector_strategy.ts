import { DomainGenerationStrategy, GenerationContext } from './strategy_types';

/**
 * Sector Suffixing Strategy
 *
 * Appends industry-specific suffixes to company names:
 * - If Category = "Edilizia" -> {name}costruzioni.it, {name}edilizia.it
 * - If Category = "Ristorazione" -> {name}ristorante.it
 * - If Category = "Meccanica" -> {name}meccanica.it
 */
export class SectorStrategy implements DomainGenerationStrategy {
    readonly name = 'sector';

    // Category -> possible domain suffixes
    private static SECTOR_SUFFIXES: Record<string, string[]> = {
        // Construction & Building
        edilizia: ['costruzioni', 'edilizia', 'ristrutturazioni', 'edil', 'build'],
        costruzioni: ['costruzioni', 'edilizia', 'edil'],
        impiantistica: ['impianti', 'impiantistica', 'termoidraulica'],
        idraulica: ['impianti', 'idraulica', 'termoidraulica'],
        elettricista: ['impianti', 'elettrica', 'elettricista'],

        // Food & Restaurant
        ristorazione: ['ristorante', 'trattoria', 'pizzeria', 'food', 'cucina'],
        alimentari: ['alimentari', 'food', 'gastronomia'],
        pasticceria: ['pasticceria', 'dolci', 'bakery'],
        panificio: ['panificio', 'forno', 'bakery'],

        // Manufacturing
        meccanica: ['meccanica', 'officina', 'meccaniche'],
        meccatronica: ['meccatronica', 'meccanica', 'automazione'],
        manifattura: ['manifattura', 'produzione', 'manufacturing'],
        metalmeccanica: ['metalmeccanica', 'meccanica', 'metal'],
        plastica: ['plastica', 'plastiche', 'stampaggio'],
        tessile: ['tessile', 'tessuti', 'textile'],

        // Services
        consulenza: ['consulting', 'consulenza', 'advisory'],
        informatica: ['informatica', 'software', 'tech', 'digital'],
        trasporti: ['trasporti', 'logistica', 'transport', 'spedizioni'],
        pulizie: ['pulizie', 'cleaning', 'servizi'],
        giardinaggio: ['giardini', 'verde', 'garden'],

        // Automotive
        autofficina: ['auto', 'autofficina', 'carrozzeria'],
        carrozzeria: ['carrozzeria', 'auto', 'car'],
        autonoleggio: ['noleggio', 'rent', 'autonoleggio'],

        // Health & Beauty
        farmacia: ['farmacia', 'pharma', 'salute'],
        estetica: ['estetica', 'beauty', 'benessere'],
        dentista: ['dental', 'dentista', 'odontoiatria'],

        // Real Estate
        immobiliare: ['immobiliare', 'casa', 'realestate'],

        // Agriculture
        agricoltura: ['agricola', 'aziendaagricola', 'farm'],
    };

    generate(ctx: GenerationContext): string[] {
        const domains: string[] = [];
        const categoryLower = ctx.category.toLowerCase().trim();

        if (!categoryLower) return domains;

        // Find matching sector suffixes
        const suffixes = this.findSectorSuffixes(categoryLower);
        if (suffixes.length === 0) return domains;

        const baseName = ctx.ultraCleanName;
        const firstName = ctx.firstWord;

        for (const suffix of suffixes) {
            // Skip if name already ends with this suffix
            if (baseName.endsWith(suffix)) continue;

            // {name}{suffix}
            if (baseName.length >= 3) {
                domains.push(`${baseName}${suffix}`);
            }

            // {firstName}{suffix} (if multi-word name)
            if (firstName && firstName !== baseName && firstName.length >= 3) {
                domains.push(`${firstName}${suffix}`);
            }
        }

        return domains;
    }

    private findSectorSuffixes(category: string): string[] {
        // Direct match
        if (SectorStrategy.SECTOR_SUFFIXES[category]) {
            return SectorStrategy.SECTOR_SUFFIXES[category];
        }

        // Partial match (category contains a known key)
        for (const [key, suffixes] of Object.entries(SectorStrategy.SECTOR_SUFFIXES)) {
            if (category.includes(key) || key.includes(category)) {
                return suffixes;
            }
        }

        return [];
    }
}
