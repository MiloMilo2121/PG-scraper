import { OpenAI } from 'openai';
import { ProviderAdapter } from '../../shared-runtime/routing/provider_adapter';

// Guardrail accounting uses vendor list prices converted with a fixed EUR estimate.
// These numbers should track routing relative cost, not invoice-level precision.
const USD_TO_EUR_ESTIMATE = 0.86;

function usdToEur(usd: number): number {
    return Number((usd * USD_TO_EUR_ESTIMATE).toFixed(6));
}

function readLocalOracleFetchCostEur(): number {
    const raw = process.env.LOCAL_ORACLE_FETCH_COST_EUR?.trim();
    if (!raw) {
        return 0;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

type SearchProviderCtor = new () => { search(query: string): Promise<unknown> };

async function runSearchProvider<T>(loader: () => Promise<Record<string, SearchProviderCtor>>, exportName: string, query: string): Promise<T> {
    const module = await loader();
    const ProviderClass = module[exportName];
    if (!ProviderClass) {
        throw new Error(`Missing provider export: ${exportName}`);
    }

    const provider = new ProviderClass();
    return (await provider.search(query)) as T;
}

async function runScraperFetch<T>(mode: 'direct' | 'brightdata', url: string, options: any): Promise<T> {
    const { ScraperClient } = await import('../utils/scraper_client');
    const result = await ScraperClient.fetchHtml(url, { mode, ...options });
    if (mode === 'direct' && (result.status === 403 || result.status === 429)) {
        throw new Error('BLOCK');
    }
    return result as unknown as T;
}

async function runOracleFetch<T>(url: string): Promise<T> {
    const { OracleClient } = await import('../utils/oracle_client');
    const result = await OracleClient.fetchHtmlStealth(url);
    return { data: result.html, status: 200 } as unknown as T;
}

function parseJsonPayload<T>(raw: string): T {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T;
}

const BRIGHTDATA_WEB_UNLOCKER_COST_EUR = usdToEur(1.5 / 1000);

export function buildProviderMap(): Map<string, ProviderAdapter> {
    return new Map([
        ['DNS-MX-MINING-0', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/mx_discovery_provider'), 'MxDiscoveryProvider', query);
            }
        }],
        ['CRTSH-API-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'CrtShProvider', query);
            }
        }],
        ['SERPER-API-1', {
            family: 'SERP',
            costPerRequest: 0.001,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'SerperSearchProvider', query);
            }
        }],
        ['BRAVE-API-1', {
            family: 'SERP',
            costPerRequest: 0.001,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'BraveApiSearchProvider', query);
            }
        }],
        ['TAVILY-API-2', {
            family: 'SERP',
            costPerRequest: 0.001,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'TavilySearchProvider', query);
            }
        }],
        ['HTTP-DIRECT-1', {
            family: 'PROXY_FETCH',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                return runScraperFetch<T>('direct', url, options);
            }
        }],

        ['HTTP-BRIGHTDATA-4', {
            family: 'PROXY_FETCH',
            costPerRequest: BRIGHTDATA_WEB_UNLOCKER_COST_EUR,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                return runScraperFetch<T>('brightdata', url, options);
            }
        }],
        ['ORACLE-CRAWL4AI-5', {
            family: 'PROXY_FETCH',
            costPerRequest: readLocalOracleFetchCostEur(),
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                return runOracleFetch<T>(url);
            }
        }],

        ['BRAVE-HTML-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'BraveSearchProvider', query);
            }
        }],
        ['BING-HTML-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'BingSearchProvider', query);
            }
        }],
        ['DDG-LITE-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'DDGSearchProvider', query);
            }
        }],
        ['SEARXNG-NET-1', {
            family: 'SERP',
            costPerRequest: 0,
            tier: 9,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/search_provider'), 'SearXNGProvider', query);
            }
        }],

        ['PERPLEXITY-API-4', {
            family: 'SERP',
            costPerRequest: 0.010,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                return runSearchProvider<T>(() => import('../core/discovery/perplexity_provider'), 'PerplexityProvider', query);
            }
        }],
        ['OPENAI-1', {
            family: 'LLM',
            costPerRequest: 0.005,
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.OPENAI_API_KEY || '';
                if (!apiKey || apiKey.includes('your-')) throw new Error('OPENAI_API_KEY missing');
                const openai = new OpenAI({ apiKey });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const completion = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Return a JSON array.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = completion.choices[0].message.content || '[]';
                    try {
                        return parseJsonPayload<T>(content);
                    } catch {
                        return [] as unknown as T;
                    }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'gpt-4o-mini' })) as unknown as T;
            }
        }],
        ['PERPLEXITY-1', {
            family: 'LLM',
            costPerRequest: 0.010,
            tier: 8,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.PERPLEXITY_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const completion = await openai.chat.completions.create({
                        model: 'sonar-pro',
                        messages: [
                            { role: 'system', content: 'You search the web and return official company websites. Return ONLY a raw JSON array. No markdown fences, no reasoning, no explanation.' },
                            { role: 'user', content: `Find the official website for Italian company: "${query}". Return the top 3 results in this exact JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON array only.` }
                        ]
                    });
                    const content = completion.choices[0].message.content || '[]';
                    try {
                        return parseJsonPayload<T>(content);
                    } catch {
                        return [] as unknown as T;
                    }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'sonar-pro' })) as unknown as T;
            }
        }],
        ['DEEPSEEK-1', {
            family: 'LLM',
            costPerRequest: 0.002,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.DEEPSEEK_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const completion = await openai.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions (.it, .com, .eu domains). Only return URLs you are confident about. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = completion.choices[0].message.content || '[]';
                    try {
                        return parseJsonPayload<T>(content);
                    } catch {
                        return [] as unknown as T;
                    }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'deepseek-chat' })) as unknown as T;
            }
        }],
        ['KIMI-1', {
            family: 'LLM',
            costPerRequest: 0.002,
            tier: 6,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.KIMI_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.moonshot.cn/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const completion = await openai.chat.completions.create({
                        model: 'moonshot-v1-8k',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = completion.choices[0].message.content || '[]';
                    try {
                        return parseJsonPayload<T>(content);
                    } catch {
                        return [] as unknown as T;
                    }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'moonshot-v1-8k' })) as unknown as T;
            }
        }],
        ['ZAI-1', {
            family: 'LLM',
            costPerRequest: 0.002,
            tier: 7,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.Z_AI_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://open.bigmodel.cn/api/paas/v4' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const completion = await openai.chat.completions.create({
                        model: 'glm-4-flash',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = completion.choices[0].message.content || '[]';
                    try {
                        return parseJsonPayload<T>(content);
                    } catch {
                        return [] as unknown as T;
                    }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'glm-4-flash' })) as unknown as T;
            }
        }]
    ]);
}
