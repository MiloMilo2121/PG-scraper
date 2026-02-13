import { Logger } from '../utils/logger';
import { LLMService } from '../../enricher/core/ai/llm_service';
import { config } from '../config';
import { ALL_PG_CATEGORIES, PG_CATEGORIES } from '../data/pg_categories';

/**
 * 🧠 CATEGORY MATCHER
 *
 * Maps user queries (e.g., "manifattura", "metalmeccanica") to ALL
 * relevant PagineGialle categories from the master taxonomy.
 *
 * Uses LLMService for semantic matching against the master list.
 * Results are cached per query (Law 503: Caching Intelligence).
 */

const CACHE = new Map<string, string[]>();

const SYSTEM_PROMPT = `You are an expert in Italian business categories for PagineGialle (Yellow Pages).
You will receive a user search query (e.g., "manifattura", "metalmeccanica", "moda") 
and the COMPLETE list of PagineGialle categories.

Your task: Return ALL categories from the master list that are semantically related, 
synonymous, or coherent with the user's query. Be COMPREHENSIVE — include every 
category that a user searching for that industry would want to find.

Rules:
- ONLY return categories that EXACTLY match entries in the provided master list
- Include direct matches, synonyms, related sub-categories, and upstream/downstream categories
- Be generous — it's better to include a borderline category than to miss a relevant one
- Respond ONLY with a valid JSON object: {"categories": ["Category1", "Category2", ...]}
- Do NOT invent categories that don't exist in the master list`;

export class CategoryMatcher {

    /**
     * Given a user query, return all matching PG categories.
     * Uses LLM for semantic matching against the master list.
     */
    public static async match(userQuery: string): Promise<string[]> {
        const cacheKey = userQuery.toLowerCase().trim();

        if (CACHE.has(cacheKey)) {
            const cached = CACHE.get(cacheKey)!;
            Logger.info(`[CategoryMatcher] Cache hit for "${userQuery}" → ${cached.length} categories`);
            return cached;
        }

        Logger.info(`[CategoryMatcher] 🧠 Matching "${userQuery}" against ${ALL_PG_CATEGORIES.length} PG categories...`);

        try {
            const client = LLMService.getClient();

            // Build the category list grouped by sector for better understanding
            const categoryListStr = Object.entries(PG_CATEGORIES)
                .map(([sector, cats]) => `## ${sector}\n${cats.join(', ')}`)
                .join('\n\n');

            const response = await client.chat.completions.create({
                model: config.llm.fastModel,
                temperature: 0,
                max_tokens: 4000,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `User search query: "${userQuery}"\n\nMASTER CATEGORY LIST:\n${categoryListStr}`
                    }
                ],
                response_format: { type: 'json_object' }
            });

            const raw = response.choices[0]?.message?.content?.trim();
            if (!raw) throw new Error('Empty LLM response');

            // Strip markdown wrapping if present
            const cleanRaw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanRaw);
            let categories: string[] = parsed.categories || parsed.results || [];

            // VALIDATE — only keep categories that actually exist in the master list (Law 504)
            const masterSet = new Set(ALL_PG_CATEGORIES.map(c => c.toLowerCase()));
            const validated = categories.filter(cat => {
                const exists = masterSet.has(cat.toLowerCase());
                if (!exists) {
                    Logger.warn(`[CategoryMatcher] ⚠️ LLM hallucinated category: "${cat}" — skipping`);
                }
                return exists;
            });

            // Case-correct to match exact master list casing
            const masterMap = new Map(ALL_PG_CATEGORIES.map(c => [c.toLowerCase(), c]));
            const corrected = validated.map(cat => masterMap.get(cat.toLowerCase()) || cat);

            Logger.info(`[CategoryMatcher] ✅ "${userQuery}" → ${corrected.length} categories matched`);
            if (corrected.length > 0) {
                Logger.info(`[CategoryMatcher]    First 10: [${corrected.slice(0, 10).join(', ')}]`);
            }

            // Cache
            CACHE.set(cacheKey, corrected);

            // Token usage tracking (Law 501)
            const usage = response.usage;
            if (usage) {
                Logger.info(`[CategoryMatcher] 💰 Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`);
            }

            return corrected;

        } catch (error) {
            Logger.error(`[CategoryMatcher] ❌ Failed for "${userQuery}": ${(error as Error).message}`);

            // Fallback: basic substring matching
            Logger.info(`[CategoryMatcher] ⚡ Falling back to substring matching...`);
            const fallback = ALL_PG_CATEGORIES.filter(cat =>
                cat.toLowerCase().includes(cacheKey) ||
                cacheKey.includes(cat.toLowerCase())
            );
            Logger.info(`[CategoryMatcher] Fallback found: ${fallback.length} categories`);

            CACHE.set(cacheKey, fallback);
            return fallback;
        }
    }

    /**
     * Direct lookup: check if a category exists exactly in the master list.
     */
    public static exists(category: string): boolean {
        return ALL_PG_CATEGORIES.some(c => c.toLowerCase() === category.toLowerCase());
    }

    /**
     * Get all categories for a given macro-sector.
     */
    public static getBySector(sector: string): string[] {
        return PG_CATEGORIES[sector] || [];
    }
}
