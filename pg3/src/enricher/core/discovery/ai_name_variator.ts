import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { LLMService } from '../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../ai/model_router';
import { LLMCache } from '../ai/llm_cache';
import { config } from '../../config';

export class AINameVariator {
    /**
     * 🧠 AI NAME VARIATOR
     * Leverages a fast LLM (GPT-4o-mini) to generate semantic aliases for a company name.
     * Often company names in databases are technical (e.g., "M.R. DI ROSSI MARCO S.A.S.")
     * while their websites are branded (e.g., "Marco Rossi Impianti").
     */
    static async generateVariants(company: CompanyInput): Promise<string[]> {
        if (!config.features.aiVariantsEnabled) {
            return [];
        }

        const rawName = company.company_name;
        if (!rawName || rawName.length < 3) return [];

        try {
            const prompt = `
You are an Italian corporate data specialist.
Target Company: "${company.company_name}"
Location: "${company.city || ''} (${company.province || ''})"
Category/Sector: "${company.category || ''}"

Generate exactly 3 "branded" search variants for this company that would be highly effective for a Google Search to find its website.
Rules:
1. Strip all legal entities (SRL, SPA, SAS, SNC, DI, IMPRESA INDIVIDUALE).
2. Expand acronyms if obvious based on sector.
3. If the name contains a person's name (e.g., "M.R. DI MARCO ROSSI"), extract just the brand or full name ("Marco Rossi").
4. Add the sector or city ONLY if the name is too generic (e.g. "Rossi" -> "Rossi Idraulica").
5. Return ONLY a JSON array of exactly 3 strings. Example: ["Brand Name", "Brand Name Sector", "Brand Name City"]

JSON Array:
`;
            const cache = LLMCache.getInstance();
            const model = ModelRouter.selectModel(TaskDifficulty.SIMPLE);

            // Check cache
            const cacheKey = `variants|${company.company_name}|${company.city || ''}`;
            const cachedBody = await cache.get(cacheKey, model);

            if (cachedBody) {
                try {
                    const parsed = JSON.parse(cachedBody);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        Logger.info(`[AIVariator] ⚡ Cache Hit for "${rawName}": ${parsed.join(', ')}`);
                        return parsed;
                    }
                } catch { /* Ignore cache parse err */ }
            }

            // Call LLM
            Logger.info(`[AIVariator] 🧠 Generating variants for "${rawName}" using ${model}...`);
            const response = await LLMService.complete(prompt, model);
            const clean = response.replace(/```json/gi, '').replace(/```/g, '').trim();

            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Ensure unique variants and exclude the exact original name
                const unique = Array.from(new Set(parsed)).filter(v =>
                    typeof v === 'string' &&
                    v.length > 2 &&
                    v.toLowerCase() !== rawName.toLowerCase()
                );

                if (unique.length > 0) {
                    await cache.set(cacheKey, model, JSON.stringify(unique));
                    Logger.info(`[AIVariator] ✅ Success: ${unique.join(', ')}`);
                    return unique.slice(0, 3);
                }
            }

            return [];
        } catch (e: any) {
            Logger.warn(`[AIVariator] Failed to generate variants for "${company.company_name}": ${e.message}`);
            return [];
        }
    }
}
