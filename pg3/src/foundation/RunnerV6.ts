import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();
import { parse } from 'csv-parse/sync';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as cheerio from 'cheerio';
import { OpenAI } from 'openai';
import { MasterPipeline } from './MasterPipeline';
import { InputNormalizer } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
import { BingSearchProvider, DDGSearchProvider, BraveSearchProvider, SerperSearchProvider, JinaSearchProvider, CrtShProvider, SearXNGProvider } from '../enricher/core/discovery/search_provider';
import { MxDiscoveryProvider } from '../enricher/core/discovery/mx_discovery_provider';
import { FreeProxyAggregatorProvider } from '../enricher/core/discovery/free_proxy_aggregator_provider';
import { PerplexityProvider } from '../enricher/core/discovery/perplexity_provider';
import { LLMOracleGuard } from './LLMOracleGuard';
import { StopTheBleedingController } from './StopTheBleedingController';
import { BackpressureValve } from './BackpressureValve';
import { BilancioHunter } from './BilancioHunter';
import { LinkedInSniper } from './LinkedInSniper';
import { BrowserPool } from './BrowserPool';
import { MemoryFirstCache } from './MemoryFirstCache';
import { CostLedger } from './CostLedger';
import { CostRouter } from './CostRouter';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentPostProcessor } from './EnrichmentPostProcessor';

