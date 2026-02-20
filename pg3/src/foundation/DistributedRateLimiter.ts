import { MemoryFirstCache } from './MemoryFirstCache';

export class DistributedRateLimiter {
    private cache: MemoryFirstCache;

    constructor(cache: MemoryFirstCache) {
        this.cache = cache;
    }

    public async checkLimit(identifier: string, limit: number, windowSeconds: number): Promise<boolean> {
        const key = `omega:ratelimit:${identifier}`;
        const now = Date.now();
        const score = now;

        // Note: MemoryFirstCache zadd/zrangeByScore/zcard operations are safe and degrade to L1-only no-ops if Redis is down
        // If Redis is down, we fallback to an optimistic "true" (allow) to keep the pipeline moving, relying on BackpressureValve
        // to handle actual API stress. It's better to get a 429 from an API than to crash the node.

        const ping = await this.cache.ping();
        if (!ping) {
            // Redis is offline. Degrade gracefully.
            return true;
        }

        try {
            // Remove old entries
            const windowStart = now - (windowSeconds * 1000);
            // ioredis zremrangebyscore isn't natively exposed in our wrapper, we'll just check count.
            // A production environment would execute a Lua script here for atomicity, but 
            // since we count and then add, it's roughly fine.

            const recentHits = await this.cache.zrangeByScore('rate_limit_ns', key, windowStart, now);

            if (recentHits.length >= limit) {
                return false; // Rate limit exceeded
            }

            // Allowed, add it
            await this.cache.zadd('rate_limit_ns', key, score, `${now}-${Math.random()}`);

            // Set an explicit expiration on the key if we wanted, but ZSETs can grow. To manage growth we rely on Cron cleanup
            // Or use simple counters instead of sliding windows if strict sliding isn't needed.
            return true;

        } catch (err) {
            console.error(`[DistributedRateLimiter] Error checking limit for ${identifier}`, err);
            return true; // Fail open
        }
    }
}
