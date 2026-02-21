import * as fs from 'fs';
require('dotenv').config();
import { parse } from 'csv-parse/sync';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { OpenAI } from 'openai';
import { MasterPipeline } from './MasterPipeline';
import { InputNormalizer } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
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

    if (!freeOk && !paidOk) {
        console.log('🔴 ABORT: Nessun provider free o paid raggiungibile. Problema di rete.');
        process.exit(1);
    }
    if (!paidOk) {
        console.log('🟡 FREE-ONLY MODE: Tutti i provider a pagamento sono invalidi o non configurati.');
        console.log('   Il batch girerà SOLO con risorse gratuite e Jina senza key.');
        return { mode: 'FREE_ONLY', available: ['DDG', 'BING', 'JINA'] };
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
        ['BING-HTML-1', {
            costPerRequest: 0,
            tier: 0,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const res = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }, timeout: 8000
                });
                const $ = cheerio.load(res.data);
                const results: any[] = [];
                $('li.b_algo').each((_: any, el: any) => {
                    const url = $(el).find('a').attr('href');
                    const title = $(el).find('h2').text();
                    const snippet = $(el).find('.b_caption p').text();
                    if (url) results.push({ url, title, snippet });
                });
                return results as unknown as T;
            }
        } as any],
        ['DDG-LITE-1', {
            costPerRequest: 0,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const res = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}&kl=it-it`, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
                });
                const $ = cheerio.load(res.data);
                const results: any[] = [];
                $('a.result-url').each((_: any, el: any) => {
                    const url = $(el).attr('href');
                    if (url) results.push({ url, title: url, snippet: '' });
                });
                return results as unknown as T;
            }
        } as any],
        ['SERPER-1', {
            costPerRequest: 0.001,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const query = typeof payload === 'string' ? payload : payload.query;
                const apiKey = process.env.SERPER_API_KEY || '';
                const res = await axios.post('https://google.serper.dev/search', { q: query, gl: 'it', hl: 'it' }, {
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }
                });
                return (res.data.organic || []).map((r: any) => ({ url: r.link, title: r.title, snippet: r.snippet })) as unknown as T;
            }
        } as any],
        ['JINA-1', {
            costPerRequest: 0.002,
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const url = typeof payload === 'string' ? payload : payload.url;
                const apiKey = process.env.JINA_API_KEY || '';
                const res = await axios.get(`https://r.jina.ai/${encodeURIComponent(url)}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                return res.data as unknown as T;
            }
        } as any],
        ['OPENAI-1', {
            costPerRequest: 0.005,
            tier: 3,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.OPENAI_API_KEY || '';
                const openai = new OpenAI({ apiKey });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: `Perform a web search for: "${query}". Return the top 3 best exact matches in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                const finalPayload = { ...payload, model: 'gpt-4o-mini' };
                const completion = await openai.chat.completions.create(finalPayload);
                return completion as unknown as T;
            }
        } as any],
        ['PERPLEXITY-1', {
            costPerRequest: 0.005,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.PERPLEXITY_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'sonar-reasoning-pro',
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return the top 3 best results in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only and DO NOT use reasoning tags in the final output.` }]
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                const finalPayload = { ...payload, model: 'sonar-reasoning-pro' };
                return (await openai.chat.completions.create(finalPayload)) as unknown as T;
            }
        } as any],
        ['DEEPSEEK-1', {
            costPerRequest: 0.002,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const apiKey = process.env.DEEPSEEK_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: `Find the official website for: "${query}". Return the best result in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
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
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return the top result in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
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
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.z.ai/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'z-chat',
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return results in JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.` }]
                    });
                    const content = c.choices[0].message.content || '[]';
                    const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
                    try { return JSON.parse(jsonMatch ? jsonMatch[0] : '[]') as T; } catch { return [] as unknown as T; }
                }
                const finalPayload = { ...payload, model: 'z-chat' };
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
        browserPool: pool
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

    console.log('[RunnerV6] Extraction Complete. Cleaning up...');
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
