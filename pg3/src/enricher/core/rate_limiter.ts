
import { config } from '../config';

export interface RateLimiter {
    waitForSlot(domain: string): Promise<void>;
    reportSuccess(domain: string): void;
    reportFailure(domain: string): void;
}

export class MemoryRateLimiter implements RateLimiter {
    private lastAccess: Map<string, number> = new Map();
    private minDelay: number;

    constructor(minDelayMs: number = 2000) {
        this.minDelay = minDelayMs;
    }

    async waitForSlot(domain: string): Promise<void> {
        const now = Date.now();
        const last = this.lastAccess.get(domain) || 0;
        const diff = now - last;

        if (diff < this.minDelay) {
            const waitTime = this.minDelay - diff;
            await new Promise(r => setTimeout(r, waitTime));
        }

        this.lastAccess.set(domain, Date.now());
    }

    reportSuccess(domain: string): void {
        // Simple backoff reduction could go here
    }

    reportFailure(domain: string): void {
        // Simple backoff increase could go here
    }
}

export class RedisRateLimiter implements RateLimiter {
    private client: any; // Use 'ioredis' type in production

    constructor() {
        if (config.redis.host) {
            // this.client = new Redis(config.redis)
            console.log("Redis Rate Limiter initialized (Mock)");
        }
    }

    async waitForSlot(domain: string): Promise<void> {
        // Mock implementation for now
        await new Promise(r => setTimeout(r, 100));
    }

    reportSuccess(domain: string): void { }
    reportFailure(domain: string): void { }
}
