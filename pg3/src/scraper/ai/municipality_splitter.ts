import { Logger } from '../utils/logger';
import { LLMService } from '../../shared-runtime/ai/LLMService';
import { config } from '../config';
import { PROVINCE_CODES, PROVINCE_NAME_TO_CODE } from '../data/pg_categories';

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
const INFLIGHT_REQUESTS = new Map<string, Promise<string[]>>();

function normalizeProvinceKey(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’]/g, ' ')
        .replace(/[-–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const NORMALIZED_PROVINCE_CODE_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(PROVINCE_NAME_TO_CODE).map(([name, code]) => [normalizeProvinceKey(name), code])
);

function sanitizeMunicipalityValue(value: unknown): string | null {
    let candidate = value;

    if (Array.isArray(candidate)) {
        candidate = candidate.find((entry) => typeof entry === 'string' || typeof entry === 'number');
    }

    if (candidate === undefined || candidate === null) {
        return null;
    }

    const cleaned = String(candidate)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return null;
    }

    const withoutDirectionalSuffix = cleaned
        .split(',')[0]
        .replace(/\s*[-–]\s*(north|south|east|west|center|centre|nord|sud|est|ovest|centro)\b.*$/i, '')
        .trim();

    return withoutDirectionalSuffix || cleaned;
}

function sanitizeMunicipalityList(values: unknown, fallbackProvince?: string): string[] {
    const input = Array.isArray(values) ? values : [];
    const sanitized: string[] = [];
    const seen = new Set<string>();

    for (const raw of input) {
        const normalized = sanitizeMunicipalityValue(raw);
        if (!normalized) continue;

        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        sanitized.push(normalized);
    }

    if (sanitized.length === 0 && fallbackProvince) {
        return [fallbackProvince];
    }

    return sanitized.slice(0, 5);
}

function getCacheAliases(rawKey: string): string[] {
    const aliases = new Set<string>();
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) {
        return [];
    }

    const normalizedRawKey = normalizeProvinceKey(trimmedKey);
    aliases.add(normalizedRawKey);

    if (/^[A-Za-z]{2}$/.test(trimmedKey)) {
        const provinceName = PROVINCE_CODES[trimmedKey.toUpperCase()];
        if (provinceName) {
            aliases.add(normalizeProvinceKey(provinceName));
        }
    } else {
        const provinceCode = NORMALIZED_PROVINCE_CODE_MAP[normalizedRawKey];
        if (provinceCode) {
            aliases.add(normalizeProvinceKey(provinceCode));
        }
    }

    return Array.from(aliases);
}

function upsertCacheEntry(cache: Map<string, string[]>, rawKey: string, values: unknown): boolean {
    const aliases = getCacheAliases(rawKey);
    const fallbackProvince = /^[A-Za-z]{2}$/.test(rawKey)
        ? PROVINCE_CODES[rawKey.toUpperCase()] || rawKey.toUpperCase()
        : rawKey;
    const sanitized = sanitizeMunicipalityList(values, fallbackProvince);
    let mutated = false;

    for (const alias of aliases) {
        const current = cache.get(alias);
        if (JSON.stringify(current) !== JSON.stringify(sanitized)) {
            cache.set(alias, sanitized);
            mutated = true;
        }
    }

    return mutated;
}

function loadCache(): Map<string, string[]> {
    if (MEMOLOCK_CACHE) return MEMOLOCK_CACHE;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const rawData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<string, unknown>;
            const normalizedCache = new Map<string, string[]>();
            let cacheMutated = false;

            for (const [province, values] of Object.entries(rawData)) {
                if (upsertCacheEntry(normalizedCache, province, values)) {
                    cacheMutated = true;
                }
            }

            MEMOLOCK_CACHE = normalizedCache;
            if (cacheMutated) {
                saveCache(MEMOLOCK_CACHE);
            }
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
        const resolvedProvince = PROVINCE_CODES[province.toUpperCase()] || province;
        const cacheKey = normalizeProvinceKey(resolvedProvince);

        // Persistent Cache hit
        if (cache.has(cacheKey)) {
            Logger.info(`[MunicipalitySplitter] 💾 Persistent Cache hit for "${province}"`);
            const sanitized = sanitizeMunicipalityList(cache.get(cacheKey)!, resolvedProvince);
            cache.set(cacheKey, sanitized);
            return sanitized;
        }

        if (INFLIGHT_REQUESTS.has(cacheKey)) {
            Logger.info(`[MunicipalitySplitter] ⏳ Joining in-flight lookup for "${resolvedProvince}"`);
            return INFLIGHT_REQUESTS.get(cacheKey)!;
        }

        Logger.info(`[MunicipalitySplitter] 🧠 Querying LLM for 5 municipalities in "${resolvedProvince}"...`);

        const request = (async () => {
            try {
                const prompt = `${SYSTEM_PROMPT}\n\nUser: Province: ${resolvedProvince}\n\nRespond strictly with a JSON object containing a "municipalities" array.`;
                const raw = await LLMService.complete(
                    prompt,
                    'glm-4.7-flash',            // Primary: Z.ai (Free/Fast)
                    ['gpt-4o-mini', 'deepseek-chat', 'kimi-k2.5'] // Fallbacks (Law 505)
                );

                if (!raw) throw new Error('Empty LLM response');

                const cleanRaw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

                let municipalities: string[];
                const parsed = JSON.parse(cleanRaw);

                if (Array.isArray(parsed)) {
                    municipalities = parsed;
                } else if (parsed.municipalities && Array.isArray(parsed.municipalities)) {
                    municipalities = parsed.municipalities;
                } else {
                    const firstArray = Object.values(parsed).find(v => Array.isArray(v)) as string[] | undefined;
                    if (firstArray) {
                        municipalities = firstArray;
                    } else {
                        throw new Error(`Unexpected LLM format: ${cleanRaw}`);
                    }
                }

                municipalities = sanitizeMunicipalityList(municipalities, resolvedProvince);

                if (municipalities.length < 3 || municipalities.length > 8) {
                    throw new Error(`Expected 5 municipalities, got ${municipalities.length}: ${JSON.stringify(municipalities)}`);
                }

                Logger.info(`[MunicipalitySplitter] ✅ ${resolvedProvince} → [${municipalities.join(', ')}]`);

                upsertCacheEntry(cache, resolvedProvince, municipalities);
                saveCache(cache);

                return municipalities;

            } catch (error) {
                Logger.error(`[MunicipalitySplitter] ❌ Failed for "${resolvedProvince}": ${(error as Error).message}`);
                return [resolvedProvince];
            } finally {
                INFLIGHT_REQUESTS.delete(cacheKey);
            }
        })();

        INFLIGHT_REQUESTS.set(cacheKey, request);
        return request;
    }
}
