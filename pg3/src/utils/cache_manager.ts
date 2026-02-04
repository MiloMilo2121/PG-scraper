
import * as fs from 'fs';
import * as path from 'path';

/**
 * 💾 CACHE MANAGER 💾
 * Task 30: Cache SERP results
 */
export class CacheManager {
    private static CACHE_DIR = './cache/serp';
    private static MEMORY_CACHE: Record<string, { data: any, expires: number }> = {};
    private static TTL = 24 * 60 * 60 * 1000; // 24 Hours

    static init() {
        if (!fs.existsSync(this.CACHE_DIR)) {
            fs.mkdirSync(this.CACHE_DIR, { recursive: true });
        }
    }

    /**
     * Generates a cache key for a query
     */
    private static getKey(engine: string, query: string): string {
        return `${engine}_${query.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}`;
    }

    static async get(engine: string, query: string): Promise<any | null> {
        const key = this.getKey(engine, query);

        // 1. Memory Check
        if (this.MEMORY_CACHE[key]) {
            if (Date.now() < this.MEMORY_CACHE[key].expires) {
                return this.MEMORY_CACHE[key].data;
            } else {
                delete this.MEMORY_CACHE[key];
            }
        }

        // 2. Disk Check
        const filePath = path.join(this.CACHE_DIR, `${key}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const json = JSON.parse(content);
                if (Date.now() < json.expires) {
                    // Hydrate memory
                    this.MEMORY_CACHE[key] = json;
                    return json.data;
                }
            } catch { }
        }

        return null;
    }

    static async set(engine: string, query: string, data: any): Promise<void> {
        const key = this.getKey(engine, query);
        const cacheObj = {
            data,
            expires: Date.now() + this.TTL
        };

        // Write Memory
        this.MEMORY_CACHE[key] = cacheObj;

        // Write Disk
        this.init(); // Ensure dir
        const filePath = path.join(this.CACHE_DIR, `${key}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(cacheObj));
        } catch { }
    }
}
