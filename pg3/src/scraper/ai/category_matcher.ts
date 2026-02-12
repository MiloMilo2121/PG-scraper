import OpenAI from 'openai';
import { Logger } from '../utils/logger';
import { ALL_PG_CATEGORIES, PG_CATEGORIES } from '../data/pg_categories';

/**
 * 🧠 CATEGORY MATCHER
 * 
 * Maps user queries (e.g., "manifattura", "metalmeccanica") to ALL 
 * relevant PagineGialle categories from the master taxonomy.
 * 
 * Uses GPT-4o-mini for semantic matching — the user's query may not
 * exactly match any PG category, but GPT finds all related ones.
 * 
 * Results are cached per query. (Law 503)
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
- For example, "manifattura" should match: manufacturing, industrial, production, and related B2B categories
- For "moda", match: all clothing, accessories, textiles, fashion-related categories
- Be generous — it's better to include a borderline category than to miss a relevant one
- Respond ONLY with a valid JSON object: {"categories": ["Category1", "Category2", ...]}
- Do NOT invent categories that don't exist in the master list`;

export class CategoryMatcher {

    private static client: OpenAI | null = null;

    private static getClient(): OpenAI {
        if (!this.client) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY is required for CategoryMatcher');
            Logger.info(`[CategoryMatcher] 🔑 OpenAI Key: ${apiKey.substring(0, 7)}...`);
            this.client = new OpenAI({ apiKey });
        }
        return this.client;
    }

    /**
     * Given a user query, return all matching PG categories.
     * Uses GPT-4o-mini for semantic matching against the master list.
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
            const client = this.getClient();

            // Build the category list grouped by sector for better GPT understanding
            const categoryListStr = Object.entries(PG_CATEGORIES)
                .map(([sector, cats]) => `## ${sector}\n${cats.join(', ')}`)
                .join('\n\n');

            const response = await client.chat.completions.create({
                model: 'gpt-4o-mini',
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
            if (!raw) throw new Error('Empty GPT response');

            const parsed = JSON.parse(raw);
            let categories: string[] = parsed.categories || parsed.results || [];

            // VALIDATE — only keep categories that actually exist in the master list
            const masterSet = new Set(ALL_PG_CATEGORIES.map(c => c.toLowerCase()));
            const validated = categories.filter(cat => {
                const exists = masterSet.has(cat.toLowerCase());
                if (!exists) {
                    Logger.warn(`[CategoryMatcher] ⚠️ GPT hallucinated category: "${cat}" — skipping`);
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
