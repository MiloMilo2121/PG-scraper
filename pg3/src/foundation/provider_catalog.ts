import { OpenAI } from 'openai';
import {
    BingSearchProvider,
    BraveSearchProvider,
    CrtShProvider,
    DDGSearchProvider,
    JinaSearchProvider,
    SearXNGProvider,
    SerperSearchProvider,
} from '../enricher/core/discovery/search_provider';
import { MxDiscoveryProvider } from '../enricher/core/discovery/mx_discovery_provider';
import { PerplexityProvider } from '../enricher/core/discovery/perplexity_provider';
import { config } from '../enricher/config';
import { ProviderAdapter } from './provider_adapter';

// Guardrail accounting uses vendor list prices converted with a fixed EUR estimate.
// These numbers should track routing relative cost, not invoice-level precision.
const USD_TO_EUR_ESTIMATE = 0.86;

function usdToEur(usd: number): number {
    return Number((usd * USD_TO_EUR_ESTIMATE).toFixed(6));
}

function parseJsonPayload<T>(raw: string): T {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T;
}

const SCRAPE_DO_CREDIT_COST_EUR = usdToEur(249 / 3_500_000);
const SCRAPE_DO_HTML_COST_EUR = SCRAPE_DO_CREDIT_COST_EUR;
const SCRAPE_DO_RENDER_SUPER_COST_EUR = Number((SCRAPE_DO_CREDIT_COST_EUR * 25).toFixed(6));
const BRIGHTDATA_WEB_UNLOCKER_COST_EUR = usdToEur(1.5 / 1000);
const SERPER_SEARCH_COST_EUR = usdToEur(1 / 1000);

export const SERP_PROVIDER_ORDER = [
    'SERPER-1',
    'DNS-MX-MINING-0',
    'CRTSH-API-1',
    'JINA-1',
    'DDG-LITE-1',
    'BRAVE-HTML-1',
    'BING-HTML-1',
    'SEARXNG-NET-1',
    'PERPLEXITY-API-4',
] as const;

export const HTTP_PROVIDER_ORDER = [
    // Ordered by escalation strategy, not pure vendor unit price:
    // preserve cheap raw fetch first, then rendered rescue, then premium unlocker.
    'HTTP-DIRECT-1',
    'HTTP-SCRAPEDO-2',
    'HTTP-SCRAPEDO-3',
    'HTTP-BRIGHTDATA-4',
    'ORACLE-CRAWL4AI-5',
] as const;

export function buildProviderMap(): Map<string, ProviderAdapter> {
    return new Map([
        ['DNS-MX-MINING-0', {
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new MxDiscoveryProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['CRTSH-API-1', {
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new CrtShProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['HTTP-DIRECT-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'direct', ...options });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        }],
        ['HTTP-SCRAPEDO-2', {
            costPerRequest: SCRAPE_DO_HTML_COST_EUR,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, {
                    mode: 'scrape_do',
                    render: false,
                    super: false,
                    ...options
                });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        }],
        ['HTTP-SCRAPEDO-3', {
            costPerRequest: SCRAPE_DO_RENDER_SUPER_COST_EUR,
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, {
                    mode: 'scrape_do',
                    render: true,
                    super: true,
                    ...options
                });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        }],
        ['HTTP-BRIGHTDATA-4', {
            costPerRequest: BRIGHTDATA_WEB_UNLOCKER_COST_EUR,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const options = typeof payload === 'string' ? {} : (payload.options || {});
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'brightdata', ...options });
                return result as unknown as T;
            }
        }],
        ['ORACLE-CRAWL4AI-5', {
            costPerRequest: config.costing.localOracleFetchCostEur,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { OracleClient } = require('../enricher/utils/oracle_client');
                const result = await OracleClient.fetchHtmlStealth(url);
                return { data: result.html, status: 200 } as unknown as T;
            }
        }],
        ['SERPER-1', {
            costPerRequest: SERPER_SEARCH_COST_EUR,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new SerperSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['BRAVE-HTML-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BraveSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['BING-HTML-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BingSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['DDG-LITE-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new DDGSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['SEARXNG-NET-1', {
            costPerRequest: 0,
            tier: 9,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new SearXNGProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['JINA-1', {
            costPerRequest: 0.002,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const target = payload.url || query;
                const provider = new JinaSearchProvider();
                return (await provider.search(target)) as unknown as T;
            }
        }],
        ['PERPLEXITY-API-4', {
            costPerRequest: 0.010,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new PerplexityProvider();
                return (await provider.search(query)) as unknown as T;
            }
        }],
        ['OPENAI-1', {
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
