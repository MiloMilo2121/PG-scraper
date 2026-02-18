
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
    }

    private static buildPrompt(company: CompanyInput): string {
        const name = company.company_name;
        const city = company.city || 'unknown city';
        const province = company.province || '';
        const category = company.category || 'unknown sector';

        return `You are an expert on Italian SME web domains. Your job is to predict the official website URL.

Company: "${name}"
City: "${city}" (${province})
Sector: "${category}"

Rules for Italian SME domains:
- Legal suffixes (SRL, SPA, SNC, SAS) are ALWAYS stripped from domains
- Most common pattern: {cleanname}.it (e.g. "Rossi Costruzioni Srl" → rossicostruzioni.it)
- Sector suffix pattern: {name}{sector}.it (e.g. "Bianchi" in edilizia → bianchiedilizia.it)
- City suffix pattern: {name}{city}.it (e.g. "Rossi" in Milano → rossimilano.it)
- Accented chars → ASCII: è→e, à→a, ù→u, ò→o
- Apostrophes stripped: "L'Angolo" → langolo.it
- Some use .com or .info when .it is taken
- Multi-word: try both joined and hyphenated ({first}{second}.it, {first}-{second}.it)

Tasks:
1. If you recognize this company, recall the exact URL from training data (confidence 0.8+)
2. If unknown, generate 3-5 most probable domains using the rules above
3. Set confidence 0.5-0.7 for constructed guesses, 0.8+ only if you are sure it exists

Output JSON with candidate URLs and confidence scores (0.0-1.0).
If you have no idea, return an empty candidates array.`;
    }

    private static buildCacheKey(company: CompanyInput): string {
        const name = (company.company_name || '').toLowerCase().trim();
        const city = (company.city || '').toLowerCase().trim();
        return `${name}|${city}`;
    }
}
