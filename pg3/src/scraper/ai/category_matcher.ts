import { Logger } from '../utils/logger';
import { LLMService } from '../../enricher/core/ai/llm_service';
import { ALL_PG_CATEGORIES, PG_CATEGORIES } from '../data/pg_categories';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🧠 CATEGORY MATCHER
 *
 * Maps user queries (e.g., "manifattura", "metalmeccanica") to ALL
 * relevant PagineGialle categories from the master taxonomy.
 *
 * Uses LLMService for semantic matching against the master list.
 * Results are cached per query (Law 503: Caching Intelligence).
 */

// ─── Dual-layer cache: in-memory + persistent disk ─────────────────────────
const MEMORY_CACHE = new Map<string, string[]>();
const DISK_CACHE_FILE = path.join(process.cwd(), 'data', 'category_matcher_cache.json');

function loadDiskCache(): void {
    try {
        if (fs.existsSync(DISK_CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(DISK_CACHE_FILE, 'utf-8'));
            for (const [k, v] of Object.entries(data)) {
                MEMORY_CACHE.set(k, v as string[]);
            }
            Logger.info(`[CategoryMatcher] 💾 Loaded ${MEMORY_CACHE.size} entries from disk cache`);
        }
    } catch { /* Non-fatal */ }
}

function saveDiskCache(): void {
    try {
        fs.mkdirSync(path.dirname(DISK_CACHE_FILE), { recursive: true });
        fs.writeFileSync(DISK_CACHE_FILE, JSON.stringify(Object.fromEntries(MEMORY_CACHE), null, 2));
    } catch { /* Non-fatal */ }
}

// Load on startup
loadDiskCache();

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

        if (MEMORY_CACHE.has(cacheKey)) {
            const cached = MEMORY_CACHE.get(cacheKey)!;
            Logger.info(`[CategoryMatcher] 💾 Cache hit for "${userQuery}" → ${cached.length} categories`);
            return cached;
        }

        Logger.info(`[CategoryMatcher] 🧠 Matching "${userQuery}" against ${ALL_PG_CATEGORIES.length} PG categories...`);

        try {

            const categoryListStr = Object.entries(PG_CATEGORIES)
                .map(([sector, cats]) => `## ${sector}\n${cats.join(', ')}`)
                .join('\n\n');

            // Use the resilient LLMService with a fallback chain:
            // Z.ai (free, fast) → DeepSeek (cheap) → GPT-4o-mini (reliable)
            const prompt = `${SYSTEM_PROMPT}\n\nUser search query: "${userQuery}"\n\nMASTER CATEGORY LIST:\n${categoryListStr}`;
            const raw = await LLMService.complete(
                prompt,
                'glm-4.7-flash',        // Primary: Z.ai (free)
                ['deepseek-chat', 'gpt-4o-mini'] // Fallbacks if 429
            );

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

            // Dual-cache (memory + disk) — Law 503
            MEMORY_CACHE.set(cacheKey, corrected);
            saveDiskCache();

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

            MEMORY_CACHE.set(cacheKey, fallback);
            saveDiskCache();
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
