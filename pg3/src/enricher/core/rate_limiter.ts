import { Logger } from '../utils/logger';

export interface RateLimiter {
    waitForSlot(domain: string): Promise<void>;
    reportSuccess(domain: string): void;
    reportFailure(domain: string): void;
}

interface DomainState {
    lastAccess: number;
    currentDelay: number;
    consecutiveFailures: number;
    cooldownUntil: number;
}

/**
 * Adaptive host limiter:
 * - per-domain pacing
 * - exponential backoff on failure
 * - temporary cooldown circuit breaker after repeated failures
 */
export class MemoryRateLimiter implements RateLimiter {
    private domains: Map<string, DomainState> = new Map();
    private readonly minDelay: number;
    private readonly maxDelay: number;
    private readonly backoffFactor: number;
    private readonly recoveryFactor: number;
    private readonly cooldownThreshold: number;
    private readonly jitterMs: number;

    constructor(minDelayMs: number = 1500, maxDelayMs: number = 30000) {
        this.minDelay = minDelayMs;
        this.maxDelay = maxDelayMs;
        this.backoffFactor = 2.0;
        this.recoveryFactor = 0.75;
        this.cooldownThreshold = 3;
        this.jitterMs = 120;
    }

    private getState(domain: string): DomainState {
        if (!this.domains.has(domain)) {
            this.domains.set(domain, {
                lastAccess: 0,
                currentDelay: this.minDelay,
                consecutiveFailures: 0,
                cooldownUntil: 0,
            });
        }
        return this.domains.get(domain)!;
    }

    async waitForSlot(domain: string): Promise<void> {
        const state = this.getState(domain);
        const now = Date.now();

        if (state.cooldownUntil > now) {
            const cooldownWait = state.cooldownUntil - now;
            await new Promise((r) => setTimeout(r, cooldownWait));
        }

        const elapsed = Date.now() - state.lastAccess;
        const jitter = Math.floor(Math.random() * this.jitterMs);

        if (elapsed < state.currentDelay) {
            const waitTime = state.currentDelay - elapsed + jitter;
            await new Promise((r) => setTimeout(r, waitTime));
        }

        state.lastAccess = Date.now();
    }

    reportSuccess(domain: string): void {
        const state = this.getState(domain);
        state.consecutiveFailures = 0;
        state.cooldownUntil = 0;
        state.currentDelay = Math.max(this.minDelay, state.currentDelay * this.recoveryFactor);
    }

    reportFailure(domain: string): void {
        const state = this.getState(domain);
        state.consecutiveFailures++;
        state.currentDelay = Math.min(this.maxDelay, state.currentDelay * this.backoffFactor);

        if (state.consecutiveFailures >= this.cooldownThreshold) {
            const cooldownMs = Math.min(120000, state.currentDelay * 2);
            state.cooldownUntil = Date.now() + cooldownMs;
        }

        Logger.warn(
            `[RateLimiter] ${domain} backoff -> ${Math.round(state.currentDelay)}ms (failures: ${state.consecutiveFailures})`
        );
    }
}
