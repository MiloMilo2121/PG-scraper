
import { config } from '../../config';

export class SerpCache {
    private static cache: Map<string, any> = new Map();

    public static async get(key: string): Promise<any | null> {
        // Mock Redis 'GET'
        if (config.redis.host) {
            // return await redis.get(key);
        }
        return this.cache.get(key) || null;
    }

    public static async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        // Mock Redis 'SETEX'
        this.cache.set(key, value);
    }
}
