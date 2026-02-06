
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

interface LLMResponse {
    content: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class LLMService {
    private static totalCost = 0;
    private static openai: OpenAI | null = null;

    private static getClient(): OpenAI | null {
        if (!LLMService.openai && process.env.OPENAI_API_KEY) {
            LLMService.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        }
        return LLMService.openai;
    }

    public static async complete(prompt: string, model: string = config.llm.model): Promise<string> {
        const client = LLMService.getClient();

        // If no API key, return mock response
        if (!client) {
            Logger.warn('[LLM] No OPENAI_API_KEY configured - returning mock response');
            this.trackCost(100, 50, model);
            return "{ \"status\": \"mock_response\" }";
        }

        try {
            const response = await client.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 1000,
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

    public static async completeJSON<T>(prompt: string): Promise<T | null> {
        const response = await this.complete(prompt + "\nRespond strictly in JSON.");
        try {
            // Task 3: JSON Enforcement
            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr) as T;
        } catch (e) {
            Logger.error('[LLM] JSON Parse Error', { error: e as Error });
            return null;
        }
    }

    // Task 1: Cost Control
    private static trackCost(inputTokens: number, outputTokens: number, model: string) {
        const pricePer1kInput = model.includes('gpt-4') ? 0.03 : 0.0015;
        const pricePer1kOutput = model.includes('gpt-4') ? 0.06 : 0.002;
        const cost = (inputTokens / 1000 * pricePer1kInput) + (outputTokens / 1000 * pricePer1kOutput);
        this.totalCost += cost;
        Logger.info(`[LLM] Cost: $${cost.toFixed(4)} (Session Total: $${this.totalCost.toFixed(4)})`);
    }

    // Task 4: Content Truncation
    public static truncate(content: string, maxTokens: number = 2000): string {
        return content.slice(0, maxTokens * 4); // Approximation
    }

    public static getTotalCost(): number {
        return this.totalCost;
    }
}
