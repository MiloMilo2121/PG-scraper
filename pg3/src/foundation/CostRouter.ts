import { MemoryFirstCache } from './MemoryFirstCache';
import { CostLedger } from './CostLedger';

export type TaskType = 'SERP' | 'LLM_CLASSIFY' | 'LLM_VISION' | 'PROXY_FETCH' | 'LLM_PARSE';

export interface RouteResult<T = unknown> {
    data: T;
    provider: string;
    tier: number;
    cost_eur: number;
    duration_ms: number;
    cache_hit: boolean;
    cache_level: 'L1' | 'L2' | 'MISS';
}

export interface ProviderBudget {
    requests_per_minute: number;
    current_window_count: number;
    queue_depth: number;
    is_throttled: boolean;
}

export interface ProviderAdapter {
    execute<T>(payload: any, options?: any): Promise<T>;
    costPerRequest: number;
    tier: number;
}

export class ProviderOverloadedError extends Error {
    constructor(provider: string) {
        super(`ProviderOverloadedError: Queue for ${provider} exceeded max depth.`);
        this.name = 'ProviderOverloadedError';
    }
}

export class AllProvidersExhausted extends Error {
    constructor(taskType: string) {
        super(`AllProvidersExhausted: No healthy providers available for ${taskType}.`);
        this.name = 'AllProvidersExhausted';
    }
}

class TokenBucketQueue {
    private maxRpm: number;
    private burst: number;
    private tokens: number;
    private queue: ((value: void) => void)[] = [];
    private refillInterval: NodeJS.Timeout;

    constructor(maxRpm: number, burst: number) {
        this.maxRpm = maxRpm;
        this.burst = burst;
        this.tokens = burst;

        const refillRateMs = (60 / maxRpm) * 1000;
        this.refillInterval = setInterval(() => {
            if (this.tokens < this.burst) {
                this.tokens++;
            }
            if (this.tokens > 0 && this.queue.length > 0) {
                this.tokens--;
                const resolve = this.queue.shift();
                if (resolve) resolve();
            }
        }, refillRateMs);
    }

    public async acquire(): Promise<void> {
        if (this.tokens > 0) {
            this.tokens--;
            return;
        }
        if (this.queue.length >= 20) {
            throw new Error("QUEUE_FULL");
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    public getQueueDepth(): number {
        return this.queue.length;
    }

    public getTokens(): number {
        return this.tokens;
    }

    public cleanup() {
        clearInterval(this.refillInterval);
    }
}

export class CostRouter {
    private cache: MemoryFirstCache;
    private ledger: CostLedger;
    private providers: Map<string, ProviderAdapter>;

    private llmBuckets: Map<string, TokenBucketQueue> = new Map([
        ['deepseek-chat', new TokenBucketQueue(40, 10)],
        ['moonshot-v1-8k', new TokenBucketQueue(20, 5)],
        ['gpt-4o-mini', new TokenBucketQueue(15, 3)],
    ]);

    // Credit tracking
    private credits: Map<string, number> = new Map();

    constructor(
        cache: MemoryFirstCache,
        ledger: CostLedger,
        providers: Map<string, ProviderAdapter>
    ) {
        this.cache = cache;
        this.ledger = ledger;
        this.providers = providers;
    }

    public getBudgetStatus(provider: string): ProviderBudget {
        const bucket = this.llmBuckets.get(provider);
        if (!bucket) {
            return {
                requests_per_minute: Number.MAX_SAFE_INTEGER,
                current_window_count: 0,
                queue_depth: 0,
                is_throttled: false
            };
        }
        return {
            requests_per_minute: 40, // rough
            current_window_count: 0, // not strictly tracked since we use token bucket
            queue_depth: bucket.getQueueDepth(),
            is_throttled: bucket.getTokens() === 0
        };
    }

    public isProviderHealthy(provider: string): boolean {
        const health = this.ledger.getProviderHealth(provider);
        if (health.error_rate > 0.3) {
            return false;
        }
        return true;
    }

    public isProviderDegraded(provider: string): boolean {
        const health = this.ledger.getProviderHealth(provider);
        return health.avg_ms > 10000;
    }

    public async registerCredits(provider: string, balance: number): Promise<void> {
        this.credits.set(provider, balance);
    }

    public async isExhausted(provider: string): Promise<boolean> {
        const c = this.credits.get(provider);
        return c !== undefined && c <= 0;
    }

    public async route<T>(taskType: TaskType, payload: unknown, options?: {
        maxTier?: number;
        skipCache?: boolean;
        abortSignal?: AbortSignal;
        companyId?: string;
    }): Promise<RouteResult<T>> {
        const cacheKey = JSON.stringify({ taskType, payload });

        if (!options?.skipCache) {
            const cached = await this.cache.get<T>('router_cache', cacheKey);
            if (cached.level !== 'MISS' && cached.value !== null) {
                return {
                    data: cached.value,
                    provider: 'cache',
                    tier: 0,
                    cost_eur: 0,
                    duration_ms: 0,
                    cache_hit: true,
                    cache_level: cached.level
                };
            }
        }

        // Waterfall attempt by tier
        const sortedProviders = Array.from(this.providers.entries())
            .filter(([id, adapter]) => !options?.maxTier || adapter.tier <= options.maxTier)
            .sort((a, b) => a[1].tier - b[1].tier);

        for (const [providerId, adapter] of sortedProviders) {
            if (await this.isExhausted(providerId)) continue;
            if (!this.isProviderHealthy(providerId)) continue;

            // Check bucket
            const bucket = this.llmBuckets.get(providerId);
            if (bucket) {
                try {
                    await bucket.acquire();
                } catch (e) {
                    throw new ProviderOverloadedError(providerId);
                }
            }

            const start = Date.now();
            let success = false;
            let errorMsg: string | undefined;
            let resultData: T | undefined;

            try {
                resultData = await adapter.execute<T>(payload, options);
                success = true;
            } catch (err: any) {
                errorMsg = err.message;
            }

            const duration = Date.now() - start;

            await this.ledger.log({
                timestamp: new Date().toISOString(),
                module: 'CostRouter',
                provider: providerId,
                tier: adapter.tier,
                task_type: taskType,
                cost_eur: adapter.costPerRequest,
                cache_hit: false,
                cache_level: 'MISS',
                duration_ms: duration,
                success,
                error: errorMsg,
                company_id: options?.companyId,
            });

            if (success && resultData !== undefined) {
                if (!options?.skipCache) {
                    // Set both caches
                    await this.cache.set('router_cache', cacheKey, resultData, 3600);
                }
                return {
                    data: resultData,
                    provider: providerId,
                    tier: adapter.tier,
                    cost_eur: adapter.costPerRequest,
                    duration_ms: duration,
                    cache_hit: false,
                    cache_level: 'MISS'
                };
            }
        }

        throw new AllProvidersExhausted(taskType);
    }
}
