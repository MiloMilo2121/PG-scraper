
/**
 * 🚦 RATE LIMITER & CIRCUIT BREAKER 🚦
 * Tasks 26, 27
 */

export class RateLimiter {
    private static lastRequestTime: Record<string, number> = {};
    private static failureCount: Record<string, number> = {};

    // Config
    private static MIN_DELAY_MS = 2000; // 2s default between requests to same domain
    private static MAX_RETRIES = 3;

    /**
     * Waits for the appropriate cooldown period for a domain.
     * Task 26: Politeness Policy
     */
    static async waitForDomain(domain: string): Promise<void> {
        const now = Date.now();
        const last = this.lastRequestTime[domain] || 0;
        const diff = now - last;

        if (diff < this.MIN_DELAY_MS) {
            const wait = this.MIN_DELAY_MS - diff;
            await new Promise(r => setTimeout(r, wait));
        }

        this.lastRequestTime[domain] = Date.now();
    }

    /**
     * Registers a failure and returns the delay for the next attempt (Exponential Backoff).
     * Task 27: Exponential Backoff
     * Returns -1 if max retries exceeded.
     */
    static reportFailure(domain: string): number {
        const currentFailures = (this.failureCount[domain] || 0) + 1;
        this.failureCount[domain] = currentFailures;

        if (currentFailures > this.MAX_RETRIES) {
            return -1; // Circuit Broken
        }

        // 2s, 4s, 8s, 16s...
        const backoff = Math.pow(2, currentFailures) * 1000;
        return backoff;
    }

    static reportSuccess(domain: string): void {
        this.failureCount[domain] = 0;
    }

    static isBlocked(domain: string): boolean {
        return (this.failureCount[domain] || 0) > this.MAX_RETRIES;
    }
}
