import * as fs from 'fs';
require('dotenv').config();
import { parse } from 'csv-parse/sync';
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

    // Ping Browser Pool (Spawns 1 instance)
    try {
        const testNav = await pool.navigateSafe('about:blank');
        if (testNav.status === 'ERROR') throw new Error('Browser error');
        console.log('✅ [RunnerV6] BrowserPool initialized properly.');
    } catch (e) {
        console.warn('⚠️ [RunnerV6] BrowserPool failed to initialize test instance.');
    }
}

async function run() {
    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('Usage: ts-node RunnerV6.ts <path-to-csv>');
        process.exit(1);
    }

    // Dependencies
    const ledger = new CostLedger();
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
    const valve = new BackpressureValve({ ledger });
    const pool = new BrowserPool({ ledger });
    const registry = new ShadowRegistry('omega_shadow.sqlite'); // Dummy path

    // Initialize Real Providers

    // Initialize Real Providers securely via environment variables
    const router = new CostRouter(cache, ledger, new Map([
        ['SERPER-1', {
            costPerRequest: 0.001,
            tier: 1,
            execute: async <T>(payload: any): Promise<T> => {
                const axios = require('axios');
                const query = typeof payload === 'string' ? payload : payload.query;
                const apiKey = process.env.SERPER_API_KEY || '';
                const res = await axios.post('https://google.serper.dev/search', { q: query, gl: 'it', hl: 'it' }, {
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }
                });
                return (res.data.organic || []).map((r: any) => ({ url: r.link, title: r.title, snippet: r.snippet })) as unknown as T;
            }
        } as any],
        ['JINA-1', {
            costPerRequest: 0.002, // Base Jina cost
            tier: 2,
            execute: async <T>(payload: any): Promise<T> => {
                const axios = require('axios');
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
                const { OpenAI } = require('openai');
                const apiKey = process.env.OPENAI_API_KEY || '';
                const openai = new OpenAI({ apiKey });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'user', content: `Perform a web search for: "${query}". Return the top 3 best exact matches in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
                    });
                    return JSON.parse(c.choices[0].message.content?.replace(/```json|```/g, '').trim() || '[]') as T;
                }
                const completion = await openai.chat.completions.create(payload);
                return completion as unknown as T;
            }
        } as any],
        ['PERPLEXITY-1', {
            costPerRequest: 0.005,
            tier: 4,
            execute: async <T>(payload: any): Promise<T> => {
                const { OpenAI } = require('openai');
                const apiKey = process.env.PERPLEXITY_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.perplexity.ai' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'sonar-reasoning-pro',
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return the top 3 best results in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only and DO NOT use reasoning tags in the final output.` }]
                    });
                    return JSON.parse(c.choices[0].message.content?.replace(/```json|```/g, '').trim() || '[]') as T;
                }
                return (await openai.chat.completions.create(payload)) as unknown as T;
            }
        } as any],
        ['DEEPSEEK-1', {
            costPerRequest: 0.002,
            tier: 5,
            execute: async <T>(payload: any): Promise<T> => {
                const { OpenAI } = require('openai');
                const apiKey = process.env.DEEPSEEK_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: `Find the official website for: "${query}". Return the best result in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
                    });
                    return JSON.parse(c.choices[0].message.content?.replace(/```json|```/g, '').trim() || '[]') as T;
                }
                return (await openai.chat.completions.create(payload)) as unknown as T;
            }
        } as any],
        ['KIMI-1', {
            costPerRequest: 0.002,
            tier: 6,
            execute: async <T>(payload: any): Promise<T> => {
                const { OpenAI } = require('openai');
                const apiKey = process.env.KIMI_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.moonshot.cn/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'moonshot-v1-8k',
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return the top result in this JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Output raw JSON only.` }]
                    });
                    return JSON.parse(c.choices[0].message.content?.replace(/```json|```/g, '').trim() || '[]') as T;
                }
                return (await openai.chat.completions.create(payload)) as unknown as T;
            }
        } as any],
        ['ZAI-1', {
            costPerRequest: 0.002,
            tier: 7,
            execute: async <T>(payload: any): Promise<T> => {
                const { OpenAI } = require('openai');
                const apiKey = process.env.Z_AI_API_KEY || '';
                const openai = new OpenAI({ apiKey, baseURL: 'https://api.z.ai/v1' });
                if (typeof payload === 'string' || !!payload.query) {
                    const query = typeof payload === 'string' ? payload : payload.query;
                    const c = await openai.chat.completions.create({
                        model: 'z-chat',
                        messages: [{ role: 'user', content: `Search the web for: "${query}". Return results in JSON array format: [{"title":"...","url":"...","snippet":"..."}]. Raw JSON only.` }]
                    });
                    return JSON.parse(c.choices[0].message.content?.replace(/```json|```/g, '').trim() || '[]') as T;
                }
                return (await openai.chat.completions.create(payload)) as unknown as T;
            }
        } as any]
    ]));

    const gate = new PreVerifyGate(cache, ledger);
    const buffer = new EnrichmentBuffer(cache);
    const dedup = new SerpDeduplicator(router, new (require('./QuerySanitizer').QuerySanitizer)(), buffer);
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
    const promises = records.map((row: any, idx: number) => {
        return pipeline.processCompany(row, idx).then(res => {
            done++;
            if (done % 10 === 0) {
                const metrics = valve.getMetrics();
                const poolMetrics = pool.getPoolStatus();
                console.log(`📊 Progress: ${done}/${records.length} (${((done / records.length) * 100).toFixed(1)}%) | 🚦 Concurrency: ${metrics.current_concurrency}/${metrics.max_concurrency} (Q: ${metrics.queue_depth}) | ❌ Errors: ${(metrics.error_rate_5m * 100).toFixed(1)}% | 🩸 Bleeding: ${bleedingCtrl.isBleedingModeActive}`);
            }
            return res;
        });
    });

    await Promise.all(promises);

    console.log('[RunnerV6] Extraction Complete. Cleaning up...');
    valve.cleanup();
    ledger.cleanup();
    await pool.destroyAll();
    process.exit(0);
}

if (require.main === module) {
    run().catch(err => {
        console.error('Fatal Runner Error:', err);
        process.exit(1);
    });
}
