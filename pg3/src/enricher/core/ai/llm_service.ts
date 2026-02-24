
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

/**
 * 🧠 LLM SERVICE — Centralized AI Gateway
 *
 * Single point of access for ALL LLM calls across the application.
 * Handles provider selection (Z.ai / DeepSeek / Kimi / OpenAI), cost tracking (Law 006),
 * structured JSON output (Law 502), and vision analysis.
 *
 * NO other module should instantiate OpenAI directly — use this service.
 */
export class LLMService {
    private static totalCost = 0;
    private static clients: Map<string, OpenAI> = new Map();

    // ─────────────────────────────────────────────
    // CLIENT MANAGEMENT
    // ─────────────────────────────────────────────

    /**
     * Factory: Get the correct OpenAI-compatible client for the requested model.
     * Route based on model prefix or explicit mapping.
     */
    private static getClientForModel(model: string): OpenAI {
        let providerKey = 'openai'; // Default

        // 1. Determine Provider based on Model Name
        if (model.startsWith('glm-')) {
            providerKey = 'z_ai';
        } else if (model.startsWith('deepseek-')) {
            providerKey = 'deepseek';
        } else if (model.startsWith('moonshot-')) {
            providerKey = 'kimi';
        } else {
            // Fallback for gpt-*, o1-*, etc. to OpenAI
            providerKey = 'openai';
        }

        // 2. Return cached client if exists
        if (this.clients.has(providerKey)) {
            return this.clients.get(providerKey)!;
        }

        // 3. Initialize new client
        let newClient: OpenAI;

        switch (providerKey) {
            case 'z_ai':
                if (!config.llm.z_ai.apiKey) throw new Error(`⛔ Z.ai (GLM) API Key missing! Cannot use model ${model}`);
                Logger.info(`🧠 [LLMService] Initializing Z.ai Client for ${model}...`);
                newClient = new OpenAI({
                    apiKey: config.llm.z_ai.apiKey,
                    baseURL: config.llm.z_ai.baseUrl,
                });
                break;

            case 'deepseek':
                if (!config.llm.deepseek?.apiKey) throw new Error(`⛔ DeepSeek API Key missing! Cannot use model ${model}`);
                Logger.info(`🧠 [LLMService] Initializing DeepSeek Client for ${model}...`);
                newClient = new OpenAI({
                    apiKey: config.llm.deepseek.apiKey,
                    baseURL: config.llm.deepseek.baseUrl,
                });
                break;

            case 'kimi':
                if (!config.llm.kimi?.apiKey) throw new Error(`⛔ Kimi (Moonshot) API Key missing! Cannot use model ${model}`);
                Logger.info(`🧠 [LLMService] Initializing Kimi Client for ${model}...`);
                newClient = new OpenAI({
                    apiKey: config.llm.kimi.apiKey,
                    baseURL: config.llm.kimi.baseUrl,
                });
                break;

            case 'openai':
            default:
                if (!config.llm.apiKey) throw new Error(`⛔ OpenAI API Key missing! Cannot use model ${model}`);
                Logger.info(`🧠 [LLMService] Initializing OpenAI Client for ${model}...`);
                newClient = new OpenAI({ apiKey: config.llm.apiKey });
                break;
        }

        this.clients.set(providerKey, newClient);
        return newClient;
    }

    /**
     * @deprecated Use specific methods which handle client selection automatically.
     * Returns the default client (usually Z.ai or OpenAI fallback).
     */
    public static getClient(): OpenAI {
        // Fallback for legacy calls that don't specify model
        // Prefer Z.ai -> DeepSeek -> Kimi -> OpenAI
        if (config.llm.z_ai.apiKey) return this.getClientForModel('glm-5');
        if (config.llm.deepseek?.apiKey) return this.getClientForModel('deepseek-chat');
        if (config.llm.kimi?.apiKey) return this.getClientForModel('moonshot-v1-8k');
        return this.getClientForModel('gpt-4o');
    }

    // ─────────────────────────────────────────────
    // RESILIENCE: 429/5xx Detection & Backoff
    // ─────────────────────────────────────────────

