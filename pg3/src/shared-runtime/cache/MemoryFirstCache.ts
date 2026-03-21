import Redis, { RedisOptions } from 'ioredis';
import * as crypto from 'crypto';

export interface CacheStats {
    l1_size: number;
    l1_hit_rate: number;
    l2_hit_rate: number;
    total_hit_rate: number;
    l1_evictions: number;
    redis_connections_saved: number;
}

interface L1Entry<T> {
    data: T;
    expiresAt: number;
    size: number;
}

export class MemoryFirstCache {
    private l1: Map<string, L1Entry<any>> = new Map();
    private redis: Redis;

    // L1 Limits
    private readonly l1MaxEntries: number;
    private readonly l1MaxMemoryMB: number;
    private currentL1MemoryBytes = 0;

    // Stats
    private cacheStats: CacheStats = {
        l1_size: 0,
        l1_hit_rate: 0,
        l2_hit_rate: 0,
        total_hit_rate: 0,
        l1_evictions: 0,
        redis_connections_saved: 0
    };

    private totalLookups = 0;
    private l1Hits = 0;
    private l2Hits = 0;

    private redisHealthy = true;

    constructor(options: {
        l1MaxEntries?: number;
        l1MaxMemoryMB?: number;
        redisUrl?: string;
        redisMaxConnections?: number;
        redisCommandTimeout?: number;
    } = {}) {
        this.l1MaxEntries = options.l1MaxEntries || 20000;
        this.l1MaxMemoryMB = options.l1MaxMemoryMB || 50;

        const redisOpts: RedisOptions = {
            maxRetriesPerRequest: 2,
            connectTimeout: 2000,
            commandTimeout: options.redisCommandTimeout || 2000,
            retryStrategy: (times) => {
                if (times > 2) {
                    if (this.redisHealthy) {
                        console.error('[MemoryFirstCache] Redis completely down. Degrading to L1-only mode.');
                        this.redisHealthy = false;
                    }
                    return null; // Stop retrying
                }
                return 500;
            }
        };
        // Connection pooling isn't strictly maxConnections in ioredis but we can configure connection limits if we wanted to proxy it.
        // Ioredis is a single connection multiplexer, which inherently limits connection bloat from a single process to 1 connection. 
        // Max memory exhaustion comes from thousands of concurrent commands. We limit command queue.
        if (options.redisUrl) {
            this.redis = new Redis(options.redisUrl, redisOpts);
        } else {
            this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', redisOpts);
        }

        this.redis.on('error', (err) => {
            // Suppress spammy connection errors if we already know it's down
            if (this.redisHealthy) {
                console.warn('[MemoryFirstCache] Redis error detected:', err.message);
            }
        });

        this.redis.on('ready', () => {
            if (!this.redisHealthy) {
                console.info('[MemoryFirstCache] Redis recovered. Resuming L2 cache operations.');
                this.redisHealthy = true;
            }
        });
    }

    private getL1Key(namespace: string, key: string): string {
        const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
        return `${namespace}:${hash}`;
    }

    private getL2Key(namespace: string, key: string): string {
        return `${namespace}:${key}`;
    }

    private evictL1IfNeeded() {
        // Evict if over entry count
        if (this.l1.size > this.l1MaxEntries) {
            const oldestKey = this.l1.keys().next().value;
            if (oldestKey) {
                const entry = this.l1.get(oldestKey);
                if (entry) this.currentL1MemoryBytes -= entry.size;
                this.l1.delete(oldestKey);
                this.cacheStats.l1_evictions++;
            }
        }

        // Evict if over memory limit (aggressive 20% drop)
        const maxBytes = this.l1MaxMemoryMB * 1024 * 1024;
        if (this.currentL1MemoryBytes > maxBytes) {
            const toDrop = Math.floor(this.l1.size * 0.2);
            let dropped = 0;
            for (const [k, entry] of this.l1.entries()) {
                this.currentL1MemoryBytes -= entry.size;
                this.l1.delete(k);
                this.cacheStats.l1_evictions++;
                dropped++;
                if (dropped >= toDrop) break;
            }
        }
    }

