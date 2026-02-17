/**
 * Strategy pattern interface for domain generation.
 * Each strategy generates candidate domains from company data.
 */
export interface DomainGenerationStrategy {
    readonly name: string;
    generate(ctx: GenerationContext): string[];
}

export interface GenerationContext {
    companyName: string;
    cleanName: string;          // Normalized, stop-words removed
    ultraCleanName: string;     // No spaces, no dashes, no special chars
    city: string;
    cleanCity: string;
    province: string;
    cleanProvince: string;
    category: string;
    cleanCategory: string;
    words: string[];            // Meaningful tokens (>= 3 chars, no generic words)
    firstWord: string;
    secondWord: string;
}
