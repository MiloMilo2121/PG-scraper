import { Logger } from '../utils/logger';
import { LLMService } from '../../enricher/core/ai/llm_service';
import { config } from '../config';

/**
 * 🏘️ MUNICIPALITY SPLITTER
 * When PG returns >200 results for a province, the LLM selects
 * 5 geographically distributed municipalities for granular scraping.
 *
 * Uses LLMService singleton client — no duplicate OpenAI instances.
 * Results are cached in-memory (Law 503: Caching Intelligence).
 */


import * as fs from 'fs';
import * as path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'data', 'municipalities_cache.json');
let MEMOLOCK_CACHE: Map<string, string[]> | null = null;

function loadCache(): Map<string, string[]> {
    if (MEMOLOCK_CACHE) return MEMOLOCK_CACHE;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            MEMOLOCK_CACHE = new Map(Object.entries(data));
        } else {
            MEMOLOCK_CACHE = new Map();
        }
    } catch (e) {
        Logger.warn(`[MunicipalitySplitter] Failed to load cache: ${(e as Error).message}`);
        MEMOLOCK_CACHE = new Map();
    }
    return MEMOLOCK_CACHE!;
}

function saveCache(cache: Map<string, string[]>) {
    try {
        const data = Object.fromEntries(cache);
        if (!fs.existsSync(path.dirname(CACHE_FILE))) {
            fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        Logger.error(`[MunicipalitySplitter] Failed to save cache: ${(e as Error).message}`);
    }
}

const SYSTEM_PROMPT = `You are an expert in Italian geography. 
Given an Italian province name, return exactly 5 municipalities (comuni) that are 
geographically well-distributed across the province to maximize territorial coverage.
Choose municipalities that are spread out — north, south, east, west, and center — 
to minimize overlap when scraping business directories.
Prefer municipalities with higher population as they tend to have more businesses.
Respond ONLY with a valid JSON object: {"municipalities": ["Name1", "Name2", "Name3", "Name4", "Name5"]}`;

export class MunicipalitySplitter {

    /**
     * Get 5 geographically distributed municipalities for a province.
     * Returns persistent cached results if available.
     */
    public static async getMunicipalities(province: string): Promise<string[]> {
        const cache = loadCache();
        const cacheKey = province.toLowerCase().trim();

        // Persistent Cache hit
        if (cache.has(cacheKey)) {
            Logger.info(`[MunicipalitySplitter] 💾 Persistent Cache hit for "${province}"`);
            return cache.get(cacheKey)!;
        }

        Logger.info(`[MunicipalitySplitter] 🧠 Querying LLM for 5 municipalities in "${province}"...`);

        try {
            const client = LLMService.getClient();
            const response = await client.chat.completions.create({
                model: config.llm.fastModel,
                temperature: 0.1,
                max_tokens: 200,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Province: ${province}` }
                ],
                response_format: { type: 'json_object' }
            });

            const raw = response.choices[0]?.message?.content?.trim();
            if (!raw) throw new Error('Empty LLM response');

            // Strip markdown wrapping if present
            const cleanRaw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

            // Parse — handle both array and object formats
            let municipalities: string[];
            const parsed = JSON.parse(cleanRaw);

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
                    throw new Error(`Unexpected LLM format: ${cleanRaw}`);
                }
            }

            // Validate
            if (municipalities.length < 3 || municipalities.length > 8) {
                throw new Error(`Expected 5 municipalities, got ${municipalities.length}: ${JSON.stringify(municipalities)}`);
            }

            Logger.info(`[MunicipalitySplitter] ✅ ${province} → [${municipalities.join(', ')}]`);

            // Save to Persistent Cache
            cache.set(cacheKey, municipalities);
            saveCache(cache);

            return municipalities;

        } catch (error) {
            Logger.error(`[MunicipalitySplitter] ❌ Failed for "${province}": ${(error as Error).message}`);
            // Fallback: return just the province capital
            return [province];
        }
    }
}
