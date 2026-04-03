import { OpenAI } from 'openai';
import { ProviderRegistryEntry, parseJsonPayload } from './provider_registry_helpers';
import { config } from '../../../shared-runtime/config/runtime_config';

interface LlmJsonResolverSpec {
    providerId: string;
    costPerRequest: number;
    tier: number;
    apiKeyEnv: string;
    model: string;
    baseURL?: string;
    systemPrompt: string;
    buildUserPrompt(query: string): string;
    validateApiKey?(apiKey: string): void;
}

function buildJsonResolverEntry(spec: LlmJsonResolverSpec): ProviderRegistryEntry {
    return [spec.providerId, {
        family: 'LLM',
        costPerRequest: spec.costPerRequest,
        tier: spec.tier,
        execute: async <T>(payload: any): Promise<T> => {
            const apiKey = process.env[spec.apiKeyEnv] || '';
            spec.validateApiKey?.(apiKey);

            const openai = new OpenAI({
                apiKey,
                ...(spec.baseURL ? { baseURL: spec.baseURL } : {}),
            });

            if (typeof payload === 'string' || !!payload.query) {
                const query = typeof payload === 'string' ? payload : payload.query;
                const completion = await openai.chat.completions.create({
                    model: spec.model,
                    messages: [
                        { role: 'system', content: spec.systemPrompt },
                        { role: 'user', content: spec.buildUserPrompt(query) },
                    ],
                    temperature: 0.1,
                });
                const content = completion.choices[0].message.content || '[]';
                try {
                    return parseJsonPayload<T>(content);
                } catch {
                    return [] as unknown as T;
                }
            }

            return (await openai.chat.completions.create({
                ...payload,
                model: spec.model,
            })) as unknown as T;
        },
    }];
}

export function buildLlmProviderEntries(): ProviderRegistryEntry[] {
    return [
        buildJsonResolverEntry({
            providerId: 'OPENROUTER-FAST-2',
            costPerRequest: 0.001,
            tier: 2,
            apiKeyEnv: 'OPENROUTER_API_KEY',
            model: process.env.OPENROUTER_MODEL_FAST || 'openai/gpt-5-nano',
            baseURL: 'https://openrouter.ai/api/v1',
            systemPrompt: 'You are an Italian business domain expert. Return ONLY a raw JSON array.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.`,
        }),
        buildJsonResolverEntry({
            providerId: 'OPENROUTER-SMART-3',
            costPerRequest: 0.003,
            tier: 3,
            apiKeyEnv: 'OPENROUTER_API_KEY',
            model: process.env.OPENROUTER_MODEL_SMART || 'google/gemini-2.5-flash-lite',
            baseURL: 'https://openrouter.ai/api/v1',
            systemPrompt: 'You search the web and reason over Italian company identity. Return ONLY a raw JSON array.',
            buildUserPrompt: (query) => `Find the official website for Italian company: "${query}". Return the top 3 results in this exact JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON array only.`,
        }),
        buildJsonResolverEntry({
            providerId: 'OPENAI-1',
            costPerRequest: 0.005,
            tier: 3,
            apiKeyEnv: 'OPENAI_API_KEY',
            model: 'gpt-4o-mini',
            systemPrompt: 'You are an Italian business domain expert. Return a JSON array.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.`,
            validateApiKey: (apiKey) => {
                if (!apiKey || apiKey.includes('your-')) {
                    throw new Error('OPENAI_API_KEY missing');
                }
            },
        }),
        buildJsonResolverEntry({
            providerId: 'OPENROUTER-2',
            costPerRequest: 0.001,
            tier: 4,
            apiKeyEnv: 'OPENROUTER_API_KEY',
            model: config.llm.openrouter.fastModel,
            baseURL: config.llm.openrouter.baseUrl,
            systemPrompt: 'You are an Italian business domain expert. Return a JSON array of likely official websites only.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn the top 3 most likely official website URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.`,
            validateApiKey: (apiKey) => {
                if (!apiKey || apiKey.includes('your-')) {
                    throw new Error('OPENROUTER_API_KEY missing');
                }
            },
        }),
        buildJsonResolverEntry({
            providerId: 'PERPLEXITY-1',
            costPerRequest: 0.010,
            tier: 8,
            apiKeyEnv: 'PERPLEXITY_API_KEY',
            model: 'sonar-pro',
            baseURL: 'https://api.perplexity.ai',
            systemPrompt: 'You search the web and return official company websites. Return ONLY a raw JSON array. No markdown fences, no reasoning, no explanation.',
            buildUserPrompt: (query) => `Find the official website for Italian company: "${query}". Return the top 3 results in this exact JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON array only.`,
        }),
        buildJsonResolverEntry({
            providerId: 'DEEPSEEK-1',
            costPerRequest: 0.002,
            tier: 5,
            apiKeyEnv: 'DEEPSEEK_API_KEY',
            model: 'deepseek-chat',
            baseURL: 'https://api.deepseek.com',
            systemPrompt: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions (.it, .com, .eu domains). Only return URLs you are confident about. Output ONLY raw JSON, no markdown.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn the most likely official website URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.`,
        }),
        buildJsonResolverEntry({
            providerId: 'KIMI-1',
            costPerRequest: 0.002,
            tier: 6,
            apiKeyEnv: 'KIMI_API_KEY',
            model: 'moonshot-v1-8k',
            baseURL: 'https://api.moonshot.cn/v1',
            systemPrompt: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.`,
        }),
        buildJsonResolverEntry({
            providerId: 'ZAI-1',
            costPerRequest: 0.002,
            tier: 7,
            apiKeyEnv: 'Z_AI_API_KEY',
            model: 'glm-4-flash',
            baseURL: 'https://open.bigmodel.cn/api/paas/v4',
            systemPrompt: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.',
            buildUserPrompt: (query) => `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.`,
        }),
    ];
}
