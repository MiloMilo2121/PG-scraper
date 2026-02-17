import { DomainGenerationStrategy, GenerationContext } from './strategy_types';

/**
 * Acronym Permutation Strategy
 *
 * Generates domain candidates from company name initials:
 * - Standard: "Officine Meccaniche Rossi" -> omr
 * - City-bound: omrmilano, omr-milano
 * - Creative: Drop middle words ("Officine Meccaniche Rossi" -> officinerossi)
 * - First+Last: rossiom, rossiomr
 */
export class AcronymStrategy implements DomainGenerationStrategy {
    readonly name = 'acronym';

    generate(ctx: GenerationContext): string[] {
        const domains: string[] = [];

        if (ctx.words.length < 2) return domains;

        // 1. Standard acronym (all initials)
        const acronym = ctx.words.map(w => w[0]).join('');
        if (acronym.length >= 2 && acronym.length <= 6) {
            domains.push(acronym);

            // City-bound acronyms
            if (ctx.cleanCity) {
                domains.push(`${acronym}${ctx.cleanCity}`);
                domains.push(`${acronym}-${ctx.cleanCity}`);
            }

            // Province-bound
            if (ctx.cleanProvince && ctx.cleanProvince.length === 2) {
                domains.push(`${acronym}${ctx.cleanProvince}`);
            }
        }

        // 2. Creative: skip middle words (first + last)
        if (ctx.words.length >= 3) {
            const firstLast = `${ctx.words[0]}${ctx.words[ctx.words.length - 1]}`;
            if (firstLast.length >= 4) {
                domains.push(firstLast);
            }

            // First two words only
            const firstTwo = `${ctx.words[0]}${ctx.words[1]}`;
            if (firstTwo.length >= 4) {
                domains.push(firstTwo);
            }

            // Last two words only
            if (ctx.words.length >= 3) {
                const lastTwo = `${ctx.words[ctx.words.length - 2]}${ctx.words[ctx.words.length - 1]}`;
                if (lastTwo.length >= 4 && lastTwo !== firstTwo) {
                    domains.push(lastTwo);
                }
            }
        }

        // 3. Acronym + full last word
        if (ctx.words.length >= 2) {
            const lastWord = ctx.words[ctx.words.length - 1];
            const initials = ctx.words.slice(0, -1).map(w => w[0]).join('');
            if (initials.length >= 1 && lastWord.length >= 3) {
                domains.push(`${initials}${lastWord}`);
            }
        }

        return domains;
    }
}
