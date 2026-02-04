import fs from 'fs';
import path from 'path';
import { SearchResult } from '../../types';

const CACHE_FILE = path.resolve(__dirname, '../../../.search-cache.json');
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

interface CacheEntry {
    results: SearchResult[];
    timestamp: number;
}

let cache: Map<string, CacheEntry> = new Map();
let cacheLoaded = false;

// Load cache from disk at startup
export function loadCache(): void {
    if (cacheLoaded) return;

    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            cache = new Map(Object.entries(data));
            console.log(`[Cache] Loaded ${cache.size} cached queries from disk`);
        }
    } catch (e) {
        console.log('[Cache] No cache file found or invalid, starting fresh');
        cache = new Map();
    }
    cacheLoaded = true;
}

// Save cache to disk
export function saveCache(): void {
    try {
        const obj = Object.fromEntries(cache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.error('[Cache] Failed to save cache to disk');
    }
}

// Get cached result
export function getCached(query: string): SearchResult[] | null {
    loadCache(); // Ensure cache is loaded

    const normalizedQuery = query.toLowerCase().trim();
    const entry = cache.get(normalizedQuery);

    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
        return entry.results;
    }

    // Remove expired entry
    if (entry) {
        cache.delete(normalizedQuery);
    }

    return null;
}

// Set cache entry
export function setCache(query: string, results: SearchResult[]): void {
    const normalizedQuery = query.toLowerCase().trim();
    cache.set(normalizedQuery, {
        results,
        timestamp: Date.now()
    });

    // Auto-save every 10 new entries
    if (cache.size % 10 === 0) {
        saveCache();
    }
}

// Clear cache
export function clearCache(): void {
    cache.clear();
    try {
        if (fs.existsSync(CACHE_FILE)) {
            fs.unlinkSync(CACHE_FILE);
        }
    } catch (e) { }
}

// Get cache stats
export function getCacheStats(): { size: number; hitRate?: number } {
    return {
        size: cache.size
    };
}
