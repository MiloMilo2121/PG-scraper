
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

/**
 * 🧠 LLM SERVICE
 * Centralized OpenAI client with accurate cost tracking (Law 006)
 * and structured output support (Law 502).
 */
export class LLMService {
    private static totalCost = 0;
    private static openai: OpenAI | null = null;

    private static getClient(): OpenAI {
        if (!LLMService.openai) {
            LLMService.openai = new OpenAI({ apiKey: config.llm.apiKey });
        }
        return LLMService.openai;
    }

    /**
     * Standard text completion — returns raw string response.
     */
    public static async complete(prompt: string, model: string = config.llm.model): Promise<string> {
        const client = LLMService.getClient();

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

            return content;
        } catch (error) {
            Logger.error('[LLM] API call failed', { error: error as Error });
            throw error;
        }
    }

    /**
     * @deprecated Use completeStructured<T>() instead for reliable JSON output.
     * Legacy JSON completion with brittle regex stripping.
     */
    public static async completeJSON<T>(prompt: string): Promise<T | null> {
        const response = await this.complete(prompt + '\nRespond strictly in JSON.');
        try {
            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            Logger.error('[LLM] JSON Parse Error', { error: e as Error });
            return null;
        }
    }

    /**
     * 🎯 STRUCTURED OUTPUT COMPLETION (Law 502)
     * Uses OpenAI's json_schema response format for guaranteed valid JSON.
     * Schema must follow JSON Schema spec with all fields required.
     *
     * @param prompt - The user prompt
     * @param schema - JSON Schema object defining the response structure
     * @param model - Model to use (defaults to fast model for cost efficiency)
     * @returns Parsed response object, or null on failure
     */
    public static async completeStructured<T>(
        prompt: string,
        schema: Record<string, unknown>,
        model: string = config.llm.fastModel
    ): Promise<T | null> {
        const client = LLMService.getClient();

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: config.llm.maxTokens,
                response_format: {
                    type: 'json_schema' as const,
                    json_schema: {
                        name: 'validation_result',
                        strict: true,
                        schema,
                    },
                } as any, // OpenAI SDK types may lag behind API features
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                Logger.warn('[LLM] Structured output returned empty content');
                return null;
            }

            const usage = response.usage;
            if (usage) {
                this.trackCost(usage.prompt_tokens, usage.completion_tokens, model);
            }

            return JSON.parse(content) as T;
        } catch (error) {
            Logger.error('[LLM] Structured output call failed', { error: error as Error });
            return null;
        }
    }

    /**
     * 💰 COST TRACKING (Law 001: fixed from legacy $0.03/1k to accurate $/1M pricing)
     * Reads per-model pricing from centralized config — no hardcoded magic numbers.
     */
    private static trackCost(inputTokens: number, outputTokens: number, model: string) {
        const DEFAULT_MODEL_KEY = 'gpt-4o-mini';
        const pricing = config.llm.pricing[model] ?? config.llm.pricing[DEFAULT_MODEL_KEY];

        if (!pricing) {
            Logger.warn(`[LLM] No pricing entry for model "${model}", skipping cost tracking`);
            return;
        }

        const cost =
            (inputTokens / 1_000_000) * pricing.inputPer1M +
            (outputTokens / 1_000_000) * pricing.outputPer1M;

        this.totalCost += cost;
        Logger.info(`[LLM] Cost: $${cost.toFixed(6)} (Session Total: $${this.totalCost.toFixed(6)}) [${model}]`);
    }

    /**
     * Content Truncation — rough char-based token approximation.
     */
    public static truncate(content: string, maxTokens: number = 2000): string {
        return content.slice(0, maxTokens * 4); // ~4 chars per token approximation
    }

    public static getTotalCost(): number {
        return this.totalCost;
    }

    /** Reset session cost counter (useful for per-batch tracking). */
    public static resetCost(): void {
        this.totalCost = 0;
    }
}
