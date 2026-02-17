import { DomainGenerationStrategy, GenerationContext } from './strategy_types';

/**
 * Location Strategy
 *
 * Generates domain candidates using geographic combinations:
 * - {name}{city}, {city}{name}
 * - {name}{province}
 * - Handles Italian province abbreviations (MI, TO, RM, etc.)
 */
export class LocationStrategy implements DomainGenerationStrategy {
    readonly name = 'location';

    generate(ctx: GenerationContext): string[] {
        const domains: string[] = [];

        if (!ctx.cleanCity && !ctx.cleanProvince) return domains;

        const base = ctx.ultraCleanName;
        const firstName = ctx.firstWord;

        if (base.length < 3) return domains;

        // 1. Name + City variations
        if (ctx.cleanCity && ctx.cleanCity.length >= 2) {
            domains.push(`${base}${ctx.cleanCity}`);
            domains.push(`${base}-${ctx.cleanCity}`);
            domains.push(`${ctx.cleanCity}${base}`);

            // First word + city
            if (firstName && firstName.length >= 3 && firstName !== base) {
                domains.push(`${firstName}${ctx.cleanCity}`);
                domains.push(`${firstName}-${ctx.cleanCity}`);
            }
        }

        // 2. Name + Province (2-letter abbreviation)
        if (ctx.cleanProvince && ctx.cleanProvince.length >= 2) {
            const prov = ctx.cleanProvince.slice(0, 2).toLowerCase();
            domains.push(`${base}${prov}`);
            domains.push(`${base}-${prov}`);

            // Full province name if different from city
            if (ctx.cleanProvince.length > 2 && ctx.cleanProvince !== ctx.cleanCity) {
                domains.push(`${base}${ctx.cleanProvince}`);
            }
        }

        return domains;
    }
}
