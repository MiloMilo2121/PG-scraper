/**
 * 🚦 OMEGA V9: TOKEN BUCKET & JITTER RATE LIMITER
 * Task 4.1: Mathematical traffic shaping to bypass WAF traffic analysis.
 * 
 * Features:
 * - Token Bucket Algorithm allowing burst traffic but strictly capping sustained rate
 * - Stochastic Jitter (Log-Normal distribution) added to all requests
 * - Target-aware circuit breaking (WAF 429 backoff)
 */

import { Logger } from '../utils/logger';

export interface RateLimiterV9 {
    waitForSlot(domain: string): Promise<void>;
    reportSuccess(domain: string): void;
    reportFailure(domain: string, isRateLimit?: boolean): void;
}

interface TokenBucketState {
    tokens: number;
    lastRefill: number;
    capacity: number;
    fillRatePerMs: number;
    consecutiveFailures: number;
    cooldownUntil: number;
    wafsTriggered: number;
}

export class TokenBucketRateLimiter implements RateLimiterV9 {
    private buckets: Map<string, TokenBucketState> = new Map();

    // Config
    private readonly defaultCapacity: number;
    private readonly defaultFillRateMs: number;
    private readonly baseJitterMs: number;

    constructor(
        tokensPerSecond: number = 0.5, // 1 request every 2 seconds average
        burstCapacity: number = 3,
        baseJitterMs: number = 500
    ) {
        this.defaultCapacity = burstCapacity;
        this.defaultFillRateMs = tokensPerSecond / 1000;
        this.baseJitterMs = baseJitterMs;
    }

    private getBucket(domain: string): TokenBucketState {
        const now = Date.now();
        if (!this.buckets.has(domain)) {
            this.buckets.set(domain, {
                tokens: this.defaultCapacity, // Start full
                lastRefill: now,
                capacity: this.defaultCapacity,
                fillRatePerMs: this.defaultFillRateMs,
                consecutiveFailures: 0,
                cooldownUntil: 0,
                wafsTriggered: 0
            });
        }

        const bucket = this.buckets.get(domain)!;
        this.refill(bucket, now);
        return bucket;
    }

    private refill(bucket: TokenBucketState, now: number) {
        if (bucket.lastRefill >= now) return;

        const elapsed = now - bucket.lastRefill;
        const newTokens = elapsed * bucket.fillRatePerMs;

        bucket.tokens = Math.min(bucket.capacity, bucket.tokens + newTokens);
        bucket.lastRefill = now;
    }

    async waitForSlot(domain: string): Promise<void> {
        const bucket = this.getBucket(domain);
        let now = Date.now();

        // 1. Circuit Breaker Check
        if (bucket.cooldownUntil > now) {
            const waitMs = bucket.cooldownUntil - now;
            Logger.debug(`[RateLimiterV9] 🚦 ${domain} in cooldown. Sleeping ${waitMs}ms`);
            await this.sleep(waitMs);
            now = Date.now();
        }

        // 2. Token Bucket Consumption
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
        } else {
            // Need to wait for 1 token to refill
            const deficit = 1 - bucket.tokens;
            const timeToRefillMs = deficit / bucket.fillRatePerMs;
            await this.sleep(timeToRefillMs);
            now = Date.now();
            this.refill(bucket, now);
            bucket.tokens -= 1;
        }

        // 3. Apply Biometric Jitter
        // WAFs look for EXACT 2000ms gaps. We apply a log-normal statistical jitter.
        const jitter = this.getLogNormalJitter(this.baseJitterMs);
        await this.sleep(jitter);
    }

    reportSuccess(domain: string): void {
        const bucket = this.getBucket(domain);
        bucket.consecutiveFailures = 0;
        // Slowly heal the capacity if it was degraded
        bucket.capacity = Math.min(this.defaultCapacity, bucket.capacity + 0.1);
    }

    reportFailure(domain: string, isRateLimit: boolean = false): void {
        const bucket = this.getBucket(domain);
        bucket.consecutiveFailures++;

        if (isRateLimit) {
            bucket.wafsTriggered++;
            bucket.tokens = 0; // Drain bucket
            // Exponential backoff
            const backoffMinutes = Math.pow(2, bucket.wafsTriggered);
            const cooldownMs = Math.min(3600000, backoffMinutes * 60 * 1000); // Max 1 hour max penalty

            bucket.cooldownUntil = Date.now() + cooldownMs;

            Logger.warn(`🚨 [RateLimiterV9] WAF 429 triggered on ${domain}! Circuit broken for ${backoffMinutes} minutes.`);
        } else {
            // Standard failure (timeout etc)
            if (bucket.consecutiveFailures > 3) {
                // Minor backoff 5 seconds
                bucket.cooldownUntil = Date.now() + 5000;
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    /**
     * Stochastically generates a jitter clustered around the baseJitterMs
     * but strictly bounded and mathematically non-linear.
     */
    private getLogNormalJitter(meanMs: number): number {
        const u = 1 - Math.random();
        const v = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

        const min = meanMs * 0.2;
        const max = meanMs * 3.0;
        const stdDev = meanMs * 0.5;

        let result = Math.round(meanMs + z * stdDev);
        return Math.max(min, Math.min(result, max));
    }
}
