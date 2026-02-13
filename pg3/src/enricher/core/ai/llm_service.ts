
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

/**
 * 🧠 LLM SERVICE — Centralized AI Gateway
 *
 * Single point of access for ALL LLM calls across the application.
 * Handles provider selection (Z.ai / OpenAI), cost tracking (Law 006),
 * structured JSON output (Law 502), and vision analysis.
 *
 * NO other module should instantiate OpenAI directly — use this service.
 */
export class LLMService {
    private static totalCost = 0;
    private static client: OpenAI | null = null;

    // ─────────────────────────────────────────────
    // CLIENT MANAGEMENT
    // ─────────────────────────────────────────────

    /**
     * Singleton client factory. Uses Z.ai if API key is configured, otherwise OpenAI.
     * Called lazily on first LLM call.
     */
    public static getClient(): OpenAI {
        if (!LLMService.client) {
            if (config.llm.z_ai.apiKey) {
                Logger.info('🧠 [LLMService] Initializing Z.ai (GLM-5) Client...');
                LLMService.client = new OpenAI({
                    apiKey: config.llm.z_ai.apiKey,
                    baseURL: config.llm.z_ai.baseUrl,
                });
            } else if (config.llm.apiKey) {
                Logger.info('🧠 [LLMService] Initializing OpenAI Client...');
                LLMService.client = new OpenAI({ apiKey: config.llm.apiKey });
            } else {
                throw new Error('⛔ No LLM API key configured. Set Z_AI_API_KEY or OPENAI_API_KEY.');
            }
        }
        return LLMService.client;
    }

    /** Returns true if Z.ai is the active provider. */
    public static isZAI(): boolean {
        return !!config.llm.z_ai.apiKey;
    }

    // ─────────────────────────────────────────────
    // COMPLETIONS
    // ─────────────────────────────────────────────

    /**
     * Standard text completion — returns raw string response.
     * Uses the configured smart model by default.
     */
    public static async complete(prompt: string, model: string = config.llm.model): Promise<string> {
        const client = this.getClient();

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: config.llm.temperature,
                max_tokens: config.llm.maxTokens,
            });

            const content = response.choices[0]?.message?.content || '';
            this.trackUsage(response.usage, model);

            return content;
        } catch (error) {
            Logger.error('[LLM] complete() failed', { error: error as Error });
            throw error;
        }
    }

    /**
     * 🎯 STRUCTURED OUTPUT — Guaranteed valid JSON (Law 502).
     * Uses json_schema response format. Falls back to markdown stripping if model
     * wraps output in ```json blocks (common with GLM models).
     *
     * @param prompt   - The user prompt
     * @param schema   - JSON Schema object defining the response structure
     * @param model    - Model to use (defaults to fast model for cost efficiency)
     * @returns Parsed response object, or null on failure
     */
    public static async completeStructured<T>(
        prompt: string,
        schema: Record<string, unknown>,
        model: string = config.llm.fastModel
    ): Promise<T | null> {
        const client = this.getClient();

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: config.llm.temperature,
                max_tokens: config.llm.maxTokens,
                response_format: {
                    type: 'json_schema' as const,
                    json_schema: {
                        name: 'validation_result',
                        strict: true,
                        schema,
                    },
                } as any, // SDK types may lag behind API features
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                Logger.warn('[LLM] Structured output returned empty content');
                return null;
            }

            this.trackUsage(response.usage, model);

            // GLM models may wrap JSON in markdown blocks even with json_schema mode
            const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanContent) as T;

        } catch (error) {
            Logger.error('[LLM] completeStructured() failed', { error: error as Error });
            return null;
        }
    }

    /**
     * 👁️ VISION COMPLETION — Analyze images with LLM.
     * Sends a base64-encoded image alongside a text prompt.
     * Uses the configured smart model (GLM-5 supports vision natively).
     *
     * @param prompt       - System/analysis prompt
     * @param imageBase64  - Base64-encoded image data
     * @param model        - Vision-capable model (defaults to config.llm.model)
     * @returns Raw string response from the model
     */
    public static async completeVision(
        prompt: string,
        imageBase64: string,
        model: string = config.llm.model
    ): Promise<string | null> {
        const client = this.getClient();

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: prompt },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
                            }
                        ] as any
                    }
                ],
                max_tokens: 300,
                temperature: config.llm.temperature,
            });

            const content = response.choices[0]?.message?.content;
            this.trackUsage(response.usage, model);

            return content || null;

        } catch (error) {
            Logger.error('[LLM] completeVision() failed', { error: error as Error });
            return null;
        }
    }

    /**
     * @deprecated Use completeStructured<T>() instead.
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

    // ─────────────────────────────────────────────
    // COST TRACKING (Law 006)
    // ─────────────────────────────────────────────

    /**
     * 💰 Track API cost using per-model pricing from config.
     * Falls back to glm-4-flash pricing if model not found in pricing table.
     */
    private static trackUsage(usage: OpenAI.Completions.CompletionUsage | undefined, model: string): void {
        if (!usage) return;

        const FALLBACK_MODEL_KEY = 'glm-4-flash';
        const pricing = config.llm.pricing[model] ?? config.llm.pricing[FALLBACK_MODEL_KEY];

        if (!pricing) {
            Logger.warn(`[LLM] No pricing entry for model "${model}", skipping cost tracking`);
            return;
        }

        const cost =
            (usage.prompt_tokens / 1_000_000) * pricing.inputPer1M +
            (usage.completion_tokens / 1_000_000) * pricing.outputPer1M;

        this.totalCost += cost;
        Logger.info(`[LLM] 💰 $${cost.toFixed(6)} (Total: $${this.totalCost.toFixed(6)}) [${model}]`);
    }

    // ─────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────

    /** Rough char-based token approximation (~4 chars/token). */
    public static truncate(content: string, maxTokens: number = 2000): string {
        return content.slice(0, maxTokens * 4);
    }

    public static getTotalCost(): number {
        return this.totalCost;
    }

    /** Reset session cost counter (useful for per-batch tracking). */
    public static resetCost(): void {
        this.totalCost = 0;
    }
}