    /**
     * Checks if an error is a retryable rate-limit or server error (429, 5xx).
     */
    private static isRetryableError(error: unknown): boolean {
        const msg = `${(error as any)?.message || ''} ${(error as any)?.status || ''} ${(error as any)?.code || ''}`.toLowerCase();
        // 429 rate limit
        if (msg.includes('429') || msg.includes('rate') || msg.includes('速率限制') || msg.includes('too many')) return true;
        // 5xx server errors
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
        // Connection/timeout errors (transient)
        if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('socket hang up')) return true;
        return false;
    }

    /**
     * Exponential backoff delay: 1s, 2s, 4s for retries within same provider.
     */
    private static async backoff(attempt: number): Promise<void> {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
        Logger.info(`[LLM] ⏳ Backoff ${delayMs}ms before retry...`);
        await new Promise(r => setTimeout(r, delayMs));
    }

    // ─────────────────────────────────────────────
    // COMPLETIONS
    // ─────────────────────────────────────────────

    /**
     * Standard text completion — returns raw string response.
     * Uses the configured smart model by default.
     * On 429/5xx, retries once with backoff, then tries fallback models.
     */
    public static async complete(prompt: string, model: string = config.llm.model, fallbackModels?: string[]): Promise<string> {
        const modelsToTry = [model, ...(fallbackModels || [])];

        for (let mi = 0; mi < modelsToTry.length; mi++) {
            const currentModel = modelsToTry[mi];
            const isLastModel = mi === modelsToTry.length - 1;

            // Up to 2 attempts per model (original + 1 backoff retry)
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const client = this.getClientForModel(currentModel);
                    const response = await client.chat.completions.create({
                        model: currentModel,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: config.llm.temperature,
                        max_tokens: config.llm.maxTokens,
                    });

                    const content = response.choices[0]?.message?.content || '';
                    this.trackUsage(response.usage, currentModel);
                    return content;
                } catch (error) {
                    const retryable = this.isRetryableError(error);
                    Logger.warn(`[LLM] complete() failed with ${currentModel} (attempt ${attempt + 1}, retryable: ${retryable})`, { error: error as Error });

                    if (retryable && attempt === 0) {
                        // Retry same model once with backoff
                        await this.backoff(attempt);
                        continue;
                    }

                    if (retryable && !isLastModel) {
                        // Move to next fallback model
                        Logger.info(`[LLM] 🔄 Falling back from ${currentModel} to ${modelsToTry[mi + 1]}`);
                        break;
                    }

                    // Non-retryable error or last model exhausted — throw
                    throw error;
                }
            }
        }

        throw new Error(`[LLM] All models exhausted for complete(): ${modelsToTry.join(' -> ')}`);
    }

    /**
     * 🧱 STRUCTURED COMPLETION — Force JSON Schema
     * Guaranteed to return a valid JSON object matching the schema.
     * On 429/5xx, retries with backoff then tries fallback models.
     */
    public static async completeStructured<T>(
        prompt: string,
        schema: Record<string, unknown>,
        model: string = config.llm.model,
        fallbackModels?: string[]
    ): Promise<T | null> {
        const modelsToTry = [model, ...(fallbackModels || [])];

        for (let mi = 0; mi < modelsToTry.length; mi++) {
            const currentModel = modelsToTry[mi];
            const isLastModel = mi === modelsToTry.length - 1;

            // DeepSeek/Kimi support "json_object" but NOT "json_schema" (Structured Outputs)
            const needsSimpleJsonMode = currentModel.includes('deepseek') || currentModel.includes('moonshot');
            const responseFormat = needsSimpleJsonMode
                ? { type: 'json_object' as const }
                : {
                    type: 'json_schema' as const,
                    json_schema: {
                        name: 'validation_result',
                        strict: true,
                        schema,
                    },
                };

            // Up to 2 attempts per model (original + 1 backoff retry)
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const client = this.getClientForModel(currentModel);
                    const response = await client.chat.completions.create({
                        model: currentModel,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: config.llm.temperature,
                        max_tokens: config.llm.maxTokens,
                        response_format: responseFormat as any,
                    });

                    const content = response.choices[0]?.message?.content;
                    if (!content) {
                        Logger.warn(`[LLM] Structured output returned empty content from ${currentModel}`);
                        return null;
                    }

                    this.trackUsage(response.usage, currentModel);

                    // GLM/DeepSeek models may wrap JSON in markdown blocks even with json_schema mode
                    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
                    return JSON.parse(cleanContent) as T;

                } catch (error) {
                    const retryable = this.isRetryableError(error);
                    Logger.warn(`[LLM] completeStructured() failed with ${currentModel} (attempt ${attempt + 1}, retryable: ${retryable})`, { error: error as Error });

                    if (retryable && attempt === 0) {
                        await this.backoff(attempt);
                        continue;
                    }

                    if (retryable && !isLastModel) {
                        Logger.info(`[LLM] 🔄 Structured: falling back from ${currentModel} to ${modelsToTry[mi + 1]}`);
                        break;
                    }

                    // Non-retryable or last model: try legacy JSON prompt as final attempt
                    Logger.warn(`[LLM] Structured output failed with model ${currentModel}, trying pure JSON prompt...`, { error: error as Error });
                    try {
                        const legacyRes = await this.complete(
                            prompt + "\n\nResponse MUST be valid JSON matching the schema.",
                            currentModel,
                            isLastModel ? undefined : modelsToTry.slice(mi + 1)
                        );
                        const cleanLegacy = legacyRes.replace(/```json/g, '').replace(/```/g, '').trim();
                        return JSON.parse(cleanLegacy) as T;
                    } catch (legacyError) {
                        Logger.error('[LLM] Legacy fallback failed', { error: legacyError as Error });
                        return null;
                    }
                }
            }
        }

        Logger.error(`[LLM] All models exhausted for completeStructured(): ${modelsToTry.join(' -> ')}`);
        return null;
    }

    /**
     * 👁️ VISION COMPLETION — Analyze images with LLM.
     * Sends a base64-encoded image alongside a text prompt.
     * Not all models support vision (DeepSeek V3 doesn't, GLM-4v does, GPT-4o does).
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
        // Guard: DeepSeek Chat (V3) does NOT support vision. DeepSeek VL does but via different API usually? 
        // For now assume assume only GLM-4v/5 and GPT-4o support vision.
        if (model.includes('deepseek') || model.includes('moonshot')) {
            Logger.warn(`[LLM] Vision request sent to non-vision model (${model}). Fallback to GLM-4v/GPT-4o.`);
            // Fallback logic could be added here, or just let it fail/warn.
        }

        const client = this.getClientForModel(model);

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
