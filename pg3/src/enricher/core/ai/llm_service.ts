
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

// LLM response cache - avoids duplicate API calls for the same prompt
interface CacheEntry { result: string; expiry: number }

export class LLMService {
    private static totalCost = 0;
    private static openai: OpenAI | null = null;
    private static cache = new Map<string, CacheEntry>();
    private static readonly CACHE_TTL_MS = config.llm.cacheTtlMs;
    private static readonly CACHE_MAX_SIZE = config.llm.cacheMaxEntries;

    private static getClient(): OpenAI {
        if (!LLMService.openai) {
            LLMService.openai = new OpenAI({ apiKey: config.llm.apiKey });
        }
        return LLMService.openai;
    }

    private static getCacheKey(prompt: string, model: string): string {
        // Simple hash - first 100 + last 100 chars + length
        return `${prompt.slice(0, 100)}|${prompt.slice(-100)}|${prompt.length}|${model}`;
    }

    public static async complete(prompt: string, model: string = config.llm.model): Promise<string> {
        const client = LLMService.getClient();
        const cacheKey = this.getCacheKey(prompt, model);

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiry > Date.now()) {
            return cached.result;
        }

        try {
            const response = await client.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: config.llm.maxTokens,
            });

            const content = response.choices[0]?.message?.content || '';
            const usage = response.usage;

            if (usage) {
                this.trackCost(usage.prompt_tokens, usage.completion_tokens, model);
            }

            // Cache the result
            if (this.cache.size >= this.CACHE_MAX_SIZE) {
                const oldest = this.cache.keys().next().value;
                if (oldest) this.cache.delete(oldest);
            }
            this.cache.set(cacheKey, { result: content, expiry: Date.now() + this.CACHE_TTL_MS });

            return content;
        } catch (error) {
            Logger.error('[LLM] API call failed', { error: error as Error });
            throw error;
        }
    }

    /**
     * Use structured JSON output mode when the model supports it.
     * Falls back to regex extraction if json_object mode fails.
     */
    public static async completeJSON<T>(prompt: string): Promise<T | null> {
        const client = this.getClient();
        const model = config.llm.model;
        const cacheKey = this.getCacheKey(prompt + '|JSON', model);

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiry > Date.now()) {
            try { return JSON.parse(cached.result) as T; } catch { /* fall through */ }
        }

        try {
            // Use response_format: json_object for models that support it (gpt-4o, gpt-4o-mini, etc.)
            const supportsJsonMode = model.includes('gpt-4o') || model.includes('gpt-4-turbo') || model.includes('gpt-3.5-turbo');
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'You respond with strict JSON only. No markdown, no explanation.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
                max_tokens: config.llm.maxTokens,
                ...(supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
            });

            const content = response.choices[0]?.message?.content || '';
            const usage = response.usage;
            if (usage) this.trackCost(usage.prompt_tokens, usage.completion_tokens, model);

            // Cache raw response
            if (this.cache.size >= this.CACHE_MAX_SIZE) {
                const oldest = this.cache.keys().next().value;
                if (oldest) this.cache.delete(oldest);
            }
            this.cache.set(cacheKey, { result: content, expiry: Date.now() + this.CACHE_TTL_MS });

            // Parse JSON - strip markdown fences if present
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            Logger.error('[LLM] JSON Parse/API Error', { error: e as Error });
            return null;
        }
    }

    // Updated pricing for current models (2026)
    private static trackCost(inputTokens: number, outputTokens: number, model: string) {
        let pricePer1kInput: number;
        let pricePer1kOutput: number;

        if (model.includes('gpt-4o-mini')) {
            pricePer1kInput = 0.00015;  // $0.15/1M
            pricePer1kOutput = 0.0006;  // $0.60/1M
        } else if (model.includes('gpt-4o')) {
            pricePer1kInput = 0.0025;   // $2.50/1M
            pricePer1kOutput = 0.01;    // $10/1M
        } else if (model.includes('gpt-4')) {
            pricePer1kInput = 0.03;
            pricePer1kOutput = 0.06;
        } else {
            // gpt-3.5-turbo or unknown
            pricePer1kInput = 0.0005;
            pricePer1kOutput = 0.0015;
        }

        const cost = (inputTokens / 1000 * pricePer1kInput) + (outputTokens / 1000 * pricePer1kOutput);
        this.totalCost += cost;
        Logger.info(`[LLM] Cost: $${cost.toFixed(4)} (Session Total: $${this.totalCost.toFixed(4)})`);
    }

    // Content Truncation
    public static truncate(content: string, maxTokens: number = 2000): string {
        return content.slice(0, maxTokens * 4); // Approximation: ~4 chars per token
    }

    public static getTotalCost(): number {
        return this.totalCost;
    }
}
