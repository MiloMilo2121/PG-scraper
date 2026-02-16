
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { LLMService } from '../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../ai/model_router';
import { LLMCache } from '../ai/llm_cache';

export class LLMOracle {
    /**
     * 🔮 THE ORACLE
     * Uses LLM zero-shot inference to guess the website.
     * Cost: Very low (if using Z.ai/Kimi/GPT-4o-mini).
     * Returns: A single high-probability URL or null.
     */
    static async predictWebsite(company: CompanyInput): Promise<string | null> {
        try {
            const prompt = `
You are a data retrieval expert. 
Target: "${company.company_name}" in "${company.city || ''} (${company.province || ''})".
Task: Predict the most likely official website URL for this Italian company.
Rules:
1. Return ONLY a JSON object: {"url": "https://..."} or {"url": null} if impossible to guess.
2. Prefer ".it" domains.
3. Guess based on common patterns (name+city, acronyms) or specific knowledge if the company is famous.
4. Do not invent non-existent TLDs.
JSON:
`;
            // 1. Check Cache
            const cache = LLMCache.getInstance();
            const model = ModelRouter.selectModel(TaskDifficulty.SIMPLE);
            const cachedUrl = await cache.get(prompt, model);

            if (cachedUrl) {
                Logger.info(`[LLMOracle] ⚡ Cache Hit: ${cachedUrl}`);
                return cachedUrl !== 'NULL' ? cachedUrl : null;
            }

            // 2. Predict (if not cached)
            // Using 'SIMPLE' model (Flash/Mini)
            const response = await LLMService.complete(prompt, model);
            const clean = response.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const data = JSON.parse(clean);
                let resultUrl = 'NULL';

                if (data.url && data.url.includes('.')) {
                    let url = data.url;
                    if (!url.startsWith('http')) url = 'https://' + url;
                    Logger.info(`[LLMOracle] 🔮 Predicted: ${url}`);
                    resultUrl = url;
                }

                // Cache Result (Positive or Negative)
                await cache.set(prompt, model, resultUrl);

                return resultUrl !== 'NULL' ? resultUrl : null;

            } catch (parseError) {
                Logger.warn(`[LLMOracle] Failed to parse JSON: ${clean}`);
            }

        } catch (e) {
            Logger.warn(`[LLMOracle] Prediction failed: ${(e as Error).message}`);
        }
        return null; // Oracle is silent
    }
}
