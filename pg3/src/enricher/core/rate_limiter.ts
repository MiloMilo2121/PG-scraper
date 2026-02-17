
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
}

/**
 * Adaptive rate limiter with exponential backoff on failure
 * and gradual speedup on success.
 */
export class MemoryRateLimiter implements RateLimiter {
    private domains: Map<string, DomainState> = new Map();
    private readonly minDelay: number;
    private readonly maxDelay: number;
    private readonly backoffFactor: number;
    private readonly recoveryFactor: number;

    constructor(minDelayMs: number = 1500, maxDelayMs: number = 30000) {
        this.minDelay = minDelayMs;
        this.maxDelay = maxDelayMs;
        this.backoffFactor = 2.0;
        this.recoveryFactor = 0.75;
    }

    private getState(domain: string): DomainState {
        if (!this.domains.has(domain)) {
            this.domains.set(domain, {
                lastAccess: 0,
                currentDelay: this.minDelay,
                consecutiveFailures: 0,
            });
        }
        return this.domains.get(domain)!;
    }

    async waitForSlot(domain: string): Promise<void> {
        const state = this.getState(domain);
        const now = Date.now();
        const elapsed = now - state.lastAccess;

        if (elapsed < state.currentDelay) {
            const waitTime = state.currentDelay - elapsed;
            await new Promise(r => setTimeout(r, waitTime));
        }

        state.lastAccess = Date.now();
    }

    reportSuccess(domain: string): void {
        const state = this.getState(domain);
        state.consecutiveFailures = 0;
        // Gradually reduce delay on success (but never below minimum)
        state.currentDelay = Math.max(this.minDelay, state.currentDelay * this.recoveryFactor);
    }

    reportFailure(domain: string): void {
        const state = this.getState(domain);
        state.consecutiveFailures++;
        // Exponential backoff on failure (capped at maxDelay)
        state.currentDelay = Math.min(
            this.maxDelay,
            state.currentDelay * this.backoffFactor
        );
        Logger.warn(`[RateLimiter] ${domain} backoff -> ${Math.round(state.currentDelay)}ms (failures: ${state.consecutiveFailures})`);
    }
}