// Prevent Puppeteer Stealth plugin "Target closed" async crashes from killing the runner
process.on('unhandledRejection', (reason, promise) => {
    if (reason && typeof reason === 'object' && 'message' in reason) {
        const msg = (reason as Error).message;
        if (msg.includes('Target closed') || msg.includes('TargetCloseError') || msg.includes('Session closed')) {
            console.warn('[RunnerV6] Ignored unhandled ProtocolError (Target closed) from stealth evasion');
            return;
        }
    }
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function healthCheck(cache: MemoryFirstCache, registry: ShadowRegistry, pool: BrowserPool) {
    console.log('[RunnerV6] Running Startup Health Diagnostics...');
    const redisOk = await cache.ping();
    if (!redisOk) {
        console.warn('⚠️ [RunnerV6] Redis is unreachable. Running in DEGRADED L1-only mode.');
    } else {
        console.log('✅ [RunnerV6] Redis healthy.');
    }

    const regOk = registry.getStatus();
    if (!regOk) {
        console.warn('⚠️ [RunnerV6] Local DuckDB/SQLite ShadowRegistry missing. Operating without local cache.');
    } else {
        console.log('✅ [RunnerV6] ShadowRegistry mounted.');
    }

    try {
        const testNav = await pool.navigateSafe('about:blank');
        if (testNav.status === 'ERROR') throw new Error('Browser error');
        console.log('✅ [RunnerV6] BrowserPool initialized properly.');
    } catch (e) {
        console.warn('⚠️ [RunnerV6] BrowserPool failed to initialize test instance.');
    }
}

async function startupGate(): Promise<{ mode: 'FULL' | 'FREE_ONLY' | 'ABORT', available: string[] }> {
    console.log('\n🔍 OMEGA v6 — Pre-flight provider check...\n');
    const available: string[] = [];
    let paidOk = false;
    let freeOk = false;

    const keys = ['SERPER_API_KEY', 'JINA_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'Z_AI_API_KEY'];
    for (const k of keys) {
        const val = process.env[k];
        if (val && val.trim() !== '' && !val.includes('your-') && !val.includes('xxx')) {
            paidOk = true;
            available.push(k.replace('_API_KEY', ''));
        }
    }

    try {
        const res = await axios.get('https://lite.duckduckgo.com/lite', { timeout: 5000 });
        if (res.status === 200) freeOk = true;
    } catch { }

    if (!paidOk) {
        console.log('🟡 FREE-ONLY MODE: Tutti i provider a pagamento sono invalidi o non configurati.');
        console.log('   Il batch girerà SOLO con risorse gratuite e Jina senza key.');
        return { mode: 'FREE_ONLY', available: ['DDG', 'BRAVE', 'BING', 'JINA'] };
    }

    console.log(`🟢 FULL MODE: Provider operativi rilevati: ${available.join(', ')}`);
    return { mode: 'FULL', available };
}

async function run() {
    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('Usage: ts-node RunnerV6.ts <path-to-csv>');
        process.exit(1);
    }

    const gateCheck = await startupGate();

    // Dependencies
    const ledger = new CostLedger();
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
    const valve = new BackpressureValve({ ledger });
    const pool = new BrowserPool({ ledger });
    const registry = new ShadowRegistry('omega_shadow.sqlite'); // Dummy path

    const router = new CostRouter(cache, ledger, new Map([
        ['DNS-MX-MINING-0', {
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new MxDiscoveryProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['CRTSH-API-1', {
            costPerRequest: 0,
            tier: 0, // CT Logs e MX Lookup viaggiano assieme, costano 0.
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new CrtShProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['BING-HTML-1', {
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BingSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['SEARXNG-NET-1', {
            costPerRequest: 0,
            tier: 1, // Same as DDG/Brave
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new SearXNGProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['DDG-LITE-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new DDGSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['BRAVE-HTML-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BraveSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['SERPER-1', {
            costPerRequest: 0.001,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new SerperSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['JINA-1', {
            costPerRequest: 0.002,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const target = payload.url || query;
                const provider = new JinaSearchProvider();
                // We assume search handles both URLs and Queries appropriately based on provider implementation. It defaults to 's.jina.ai'.
                return (await provider.search(target)) as unknown as T;
            }
        } as any],
        ['FREE-AGGR-PROXY-3', {
            costPerRequest: 0,
            tier: 3, // Layer estremo. Gira le chiamate a API free (1000 invii)
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new FreeProxyAggregatorProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['PERPLEXITY-API-4', {
            costPerRequest: 0.010,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new PerplexityProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
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
        } as any],
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
                    // Strip <think> tags that sonar models sometimes emit
                    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                const finalPayload = { ...payload, model: 'sonar-pro' };
                return (await openai.chat.completions.create(finalPayload)) as unknown as T;
            }
        } as any],
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
                    // Strip <think> tags from DeepSeek reasoning models
                    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                const finalPayload = { ...payload, model: 'deepseek-chat' };
                return (await openai.chat.completions.create(finalPayload)) as unknown as T;
            }
        } as any],
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
                const finalPayload = { ...payload, model: 'moonshot-v1-8k' };
                return (await openai.chat.completions.create(finalPayload)) as unknown as T;
            }
        } as any],
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
                const finalPayload = { ...payload, model: 'glm-4-flash' };
                return (await openai.chat.completions.create(finalPayload)) as unknown as T;
            }
        } as any]
    ]));

    const gate = new PreVerifyGate(cache, ledger);
    const buffer = new EnrichmentBuffer(cache);
    const dedup = new SerpDeduplicator(router, new QuerySanitizer(), buffer);
    const oracleGuard = new LLMOracleGuard(cache, valve);
    const bleedingCtrl = new StopTheBleedingController(ledger, valve, pool);

    await healthCheck(cache, registry, pool);

    const pipeline = new MasterPipeline({
        normalizer: new InputNormalizer(),
        registry, gate, dedup, oracleGuard, bleedingCtrl, valve,
        bilancioHunter: new BilancioHunter(dedup),
        linkedinSniper: new LinkedInSniper(dedup, valve),
        browserPool: pool,
        costRouter: router,
        postProcessor: new EnrichmentPostProcessor(pool)
    });

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        bom: true // Fixes SERPER-1 artifact bugs immediately
    });

    console.log(`[RunnerV6] Loaded ${records.length} records. Commencing OMEGA ENGINE v6.`);

    let done = 0;
    const BATCH_SIZE = 15; // Process in controlled batches to prevent OOM
    const results: any[] = [];

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((row: any, batchIdx: number) => {
            const idx = i + batchIdx;
            return pipeline.processCompany(row, idx).then(res => {
                done++;
                if (done % 10 === 0) {
                    const metrics = valve.getMetrics();
                    const poolMetrics = pool.getPoolStatus();
                    console.log(`📊 Progress: ${done}/${records.length} (${((done / records.length) * 100).toFixed(1)}%) | 🚦 Concurrency: ${metrics.current_concurrency}/${metrics.max_concurrency} (Q: ${metrics.queue_depth}) | ❌ Errors: ${(metrics.error_rate_5m * 100).toFixed(1)}% | 🩸 Bleeding: ${bleedingCtrl.isBleedingModeActive}`);
                }
                return res;
            }).catch(err => {
                done++;
                console.error(`[RunnerV6] Company ${idx} failed:`, err.message);
                return { status: 'ERROR', error: err.message };
            });
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
    }

    console.log('[RunnerV6] Extraction Complete. Saving results...');

    // ===== BUG FIX: EXPORT RESULTS TO DISK =====
    const inputBasename = path.basename(csvPath, path.extname(csvPath));
    const outputDir = path.dirname(csvPath);
    const jsonOutputPath = path.join(outputDir, `${inputBasename}_v6_results.json`);
    const csvOutputPath = path.join(outputDir, `${inputBasename}_v6_results.csv`);

    // 1. Save raw JSON (full fidelity)
    fs.writeFileSync(jsonOutputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`[RunnerV6] ✅ JSON saved: ${jsonOutputPath}`);

    // 2. Flatten to CSV for human consumption
    const csvHeader = 'company_name,city,normalized_name,status,website_url,confidence,discovery_layer,duration_ms,layers_attempted';
    const csvRows = results.map((r: any) => {
        const companyName = (r.input?.company_name || '').replace(/,/g, ';').replace(/"/g, "'");
        const city = (r.input?.city || '').replace(/,/g, ';');
        const normalizedName = (r.input?.normalized_name || '').replace(/,/g, ';');
        const status = r.status || 'ERROR';
        const url = r.website?.url || '';
        const confidence = r.website?.confidence || '';
        const layer = r.website?.discovery_layer || '';
        const duration = r.meta?.duration_ms || '';
        const layers = (r.meta?.layers_attempted || []).join(';');
        return `"${companyName}","${city}","${normalizedName}",${status},${url},${confidence},${layer},${duration},"${layers}"`;
    });
    const csvContent = [csvHeader, ...csvRows].join('\n');
    fs.writeFileSync(csvOutputPath, csvContent, 'utf8');
    console.log(`[RunnerV6] ✅ CSV saved: ${csvOutputPath}`);

    // Final stats
    const found = results.filter((r: any) => r.status === 'FOUND_COMPLETE').length;
    const notFound = results.filter((r: any) => r.status === 'NOT_FOUND').length;
    const errors = results.filter((r: any) => r.status === 'ERROR').length;
    const ledgerSummary = await ledger.getSummary();
    console.log(`\n📊 FINAL REPORT:`);
    console.log(`   Total: ${results.length} | ✅ Found: ${found} | ❌ Not Found: ${notFound} | 💀 Errors: ${errors}`);
    console.log(`   💰 Total Cost: €${ledgerSummary.total_cost_eur.toFixed(4)} | API Calls: ${ledgerSummary.total_calls} | Success Rate: ${(ledgerSummary.success_rate * 100).toFixed(1)}%`);
    console.log(`   💰 Cost/Company: €${(ledgerSummary.total_cost_eur / results.length).toFixed(4)}`);

    // Cleanup
    valve.cleanup();
    ledger.cleanup();
    router.cleanup();
    await pool.destroyAll();
    process.exit(0);
}

if (require.main === module) {
    run().catch(err => {
        console.error('Fatal Runner Error:', err);
        process.exit(1);
    });
}
