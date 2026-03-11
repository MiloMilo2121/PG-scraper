require('dotenv').config();

import { OpenAI } from 'openai';
import { MasterPipeline } from './MasterPipeline';
import { InputNormalizer } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
import { BingSearchProvider, DDGSearchProvider, BraveSearchProvider, SerperSearchProvider, JinaSearchProvider, CrtShProvider, SearXNGProvider } from '../enricher/core/discovery/search_provider';
import { MxDiscoveryProvider } from '../enricher/core/discovery/mx_discovery_provider';
import { PerplexityProvider } from '../enricher/core/discovery/perplexity_provider';
import { LLMOracleGuard } from './LLMOracleGuard';
import { StopTheBleedingController } from './StopTheBleedingController';
import { BackpressureValve } from './BackpressureValve';
import { BilancioHunter } from './BilancioHunter';
import { LinkedInSniper } from './LinkedInSniper';
import { BrowserPool } from './BrowserPool';
import { MemoryFirstCache } from './MemoryFirstCache';
import { CostLedger } from './CostLedger';
import { CostRouter, ProviderAdapter } from './CostRouter';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentPostProcessor } from './EnrichmentPostProcessor';
import { PecHunter } from './PecHunter';
import { config } from '../enricher/config';

export interface OmegaRuntime {
    ledger: CostLedger;
    cache: MemoryFirstCache;
    valve: BackpressureValve;
    pool: BrowserPool;
    registry: ShadowRegistry;
    router: CostRouter;
    pipeline: MasterPipeline;
    cleanup(): Promise<void>;
}

function buildProviderMap(): Map<string, ProviderAdapter> {
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
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'direct', ...payload.options });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        }],
        ['HTTP-SCRAPEDO-3', {
            costPerRequest: 0.071,
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'scrape_do', ...payload.options });
                if (result.status === 403) throw new Error('BLOCK');
                return result as unknown as T;
            }
        }],
        ['HTTP-BRIGHTDATA-4', {
            costPerRequest: 0.130,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'brightdata', ...payload.options });
                return result as unknown as T;
            }
        }],
        ['ORACLE-CRAWL4AI-5', {
            costPerRequest: 0,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { OracleClient } = require('../enricher/utils/oracle_client');
                const result = await OracleClient.fetchHtmlStealth(url);
                return { data: result.html, status: 200 } as unknown as T;
            }
        }],
        ['SERPER-1', {
            costPerRequest: 0.001,
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
                    const c = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Return a JSON array.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
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
                    const c = await openai.chat.completions.create({
                        model: 'sonar-pro',
                        messages: [
                            { role: 'system', content: 'You search the web and return official company websites. Return ONLY a raw JSON array. No markdown fences, no reasoning, no explanation.' },
                            { role: 'user', content: `Find the official website for Italian company: "${query}". Return the top 3 results in this exact JSON format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON array only.` }
                        ]
                    });
                    const content = c.choices[0].message.content || '[]';
                    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
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
                    const c = await openai.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions (.it, .com, .eu domains). Only return URLs you are confident about. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website URLs in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = c.choices[0].message.content || '[]';
                    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
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
                    const c = await openai.chat.completions.create({
                        model: 'moonshot-v1-8k',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
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
                    const c = await openai.chat.completions.create({
                        model: 'glm-4-flash',
                        messages: [
                            { role: 'system', content: 'You are an Italian business domain expert. Given a company name and city, return the most likely official website URL. Use your knowledge of Italian business naming conventions. Output ONLY raw JSON, no markdown.' },
                            { role: 'user', content: `Company: "${query}"\n\nReturn the most likely official website in JSON format: [{"title":"...","url":"...","snippet":"..."}]. If unsure, return []. Raw JSON only.` }
                        ],
                        temperature: 0.1
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                return (await openai.chat.completions.create({ ...payload, model: 'glm-4-flash' })) as unknown as T;
            }
        }]
    ]);
}

export async function createOmegaRuntime(): Promise<OmegaRuntime> {
    const ledger = new CostLedger({ filePath: config.runtime.costLedgerPath });
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
    const valve = new BackpressureValve({ ledger });
    const pool = new BrowserPool({
        ledger,
        sessionStateDir: config.runtime.browserSessionDir,
    });
    const registry = new ShadowRegistry('omega_shadow.sqlite');
    const router = new CostRouter(cache, ledger, buildProviderMap());
    const gate = new PreVerifyGate(cache, ledger);
    const buffer = new EnrichmentBuffer(cache);
    const dedup = new SerpDeduplicator(router, new QuerySanitizer(), buffer);
    const oracleGuard = new LLMOracleGuard(cache, valve);
    const bleedingCtrl = new StopTheBleedingController(ledger, valve, pool);
    const pipeline = new MasterPipeline({
        normalizer: new InputNormalizer(),
        registry,
        gate,
        dedup,
        oracleGuard,
        bleedingCtrl,
        valve,
        bilancioHunter: new BilancioHunter(dedup),
        linkedinSniper: new LinkedInSniper(dedup, valve),
        browserPool: pool,
        costRouter: router,
        postProcessor: new EnrichmentPostProcessor(pool),
        pecHunter: new PecHunter(pool),
    });

    return {
        ledger,
        cache,
        valve,
        pool,
        registry,
        router,
        pipeline,
        cleanup: async () => {
            valve.cleanup();
            ledger.cleanup();
            router.cleanup();
            await pool.destroyAll();
        },
    };
}
