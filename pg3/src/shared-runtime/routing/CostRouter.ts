import { MemoryFirstCache } from '../cache/MemoryFirstCache';
import { CostLedger } from '../budget/CostLedger';
import { config } from '../config/runtime_config';
import { ProviderAdapter, ProviderOrderByFamily, ProviderTaskFamily } from './provider_adapter';

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

const TASK_FAMILY_BY_TASK_TYPE: Partial<Record<TaskType, ProviderTaskFamily>> = {
    SERP: 'SERP',
    PROXY_FETCH: 'PROXY_FETCH',
    LLM_CLASSIFY: 'LLM',
    LLM_PARSE: 'LLM',
    LLM_VISION: 'LLM',
};

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
    private providerOrderByFamily: ProviderOrderByFamily;
    private providerCooldowns: Map<string, number> = new Map();

    private llmBuckets: Map<string, TokenBucketQueue> = new Map([
        ['deepseek-chat', new TokenBucketQueue(40, 10)],
        ['kimi-k2.5', new TokenBucketQueue(20, 5)],
        ['glm-4.7-flash', new TokenBucketQueue(60, 15)],  // FREE tier — generous limits
        ['glm-5', new TokenBucketQueue(20, 5)],
        ['gpt-5-mini', new TokenBucketQueue(20, 5)],
        ['gpt-4o-mini', new TokenBucketQueue(15, 3)],
    ]);

    // Credit tracking
    private credits: Map<string, number> = new Map();

    constructor(
        cache: MemoryFirstCache,
        ledger: CostLedger,
        providers: Map<string, ProviderAdapter>,
        providerOrderByFamily: ProviderOrderByFamily = {},
    ) {
        this.cache = cache;
        this.ledger = ledger;
        this.providers = providers;
        this.providerOrderByFamily = providerOrderByFamily;
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
        const cooldownUntil = this.providerCooldowns.get(provider) ?? 0;
        if (cooldownUntil > Date.now()) {
            return false;
        }

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

        const requestedFamily = TASK_FAMILY_BY_TASK_TYPE[taskType] ?? null;
        const providerOrder = requestedFamily
            ? [...(this.providerOrderByFamily[requestedFamily] ?? [])]
            : [];
        const orderMap = new Map(providerOrder.map((providerId, index) => [providerId, index]));

        const sortedProviders = Array.from(this.providers.entries())
            .filter(([, adapter]) => {
                if (!requestedFamily) {
                    return true;
                }

                return adapter.family === requestedFamily;
            })
            .filter(([, adapter]) => !options?.maxTier || adapter.tier <= options.maxTier)
            .sort((a, b) => {
                if (orderMap.size > 0) {
                    return (orderMap.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b[0]) ?? Number.MAX_SAFE_INTEGER);
                }
                return a[1].tier - b[1].tier;
            });

        const failures: { provider: string; error: string; status?: number }[] = [];

        for (const [providerId, adapter] of sortedProviders) {
            if (!this.hasRequiredCredential(providerId)) {
                failures.push({ provider: providerId, error: 'MissingCredential' });
                continue;
            }
            if (await this.isExhausted(providerId)) {
                failures.push({ provider: providerId, error: 'Exhausted/RateLimited' });
                continue;
            }
            if (!this.isProviderHealthy(providerId)) {
                failures.push({ provider: providerId, error: this.getCooldownRemainingMs(providerId) > 0 ? 'CoolingDown' : 'Unhealthy' });
                continue;
            }

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
            let statusCode: number | undefined;

            try {
                resultData = await adapter.execute<T>(payload, options);

                // If a SERP provider returns 0 results, it's a silent block (captcha/ban), so we failover
                if (taskType === 'SERP' && Array.isArray(resultData) && resultData.length === 0) {
                    throw new Error('SERP_EMPTY_RESULT');
                }

                success = true;
            } catch (err: any) {
                const messageString = err.message || 'Unknown';
                errorMsg = messageString;
                statusCode = err.response?.status || (messageString.includes('401') ? 401 : messageString.includes('403') ? 403 : messageString.includes('400') ? 400 : undefined);

                // If Tor is unreachable, immediately exhaust all Tier 0/1 Tor providers
                if (messageString.includes('Tor ControlPort')) {
                    this.credits.set(providerId, 0);
                }

                // If API returns 400/402 (Not enough credits) or 401, mark exhausted
                if (statusCode === 400 || statusCode === 402 || statusCode === 401) {
                    this.credits.set(providerId, 0);
                }
                
                // For 403/429, only exhaust if it's a direct API provider, NOT a proxy-scraping provider where 403 is just a target website block
                if (statusCode === 403 || statusCode === 429) {
                    const providerIdLower = providerId.toLowerCase();
                    const isDirectApi = providerIdLower.includes('serper')
                        || providerIdLower.includes('jina')
                        || providerIdLower.includes('tavily')
                        || providerIdLower.includes('brave-api')
                        || providerIdLower.includes('exa')
                        || providerIdLower.includes('k2')
                        || providerIdLower.includes('glm')
                        || providerIdLower.includes('gpt')
                        || providerIdLower.includes('deepseek')
                        || providerIdLower.includes('kimi')
                        || providerIdLower.includes('perplexity')
                        || messageString.includes('insufficient_quota');
                    if (isDirectApi) {
                        this.credits.set(providerId, 0);
                    }
                }

                failures.push({ provider: providerId, error: errorMsg || 'Unknown', status: statusCode });
                console.error(`[CostRouter] Provider ${providerId} failed: ${errorMsg}`);
            }

            const duration = Date.now() - start;

            const classification = this.classifyError(errorMsg, statusCode);
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
                error_class: classification.errorClass,
                punitive: classification.punitive,
                company_id: options?.companyId,
            });

            if (!success) {
                this.registerCooldown(providerId, classification);
            } else {
                this.providerCooldowns.delete(providerId);
            }

            if (success && resultData !== undefined) {
                if (!options?.skipCache) {
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

        // EVALUATE FREE-ONLY FALLBACK IF ALL PAID APIS FAILED DUE TO AUTH
        const authFailures = failures.filter(f => f.status === 401 || f.status === 403 || f.error.includes('auth') || f.error.includes('400'));
        if (authFailures.length > 0 && authFailures.length === failures.filter(f => f.error !== 'Exhausted/RateLimited' && f.error !== 'Unhealthy').length) {
            console.warn(`[CostRouter] ⚠️ All paid providers failed with auth errors. Falling back to FREE-ONLY mode.`);

            const freeProviders = Array.from(this.providers.entries()).filter(([id, adapter]) => adapter.tier <= 1 && !failures.find(f => f.provider === id && f.error !== 'Unhealthy'));
            for (const [providerId, adapter] of freeProviders) {
                try {
                    const resultData = await adapter.execute<T>(payload, options);
                    return {
                        data: resultData,
                        provider: providerId + '_FREE_FALLBACK',
                        tier: adapter.tier,
                        cost_eur: 0,
                        duration_ms: 0,
                        cache_hit: false,
                        cache_level: 'MISS'
                    };
                } catch (e) {
                    // Ignore free fallback errors
                }
            }
        }

        throw new AllProvidersExhausted(taskType);
    }

    public cleanup(): void {
        for (const [, bucket] of this.llmBuckets) {
            bucket.cleanup();
        }
    }

    private classifyError(errorMsg?: string, statusCode?: number): { errorClass: 'provider_auth' | 'provider_rate_limit' | 'provider_block' | 'semantic_empty' | 'transport' | 'unknown'; punitive: boolean } {
        const message = (errorMsg || '').toLowerCase();

        if (message.includes('serp_empty_result')) {
            return { errorClass: 'semantic_empty', punitive: false };
        }
        if (
            statusCode === 400 ||
            message.includes('400 bad request') ||
            message.includes('out of credits') ||
            message.includes('quota') ||
            message.includes('credit exhausted')
        ) {
            return { errorClass: 'provider_auth', punitive: false };
        }
        if (statusCode === 401 || statusCode === 402 || message.includes('auth') || message.includes('api_key')) {
            return { errorClass: 'provider_auth', punitive: false };
        }
        if (statusCode === 429 || message.includes('rate') || message.includes('queue_full')) {
            return { errorClass: 'provider_rate_limit', punitive: true };
        }
        if (statusCode === 403 || message.includes('captcha') || message.includes('block')) {
            return { errorClass: 'provider_block', punitive: true };
        }
        if (message.includes('timeout') || message.includes('econn') || message.includes('socket') || message.includes('network')) {
            return { errorClass: 'transport', punitive: true };
        }
        return { errorClass: 'unknown', punitive: true };
    }

    private hasRequiredCredential(providerId: string): boolean {
        const envKey = this.getRequiredCredentialEnvKey(providerId);
        if (!envKey) {
            return true;
        }

        const raw = process.env[envKey]?.trim() || '';
        return raw.length > 0 && raw !== '...' && !raw.toLowerCase().includes('your-');
    }

    private getRequiredCredentialEnvKey(providerId: string): string | null {
        const envMap: Record<string, string> = {
            'SERPER-API-1': 'SERPER_API_KEY',
            'EXA-API-2': 'EXA_API_KEY',
            'BRAVE-API-1': 'BRAVE_SEARCH_API_KEY',
            'TAVILY-API-2': 'TAVILY_API_KEY',
            'PERPLEXITY-API-4': 'PERPLEXITY_API_KEY',
            'FIRECRAWL-SCRAPE-3': 'FIRECRAWL_API_KEY',
            'OPENAI-1': 'OPENAI_API_KEY',
            'OPENROUTER-2': 'OPENROUTER_API_KEY',
            'PERPLEXITY-1': 'PERPLEXITY_API_KEY',
            'DEEPSEEK-1': 'DEEPSEEK_API_KEY',
            'KIMI-1': 'KIMI_API_KEY',
            'ZAI-1': 'Z_AI_API_KEY',
        };

        return envMap[providerId] || null;
    }

    private registerCooldown(
        providerId: string,
        classification: { errorClass: 'provider_auth' | 'provider_rate_limit' | 'provider_block' | 'semantic_empty' | 'transport' | 'unknown'; punitive: boolean },
    ): void {
        if (!classification.punitive) {
            return;
        }

        const cooldownMs = this.getCooldownMs(classification.errorClass);
        if (cooldownMs <= 0) {
            return;
        }

        const until = Date.now() + cooldownMs;
        const existing = this.providerCooldowns.get(providerId) ?? 0;
        if (until > existing) {
            this.providerCooldowns.set(providerId, until);
        }
    }

    private getCooldownMs(errorClass: 'provider_auth' | 'provider_rate_limit' | 'provider_block' | 'semantic_empty' | 'transport' | 'unknown'): number {
        if (errorClass === 'provider_block' || errorClass === 'provider_rate_limit') {
            return config.proxy.failureCooldownMs;
        }
        if (errorClass === 'transport' || errorClass === 'unknown') {
            return Math.max(15000, Math.floor(config.proxy.failureCooldownMs / 10));
        }
        return 0;
    }

    private getCooldownRemainingMs(providerId: string): number {
        const cooldownUntil = this.providerCooldowns.get(providerId) ?? 0;
        return Math.max(0, cooldownUntil - Date.now());
    }
}
