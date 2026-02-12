import OpenAI from 'openai';
import { Logger } from '../utils/logger';

/**
 * 🏘️ MUNICIPALITY SPLITTER
 * When PG returns >200 results for a province, GPT-4o-mini selects
 * 5 geographically distributed municipalities for granular scraping.
 * 
 * Results are cached in-memory — same province never queried twice.
 * (Law 503: Caching Intelligence)
 */

const CACHE = new Map<string, string[]>();

const SYSTEM_PROMPT = `You are an expert in Italian geography. 
Given an Italian province name, return exactly 5 municipalities (comuni) that are 
geographically well-distributed across the province to maximize territorial coverage.
Choose municipalities that are spread out — north, south, east, west, and center — 
to minimize overlap when scraping business directories.
Prefer municipalities with higher population as they tend to have more businesses.
Respond ONLY with a valid JSON array of 5 strings. No explanation, no markdown.
Example: ["Milano","Sesto San Giovanni","Rho","Legnano","San Donato Milanese"]`;

export class MunicipalitySplitter {

    private static client: OpenAI | null = null;

    private static getClient(): OpenAI {
        if (!this.client) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY is required for MunicipalitySplitter');
            this.client = new OpenAI({ apiKey });
        }
        return this.client;
    }

    /**
     * Get 5 geographically distributed municipalities for a province.
     * Returns cached results if available.
     */
    public static async getMunicipalities(province: string): Promise<string[]> {
        const cacheKey = province.toLowerCase().trim();

        // Cache hit — (Law 503)
        if (CACHE.has(cacheKey)) {
            Logger.info(`[MunicipalitySplitter] Cache hit for "${province}"`);
            return CACHE.get(cacheKey)!;
        }

        Logger.info(`[MunicipalitySplitter] Querying GPT-4o-mini for 5 municipalities in "${province}"...`);

        try {
            const client = this.getClient();
            const response = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                max_tokens: 200,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Province: ${province}` }
                ],
                response_format: { type: 'json_object' }
            });

            const raw = response.choices[0]?.message?.content?.trim();
            if (!raw) throw new Error('Empty GPT response');

            // Parse — handle both array and object formats
            let municipalities: string[];
            const parsed = JSON.parse(raw);

            if (Array.isArray(parsed)) {
                municipalities = parsed;
            } else if (parsed.municipalities && Array.isArray(parsed.municipalities)) {
                municipalities = parsed.municipalities;
            } else {
                // Extract first array value from any key
                const firstArray = Object.values(parsed).find(v => Array.isArray(v)) as string[] | undefined;
                if (firstArray) {
                    municipalities = firstArray;
                } else {
                    throw new Error(`Unexpected GPT format: ${raw}`);
                }
            }

            // Validate
            if (municipalities.length < 3 || municipalities.length > 8) {
                throw new Error(`Expected 5 municipalities, got ${municipalities.length}: ${JSON.stringify(municipalities)}`);
            }

            Logger.info(`[MunicipalitySplitter] ✅ ${province} → [${municipalities.join(', ')}]`);

            // Cache
            CACHE.set(cacheKey, municipalities);

            return municipalities;

        } catch (error) {
            Logger.error(`[MunicipalitySplitter] ❌ Failed for "${province}": ${(error as Error).message}`);
            // Fallback: return just the province capital
            return [province];
        }
    }
}
