/**
 * 🎯 RATE LIMITER
 * Task 29: Prevent API rate limit errors with local throttling
 */

export class RateLimiter {
    private tokens: number;
    private maxTokens: number;
    private refillRate: number;
    private lastRefill: number;
    private queue: Array<() => void> = [];

    constructor(maxRequestsPerMinute: number = 60) {
        this.maxTokens = maxRequestsPerMinute;
        this.tokens = maxRequestsPerMinute;
        this.refillRate = maxRequestsPerMinute / 60; // Tokens per second
        this.lastRefill = Date.now();
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }

    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Wait for token
        const waitTime = (1 - this.tokens) / this.refillRate * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.tokens = 0;
    }

    /**
     * Wrap a function with rate limiting
     */
    wrap<T>(fn: () => Promise<T>): () => Promise<T> {
        return async () => {
            await this.acquire();
            return fn();
        };
    }
}

// Default limiter for OpenAI (60 RPM for most tiers)
export const openaiLimiter = new RateLimiter(60);
