import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config();
import { parse } from 'csv-parse/sync';
// axios removed — all HTTP now via undici
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as cheerio from 'cheerio';
import { OpenAI } from 'openai';
import { MasterPipeline } from './MasterPipeline';
import { InputNormalizer } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
import { BingSearchProvider, DDGSearchProvider, BraveSearchProvider, SerperSearchProvider, JinaSearchProvider, CrtShProvider } from '../enricher/core/discovery/search_provider';
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
import { CostRouter } from './CostRouter';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentPostProcessor } from './EnrichmentPostProcessor';
import { PecHunter } from './PecHunter';

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
        const { request: undiciRequest } = await import('undici');
        const res = await undiciRequest('https://lite.duckduckgo.com/lite', { method: 'GET', bodyTimeout: 5000, headersTimeout: 5000 });
        if (res.statusCode === 200) freeOk = true;
        // Consume the body to prevent memory leak
        await res.body.text();
    } catch { }

    if (!paidOk) {
        console.log('🟡 FREE-ONLY MODE: Tutti i provider a pagamento sono invalidi o non configurati.');
        console.log('   Il batch girerà SOLO con risorse gratuite e Jina senza key.');
        return { mode: 'FREE_ONLY', available: ['DNS-MX-MINING', 'CRTSH', 'DDG', 'BRAVE', 'BING', 'JINA'] };
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
        // ======================= SERP LAYERS =======================
        ['SERPER-1', {
            costPerRequest: 0.001,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new SerperSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['DNS-MX-MINING-0', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new MxDiscoveryProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['CRTSH-API-1', {
            costPerRequest: 0,
            tier: 1, // Free signal, but not the primary production lane anymore.
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new CrtShProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        // ======================= HTTP LAYERS (PROXY_FETCH) =======================
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
        } as any],
        ['HTTP-SCRAPEDO-2', {
            costPerRequest: 0.071,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, {
                    mode: 'scrape_do',
                    render: false,
                    super: false,
                    ...(payload.options || {})
                });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        } as any],
        ['HTTP-SCRAPEDO-3', {
            costPerRequest: 0.071, // ScrapeDo Pro tier (only success is billed)
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, {
                    mode: 'scrape_do',
                    render: true,
                    super: true,
                    ...(payload.options || {})
                });
                if (result.status === 403 || result.status === 429) throw new Error('BLOCK');
                return result as unknown as T;
            }
        } as any],
        ['HTTP-BRIGHTDATA-4', {
            costPerRequest: 0.130, // BrightData premium Glass Break
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { ScraperClient } = require('../enricher/utils/scraper_client');
                const result = await ScraperClient.fetchHtml(url, { mode: 'brightdata', ...payload.options });
                return result as unknown as T;
            }
        } as any],
        ['ORACLE-CRAWL4AI-5', {
            costPerRequest: 0.0, // Local Python execution is free
            tier: 5, // Ultimate stealth fallback
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const { OracleClient } = require('../enricher/utils/oracle_client');
                const result = await OracleClient.fetchHtmlStealth(url);
                // Map to the shape expected by downstream, which usually wants { data: html_string, status: 200 }
                return { data: result.html, status: 200 } as unknown as T;
            }
        } as any],
        ['BING-HTML-1', {
            costPerRequest: 0,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BingSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['DDG-LITE-1', {
            costPerRequest: 0,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new DDGSearchProvider();
                return (await provider.search(query)) as unknown as T;
            }
        } as any],
        ['BRAVE-HTML-1', {
            costPerRequest: 0,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const provider = new BraveSearchProvider();
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
        postProcessor: new EnrichmentPostProcessor(pool),
        pecHunter: new PecHunter(pool)
    });

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        bom: true // Fixes SERPER-1 artifact bugs immediately
    });

    const inputBasename = path.basename(csvPath, path.extname(csvPath));
    const outputDir = path.dirname(csvPath);
    const jsonlOutputPath = path.join(outputDir, `${inputBasename}_v6_results.jsonl`);
    const csvOutputPath = path.join(outputDir, `${inputBasename}_v6_results.csv`);

    let startIndex = 0;
    if (fs.existsSync(csvOutputPath)) {
        // Read file and count lines to find out how many we processed (excluding header)
        const existingContent = fs.readFileSync(csvOutputPath, 'utf-8');
        const lineCount = existingContent.split('\n').filter(l => l.trim().length > 0).length;
        startIndex = Math.max(0, lineCount - 1);
        console.log(`[RunnerV6] 📌 CHECKPOINT DETECTED: Found existing CSV with ${lineCount} lines. Resuming from index ${startIndex}.`);
    } else {
        // Write header since file doesn't exist
        const csvHeader = 'company_name,city,normalized_name,status,website_url,confidence,discovery_layer,pec,email,revenue,revenue_year,employees,duration_ms,layers_attempted\n';
        fs.writeFileSync(csvOutputPath, csvHeader, 'utf8');
        if (fs.existsSync(jsonlOutputPath)) fs.unlinkSync(jsonlOutputPath);
    }

    console.log(`[RunnerV6] Loaded ${records.length} total records. Commencing OMEGA ENGINE v6 from index ${startIndex}.`);

    let done = startIndex;
    const BATCH_SIZE = 15; // Process in controlled batches to prevent OOM

    // We no longer store the entire results array in memory to save RAM on 29k iterations
    let memFound = 0;
    let memNotFound = 0;
    let memErrors = 0;

    for (let i = startIndex; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (row: any, batchIdx: number) => {
            const idx = i + batchIdx;
            try {
                const res = await pipeline.processCompany(row, idx);
                done++;
                if (done % 10 === 0) {
                    const metrics = valve.getMetrics();
                    const poolMetrics = pool.getPoolStatus();
                    console.log(`📊 Progress: ${done}/${records.length} (${((done / records.length) * 100).toFixed(1)}%) | 🚦 Concurrency: ${metrics.current_concurrency}/${metrics.max_concurrency} (Q: ${metrics.queue_depth}) | ❌ Errors: ${(metrics.error_rate_5m * 100).toFixed(1)}% | 🩸 Bleeding: ${bleedingCtrl.isBleedingModeActive}`);
                }
                return res;
            } catch (err: any) {
                done++;
                console.error(`[RunnerV6] Company ${idx} failed:`, err.message);
                return { input: row, status: 'ERROR', error: err.message };
            }
        });

        const batchResults = await Promise.all(batchPromises);

        // --- 💾 STREAMING & CONTINUOUS APPEND ---
        const csvRows = batchResults.map((r: any) => {
            const companyName = (r.input?.company_name || '').replace(/,/g, ';').replace(/"/g, "'");
            const city = (r.input?.city || '').replace(/,/g, ';');
            const normalizedName = (r.input?.normalized_name || '').replace(/,/g, ';');
            const status = r.status || 'ERROR';
            const url = r.website?.url || '';
            const confidence = r.website?.confidence || '';
            const layer = r.website?.discovery_layer || '';
            const pec = r.pec || '';
            const email = r.email || '';
            const revenue = r.financial?.fatturato_current || '';
            const revenueYear = r.financial?.year || '';
            const employees = r.employees || '';
            const duration = r.meta?.duration_ms || '';
            const layers = (r.meta?.layers_attempted || []).join(';');
            return `"${companyName}","${city}","${normalizedName}",${status},${url},${confidence},${layer},${pec},${email},${revenue},${revenueYear},${employees},${duration},"${layers}"`;
        });

        fs.appendFileSync(csvOutputPath, csvRows.join('\n') + '\n', 'utf8');

        const jsonlRows = batchResults.map((r: any) => JSON.stringify(r));
        fs.appendFileSync(jsonlOutputPath, jsonlRows.join('\n') + '\n', 'utf8');

        // Update RAM-safe stats
        for (const r of batchResults) {
            if (r.status === 'FOUND_COMPLETE') memFound++;
            else if (r.status === 'NOT_FOUND') memNotFound++;
            else memErrors++;
        }

        // Force GC after each batch to prevent Node from hoarding RAM over thousands of loops
        if (global.gc) global.gc();
    }

    console.log('[RunnerV6] Extraction Complete.');

    const ledgerSummary = await ledger.getSummary();
    const totalProcessed = memFound + memNotFound + memErrors;
    console.log(`\n📊 FINAL REPORT:`);
    console.log(`   Total (Session): ${totalProcessed} | ✅ Found: ${memFound} | ❌ Not Found: ${memNotFound} | 💀 Errors: ${memErrors}`);
    console.log(`   💰 Total Cost: €${ledgerSummary.total_cost_eur.toFixed(4)} | API Calls: ${ledgerSummary.total_calls} | Success Rate: ${(ledgerSummary.success_rate * 100).toFixed(1)}%`);
    console.log(`   💰 Cost/Company: €${totalProcessed > 0 ? (ledgerSummary.total_cost_eur / totalProcessed).toFixed(4) : 0.0000}`);

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