    public async get<T>(namespace: string, key: string): Promise<{ value: T | null; level: 'L1' | 'L2' | 'MISS' }> {
        this.totalLookups++;
        const l1Key = this.getL1Key(namespace, key);

        // 1. Check L1
        const l1Entry = this.l1.get(l1Key);
        if (l1Entry) {
            if (Date.now() < l1Entry.expiresAt) {
                this.l1Hits++;
                this.cacheStats.redis_connections_saved++;
                return { value: l1Entry.data as T, level: 'L1' };
            } else {
                // Expired
                this.currentL1MemoryBytes -= l1Entry.size;
                this.l1.delete(l1Key);
            }
        }

        // 2. Check L2 (if healthy)
        if (this.redisHealthy) {
            try {
                const l2Key = this.getL2Key(namespace, key);
                const redisRes = await this.redis.get(l2Key);
                if (redisRes) {
                    const parsed = JSON.parse(redisRes) as T;
                    this.l2Hits++;
                    // Backfill L1
                    // Set L1 TTL to min(300s, whatever remains, but we don't know remainder easily without TTL command, so we use 300s fixed for backfill)
                    this.setL1(namespace, key, parsed, 300);
                    return { value: parsed, level: 'L2' };
                }
            } catch (err) {
                // L2 lookup failed (timeout or connection error). Graceful degrade to MISS.
                // Do not throw.
            }
        }

        return { value: null, level: 'MISS' };
    }

    private setL1<T>(namespace: string, key: string, value: T, ttlSeconds: number) {
        const l1Key = this.getL1Key(namespace, key);
        const l1Ttl = Math.min(ttlSeconds, 300); // L1 stays fresh
        const strVal = JSON.stringify(value);
        const size = strVal.length; // Approximate bytes

        // Remove old entry size if updating
        const existing = this.l1.get(l1Key);
        if (existing) {
            this.currentL1MemoryBytes -= existing.size;
        }

        this.l1.set(l1Key, {
            data: value,
            expiresAt: Date.now() + (l1Ttl * 1000),
            size: size
        });

        this.currentL1MemoryBytes += size;
        this.evictL1IfNeeded();
    }

    public async set<T>(namespace: string, key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
        if (!ttlSeconds) throw new Error("MissingTTLError: All cache entries must have a TTL.");

        // Write L1
        this.setL1(namespace, key, value, ttlSeconds);

        // Write L2 asynchronously
        if (this.redisHealthy) {
            const l2Key = this.getL2Key(namespace, key);
            this.redis.set(l2Key, JSON.stringify(value), 'EX', ttlSeconds).catch(err => {
                // Fire and forget, don't throw on Redis set errors
            });
        }
    }

    public async redisOnly<T>(namespace: string, key: string): Promise<T | null> {
        if (!this.redisHealthy) return null;
        try {
            const res = await this.redis.get(this.getL2Key(namespace, key));
            return res ? JSON.parse(res) : null;
        } catch (e) {
            return null;
        }
    }

    public async setRedisOnly<T>(namespace: string, key: string, value: T, ttl: number): Promise<void> {
        if (!this.redisHealthy) return;
        try {
            await this.redis.set(this.getL2Key(namespace, key), JSON.stringify(value), 'EX', ttl);
        } catch (e) {
            // Ignore
        }
    }

    public async zadd(ns: string, key: string, score: number, member: string): Promise<void> {
        if (!this.redisHealthy) return;
        await this.redis.zadd(this.getL2Key(ns, key), score, member).catch(() => { });
    }

    public async zrangeByScore(ns: string, key: string, min: number, max: number): Promise<string[]> {
        if (!this.redisHealthy) return [];
        return await this.redis.zrangebyscore(this.getL2Key(ns, key), min, max).catch(() => []) as string[];
    }

    public async zcard(ns: string, key: string): Promise<number> {
        if (!this.redisHealthy) return 0;
        return await this.redis.zcard(this.getL2Key(ns, key)).catch(() => 0) as number;
    }

    public async zremrangebyscore(ns: string, key: string, min: number, max: number): Promise<number> {
        if (!this.redisHealthy) return 0;
        return await this.redis.zremrangebyscore(this.getL2Key(ns, key), min, max).catch(() => 0) as number;
    }

    public async ping(): Promise<boolean> {
        if (!this.redisHealthy) return false;
        try {
            const res = await this.redis.ping();
            return res === 'PONG';
        } catch (e) {
            return false;
        }
    }

    public getStats(): CacheStats {
        const l1Rate = this.totalLookups > 0 ? this.l1Hits / this.totalLookups : 0;
        const l2Rate = this.totalLookups > 0 ? this.l2Hits / this.totalLookups : 0;
        this.cacheStats.l1_size = this.l1.size;
        this.cacheStats.l1_hit_rate = l1Rate;
        this.cacheStats.l2_hit_rate = l2Rate;
        this.cacheStats.total_hit_rate = l1Rate + l2Rate;
        return this.cacheStats;
    }
}
