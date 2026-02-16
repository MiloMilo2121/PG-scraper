import { DomainGenerationStrategy, GenerationContext } from './strategy_types';

/**
 * Phonetic Normalization Strategy
 *
 * Handles Italian phonetic variations:
 * - "Caffe" -> "caffe"
 * - "L'Angolo" -> "langolo" AND "angolo"
 * - "& C." -> "ec" AND stripped
 * - Accented characters -> ASCII equivalents
 * - Apostrophes in names (common in Italian: "dell'", "l'", "d'")
 */
export class PhoneticStrategy implements DomainGenerationStrategy {
    readonly name = 'phonetic';

    generate(ctx: GenerationContext): string[] {
        const domains: string[] = [];
        const rawName = ctx.companyName.toLowerCase();

        // 1. Handle apostrophe contractions (L'Angolo -> langolo + angolo)
        const apostropheVariants = this.expandApostrophes(rawName);

        // 2. Handle "&" and "e" interchangeability
        const ampersandVariants = this.expandAmpersand(rawName);

        // 3. Handle common phonetic simplifications
        const phoneticVariants = this.applyPhoneticRules(rawName);

        const allVariants = new Set([...apostropheVariants, ...ampersandVariants, ...phoneticVariants]);

        for (const variant of allVariants) {
            const clean = this.sanitize(variant);
            if (clean.length >= 3) {
                domains.push(clean);
            }
        }

        return domains;
    }

    private expandApostrophes(name: string): string[] {
        const results: string[] = [];

        // Common Italian articles with apostrophe
        const contractions = [
            { pattern: /l[''](\w)/g, joined: 'l$1', split: '$1' },
            { pattern: /d[''](\w)/g, joined: 'd$1', split: '$1' },
            { pattern: /dell[''](\w)/g, joined: 'dell$1', split: '$1' },
            { pattern: /all[''](\w)/g, joined: 'all$1', split: '$1' },
            { pattern: /nell[''](\w)/g, joined: 'nell$1', split: '$1' },
            { pattern: /sull[''](\w)/g, joined: 'sull$1', split: '$1' },
        ];

        for (const { pattern, joined, split } of contractions) {
            if (pattern.test(name)) {
                results.push(name.replace(new RegExp(pattern.source, 'g'), joined));
                results.push(name.replace(new RegExp(pattern.source, 'g'), split));
            }
        }

        // Generic: just strip all apostrophes
        if (name.includes("'") || name.includes('\u2019')) {
            results.push(name.replace(/['\u2019]/g, ''));
        }

        return results;
    }

    private expandAmpersand(name: string): string[] {
        const results: string[] = [];

        if (name.includes('&')) {
            // "Rossi & C." -> "rossiec", "rossi"
            results.push(name.replace(/\s*&\s*c\.?\s*/gi, 'ec'));
            results.push(name.replace(/\s*&\s*c\.?\s*/gi, ''));
            // Generic: "A & B" -> "aeb", "ab"
            results.push(name.replace(/\s*&\s*/g, 'e'));
            results.push(name.replace(/\s*&\s*/g, ''));
        }

        return results;
    }

    private applyPhoneticRules(name: string): string[] {
        const results: string[] = [];

        // Double consonants simplification (sometimes domains drop doubles)
        const simplified = name.replace(/(.)\1/g, '$1');
        if (simplified !== name) {
            results.push(simplified);
        }

        // "ph" -> "f" (rare in Italian but exists in brand names)
        if (name.includes('ph')) {
            results.push(name.replace(/ph/g, 'f'));
        }

        // "ck" -> "k" or "c"
        if (name.includes('ck')) {
            results.push(name.replace(/ck/g, 'k'));
            results.push(name.replace(/ck/g, 'c'));
        }

        return results;
    }

    private sanitize(text: string): string {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }
}
