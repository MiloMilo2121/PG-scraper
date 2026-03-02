
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';
import pLimit from 'p-limit';

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
    private static clients: Map<string, OpenAI> = new Map(); // key is apiKey

    // Hydra Router State
    private static keyCooldowns: Map<string, number> = new Map(); // apiKey -> unlockTimestamp (Jail)
    private static keyIndices: Map<string, number> = new Map(); // providerKey -> currentIndex
    private static llmLimit = pLimit(20); // Max 20 concurrent LLM requests globally

    // ─────────────────────────────────────────────
    // CLIENT MANAGEMENT
    // ─────────────────────────────────────────────

    /**
     * Factory: Get the correct OpenAI-compatible client for the requested model.
     * Round-Robins through healthy API keys for the chosen provider.
     */
    private static getClientForModel(model: string): { client: OpenAI, apiKey: string, providerKey: string } {
        let providerKey = 'openai';

        if (model.startsWith('glm-')) providerKey = 'z_ai';
        else if (model.startsWith('deepseek-')) providerKey = 'deepseek';
        else if (model.startsWith('moonshot-') || model.startsWith('kimi-')) providerKey = 'kimi';
        else providerKey = 'openai';

        let keys: string[] = [];
        let baseUrl: string | undefined;

        switch (providerKey) {
            case 'z_ai':
                keys = config.llm.z_ai.apiKeys;
                baseUrl = config.llm.z_ai.baseUrl;
                break;
            case 'deepseek':
                keys = config.llm.deepseek.apiKeys;
                baseUrl = config.llm.deepseek.baseUrl;
                break;
            case 'kimi':
                keys = config.llm.kimi.apiKeys;
                baseUrl = config.llm.kimi.baseUrl;
                break;
            case 'openai':
            default:
                keys = config.llm.apiKeys;
                break;
        }

        if (!keys || keys.length === 0) {
            throw new Error(`⛔ No API Keys configured for provider ${providerKey} (model: ${model})`);
        }

        // Find a healthy key (Round-Robin)
        const startIndex = this.keyIndices.get(providerKey) || 0;
        let selectedKey: string | null = null;
        let attempts = 0;

        while (attempts < keys.length) {
            const index = (startIndex + attempts) % keys.length;
            const candidateKey = keys[index];
            const unlockTime = this.keyCooldowns.get(candidateKey) || 0;

            if (Date.now() > unlockTime) {
                selectedKey = candidateKey;
                this.keyIndices.set(providerKey, (index + 1) % keys.length);
                break;
            }
            attempts++;
        }

        // If all keys are in jail, just use the first one (or wait/throw, but throwing is aggressive)
        if (!selectedKey) {
            Logger.warn(`⚠️ [Hydra Router] All keys for ${providerKey} are in Cooldown Jail! Forcing use of key 0.`);
            selectedKey = keys[0];
        }

        // Initialize client if not cached
        if (!this.clients.has(selectedKey)) {
            Logger.info(`🧠 [LLMService] Initializing ${providerKey} Client with key prefix: ${selectedKey.substring(0, 6)}...`);
            const client = new OpenAI({
                apiKey: selectedKey,
                baseURL: baseUrl,
                timeout: 15000,   // 15 seconds max (Law 104 corollary)
                maxRetries: 0     // We handle retries and rotations externally in Hydra
            });
            this.clients.set(selectedKey, client);
        }

        return { client: this.clients.get(selectedKey)!, apiKey: selectedKey, providerKey };
    }

    /**
     * @deprecated Use specific methods which handle client selection automatically.
     * Returns the default client (usually Z.ai or OpenAI fallback).
     */
    public static getClient(): OpenAI {
        // Fallback for legacy calls that don't specify model
        // Prefer cheapest: Z.ai flash (FREE) -> DeepSeek -> Kimi -> OpenAI
        if (config.llm.z_ai.apiKeys.length) return this.getClientForModel('glm-4.7-flash').client;
        if (config.llm.deepseek.apiKeys.length) return this.getClientForModel('deepseek-chat').client;
        if (config.llm.kimi.apiKeys.length) return this.getClientForModel('kimi-k2.5').client;
        return this.getClientForModel('gpt-4o').client;
    }

    // ─────────────────────────────────────────────
    // RESILIENCE: 429/5xx Detection & Backoff
    // ─────────────────────────────────────────────

    /**
     * Checks if an error is a retryable rate-limit or server error (429, 5xx, timeout).
     */
    private static isRetryableError(error: unknown): boolean {
        const msg = `${(error as any)?.message || ''} ${(error as any)?.status || ''} ${(error as any)?.code || ''} ${(error as any)?.type || ''}`.toLowerCase();

        // Rate limits
        if (msg.includes('429') || msg.includes('rate') || msg.includes('速率限制') || msg.includes('too many') || msg.includes('insufficient_quota')) return true;

        // Server errors
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('overloaded') || msg.includes('server_error')) return true;

        // Timeout & Connection Drops
        if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnreset') || msg.includes('socket hang up') || msg.includes('terminated') || msg.includes('econnaborted')) return true;

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
    // TEMPERATURE PER MODEL
    // ─────────────────────────────────────────────

    /**
     * Returns optimal temperature for a model. Thinking/reasoning models need higher temp.
     * - Kimi K2/K2.5 Thinking: 1.0 (official recommendation)
     * - Kimi K2 Instruct: 0.6 (official recommendation)
     * - DeepSeek Reasoner: 0.6
     * - Everything else: config default (0.1)
     */
    private static getTemperature(model: string): number {
        if (model.includes('thinking') || model.includes('reasoner')) return 1.0;
        if (model.startsWith('kimi-k2')) return 0.6;
        return config.llm.temperature;
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
                let currentApiKey = '';
                try {
                    const { client, apiKey } = this.getClientForModel(currentModel);
                    currentApiKey = apiKey;

                    const response = await this.llmLimit(() => client.chat.completions.create({
                        model: currentModel,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: this.getTemperature(currentModel),
                        max_tokens: config.llm.maxTokens,
                    }));

                    const content = response.choices[0]?.message?.content || '';
                    this.trackUsage(response.usage, currentModel);
                    return content;
                } catch (error) {
                    const retryable = this.isRetryableError(error);
                    Logger.warn(`[LLM] complete() failed with ${currentModel} (attempt ${attempt + 1}, retryable: ${retryable})`, { error: error as Error });

                    if (retryable) {
                        // Put key in Cooldown Jail for 60 seconds
                        Logger.warn(`🚨 [Hydra Router] 429 detected! Jailing key ${currentApiKey.substring(0, 6)}... for 60s.`);
                        this.keyCooldowns.set(currentApiKey, Date.now() + 60000);
                    }

                    if (retryable && attempt === 0) {
                        // Retry same model once with backoff
                        await this.backoff(attempt);
                        continue;
                    }

                    if (!isLastModel) {
                        // Move to next fallback model regardless of whether it's retryable or we exhausted attempts
                        Logger.info(`[LLM] 🔄 Falling back from ${currentModel} to ${modelsToTry[mi + 1]}`);
                        break;
                    }

                    // Non-retryable error on the LAST model, or we exhausted retries on the LAST model — throw
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
            const needsSimpleJsonMode = currentModel.includes('deepseek') || currentModel.includes('moonshot') || currentModel.includes('kimi-');
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
                let currentApiKey = '';
                try {
                    const { client, apiKey } = this.getClientForModel(currentModel);
                    currentApiKey = apiKey;

                    const response = await this.llmLimit(() => client.chat.completions.create({
                        model: currentModel,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: this.getTemperature(currentModel),
                        max_tokens: config.llm.maxTokens,
                        response_format: responseFormat as any,
                    }));

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

                    if (retryable) {
                        // Put key in Cooldown Jail for 60 seconds
                        Logger.warn(`🚨 [Hydra Router] 429 detected! Jailing key ${currentApiKey.substring(0, 6)}... for 60s.`);
                        this.keyCooldowns.set(currentApiKey, Date.now() + 60000);
                    }

                    if (retryable && attempt === 0) {
                        await this.backoff(attempt);
                        continue;
                    }

                    if (!isLastModel) {
                        Logger.info(`[LLM] 🔄 Structured: falling back from ${currentModel} to ${modelsToTry[mi + 1]}`);
                        break;
                    }

                    // Non-retryable or exhaust on the LAST model: try legacy JSON prompt as final attempt
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
        if (model.includes('deepseek') || model.includes('moonshot') || model.includes('kimi-')) {
            Logger.warn(`[LLM] Vision request sent to non-vision model (${model}). Fallback to GLM-4v/GPT-4o.`);
            // Fallback logic could be added here, or just let it fail/warn.
        }

        let currentApiKey = '';
        try {
            const { client, apiKey } = this.getClientForModel(model);
            currentApiKey = apiKey;

            const response = await this.llmLimit(() => client.chat.completions.create({
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
                temperature: this.getTemperature(model),
            }));

            const content = response.choices[0]?.message?.content;
            this.trackUsage(response.usage, model);
            return content || null;

        } catch (error) {
            const retryable = this.isRetryableError(error);
            Logger.error('[LLM] completeVision() failed', { error: error as Error });

            if (retryable) {
                Logger.warn(`🚨 [Hydra Router] 429 detected on Vision Model! Jailing key ${currentApiKey.substring(0, 6)}... for 60s.`);
                this.keyCooldowns.set(currentApiKey, Date.now() + 60000);
            }
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
