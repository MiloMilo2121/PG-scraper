
import Redis from 'ioredis';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import * as crypto from 'crypto';

export class LLMCache {
    private static instance: LLMCache;
    private redis: Redis | null = null;
    private readonly TTL_SECONDS = 60 * 60 * 24 * 30; // 30 Days

    private constructor() {
        // Fallback to localhost if not in env (e.g. testing script)
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        try {
            // Lazy connect to avoid blocking if Redis is down
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => Math.min(times * 50, 2000),
                lazyConnect: true
            });

            this.redis.on('error', (err) => {
                // Suppress excessive logging for connection refused in dev/test
                if ((err as any).code === 'ECONNREFUSED') return;
                Logger.warn('[LLMCache] Redis error', { error: err });
            });

            // Trigger connection
            this.redis.connect().catch(() => { });

        } catch (e) {
            Logger.warn('[LLMCache] Failed to initialize Redis', { error: e as Error });
        }
    }

    public static getInstance(): LLMCache {
        if (!LLMCache.instance) {
            LLMCache.instance = new LLMCache();
        }
        return LLMCache.instance;
    }

    public async get(prompt: string, model: string): Promise<string | null> {
        if (!this.redis) return null;
        const key = this.generateKey(prompt, model);
        try {
            const cached = await this.redis.get(key);
            if (cached) {
                // Use debug log or conditioned info to avoid spam
                if (process.env.DEBUG_LLM) Logger.info(`[LLMCache] 🟢 Hit for ${key.substring(0, 10)}...`);
                return cached;
            }
        } catch (e) {
            // Ignore redis errors
        }
        return null;
    }

    public async set(prompt: string, model: string, response: string): Promise<void> {
        if (!this.redis) return;
        const key = this.generateKey(prompt, model);
        try {
            await this.redis.set(key, response, 'EX', this.TTL_SECONDS);
        } catch (e) {
            Logger.warn('[LLMCache] Failed to set cache', { error: e as Error });
        }
    }

    private generateKey(prompt: string, model: string): string {
        const hash = crypto.createHash('md5').update(prompt.trim()).digest('hex');
        return `llm:cache:${model}:${hash}`;
    }
}
