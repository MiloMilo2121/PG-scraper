// src/diagnostics/provider-healthcheck.ts
// Esegui con: npx tsx src/diagnostics/provider-healthcheck.ts

import 'dotenv/config';

interface ProviderTest {
    name: string;
    tier: number;
    envKey: string;
    test: () => Promise<{ ok: boolean; detail: string }>;
}

// ═══════════════════════════════════════════
// VALIDAZIONE PRE-VOLO DI OGNI SINGOLA KEY
// ═══════════════════════════════════════════

const providers: ProviderTest[] = [

    // ─── TIER 0: FREE (nessuna key necessaria) ───
    {
        name: 'DuckDuckGo Lite',
        tier: 0,
        envKey: '(none)',
        test: async () => {
            try {
                const res = await fetch('https://lite.duckduckgo.com/lite?q=test&kl=it-it', {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
                });
                const html = await res.text();
                const hasResults = html.includes('result-link') || html.includes('href=');
                return { ok: hasResults, detail: hasResults ? `HTTP ${res.status}, results found` : `HTTP ${res.status}, no results in HTML` };
            } catch (e: any) {
                return { ok: false, detail: `Network error: ${e.message}` };
            }
        }
    },

    {
        name: 'Bing HTML',
        tier: 0,
        envKey: '(none)',
        test: async () => {
            try {
                const res = await fetch('https://www.bing.com/search?q=test&setlang=it', {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
                });
                const html = await res.text();
                const hasResults = html.includes('b_algo') || html.includes('<li');
                return { ok: hasResults, detail: `HTTP ${res.status}, ${hasResults ? 'results found' : 'blocked/empty'}` };
            } catch (e: any) {
                return { ok: false, detail: `Network error: ${e.message}` };
            }
        }
    },

    // ─── TIER 1: FREE API (key opzionale o assente) ───
    {
        name: 'Jina Search',
        tier: 1,
        envKey: 'JINA_API_KEY',
        test: async () => {
            try {
                const headers: Record<string, string> = { 'Accept': 'application/json' };
                const jinaKey = process.env.JINA_API_KEY;
                if (jinaKey && jinaKey.trim()) {
                    headers['Authorization'] = `Bearer ${jinaKey.trim()}`;
                }
                const res = await fetch('https://s.jina.ai/?q=test+italia', {
                    signal: AbortSignal.timeout(15000),
                    headers,
                });
                if (res.status === 401 || res.status === 403) {
                    return { ok: false, detail: `HTTP ${res.status}: Key invalida o scaduta` };
                }
                if (res.status === 429) {
                    return { ok: true, detail: `HTTP 429: Key valida ma rate-limited (funziona, aspetta)` };
                }
                const data = await res.text();
                return { ok: res.ok && data.length > 50, detail: `HTTP ${res.status}, ${data.length} chars returned` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Jina Reader',
        tier: 1,
        envKey: 'JINA_API_KEY',
        test: async () => {
            try {
                const headers: Record<string, string> = {};
                const jinaKey = process.env.JINA_API_KEY;
                if (jinaKey && jinaKey.trim()) {
                    headers['Authorization'] = `Bearer ${jinaKey.trim()}`;
                }
                const res = await fetch('https://r.jina.ai/https://example.com', {
                    signal: AbortSignal.timeout(15000),
                    headers,
                });
                const text = await res.text();
                return { ok: text.length > 100, detail: `HTTP ${res.status}, ${text.length} chars` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Brave Search API',
        tier: 2,
        envKey: 'BRAVE_SEARCH_API_KEY',
        test: async () => {
            const key = process.env.BRAVE_SEARCH_API_KEY;
            if (!key || !key.trim() || key.includes('your-') || key.includes('xxx')) {
                return { ok: false, detail: 'Key mancante o placeholder' };
            }
            try {
                const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=test+italia&count=3&country=IT&search_lang=it', {
                    signal: AbortSignal.timeout(15000),
                    headers: {
                        'Accept': 'application/json',
                        'X-Subscription-Token': key.trim(),
                    },
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                if (res.status === 429) return { ok: true, detail: 'HTTP 429: Key valida ma rate-limited' };
                const data = await res.json();
                return { ok: res.ok, detail: `HTTP ${res.status}, ${data.web?.results?.length || 0} results` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Tavily Search',
        tier: 2,
        envKey: 'TAVILY_API_KEY',
        test: async () => {
            const key = process.env.TAVILY_API_KEY;
            if (!key || !key.trim() || key.includes('your-') || key.includes('xxx')) {
                return { ok: false, detail: 'Key mancante o placeholder' };
            }
            try {
                const res = await fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    signal: AbortSignal.timeout(15000),
                    headers: {
                        'Authorization': `Bearer ${key.trim()}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: 'test italia',
                        search_depth: 'basic',
                        max_results: 3,
                        include_answer: false,
                        include_raw_content: false,
                    }),
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                if (res.status === 429) return { ok: true, detail: 'HTTP 429: Key valida ma rate-limited' };
                const data = await res.json();
                return { ok: res.ok, detail: `HTTP ${res.status}, ${data.results?.length || 0} results` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    // ─── TIER 2: CHEAP API ───
    {
        name: 'Serper.dev',
        tier: 2,
        envKey: 'SERPER_API_KEY',
        test: async () => {
            const key = process.env.SERPER_API_KEY;
            if (!key || !key.trim() || key.includes('your-') || key.includes('xxx')) {
                return { ok: false, detail: `Key mancante o placeholder: "${key?.substring(0, 10)}..."` };
            }
            try {
                // Test con Account endpoint (non consuma crediti)
                const res = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    signal: AbortSignal.timeout(10000),
                    headers: { 'X-API-KEY': key.trim(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: 'test', gl: 'it', hl: 'it', num: 1 }),
                });
                if (res.status === 403) return { ok: false, detail: 'HTTP 403: Crediti esauriti o key revocata' };
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                if (res.status === 400) return { ok: false, detail: 'HTTP 400: Formato key sbagliato (spazi?)' };
                const data = await res.json();
                return { ok: true, detail: `OK — ${data.organic?.length || 0} results` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'DeepSeek',
        tier: 2,
        envKey: 'DEEPSEEK_API_KEY',
        test: async () => {
            const key = process.env.DEEPSEEK_API_KEY;
            if (!key || !key.trim() || key.includes('your-') || key.includes('xxx')) {
                return { ok: false, detail: `Key mancante o placeholder: "${key?.substring(0, 10)}..."` };
            }
            try {
                const res = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    signal: AbortSignal.timeout(15000),
                    headers: { 'Authorization': `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: 'Rispondi solo "OK"' }],
                        max_tokens: 5,
                    }),
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                if (res.status === 402) return { ok: false, detail: 'HTTP 402: Crediti esauriti' };
                if (res.status === 429) return { ok: true, detail: 'HTTP 429: Key valida ma rate-limited' };
                const data = await res.json();
                return { ok: true, detail: `OK — model responded: "${data.choices?.[0]?.message?.content}"` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Kimi (Moonshot)',
        tier: 2,
        envKey: 'KIMI_API_KEY',
        test: async () => {
            const key = process.env.KIMI_API_KEY;
            if (!key || !key.trim() || key.includes('your-')) {
                return { ok: false, detail: `Key mancante o placeholder` };
            }
            try {
                const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                    method: 'POST',
                    signal: AbortSignal.timeout(15000),
                    headers: { 'Authorization': `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'kimi-k2.5',
                        messages: [{ role: 'user', content: 'Rispondi solo "OK"' }],
                        max_tokens: 5,
                    }),
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                return { ok: res.ok, detail: `HTTP ${res.status}` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Scrape.do',
        tier: 2,
        envKey: 'SCRAPE_DO_TOKEN',
        test: async () => {
            const key = process.env.SCRAPE_DO_TOKEN;
            if (!key || !key.trim()) {
                return { ok: false, detail: 'Token mancante' };
            }
            try {
                const res = await fetch(`https://api.scrape.do?token=${key.trim()}&url=${encodeURIComponent('https://example.com')}`, {
                    signal: AbortSignal.timeout(15000),
                });
                if (res.status === 401 || res.status === 403) return { ok: false, detail: `HTTP ${res.status}: Token invalido` };
                const text = await res.text();
                return { ok: text.includes('Example Domain'), detail: `HTTP ${res.status}, ${text.length} chars` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    // ─── TIER 3: EXPENSIVE ───
    {
        name: 'OpenAI (gpt-4o-mini)',
        tier: 3,
        envKey: 'OPENAI_API_KEY',
        test: async () => {
            const key = process.env.OPENAI_API_KEY;
            if (!key || !key.trim() || key.includes('your-') || key === 'sk-your-openai-key-here') {
                return { ok: false, detail: `PLACEHOLDER RILEVATO: "${key?.substring(0, 20)}..."` };
            }
            // Solo test di autenticazione, non consuma quasi nulla
            try {
                const res = await fetch('https://api.openai.com/v1/models', {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'Authorization': `Bearer ${key.trim()}` },
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida o scaduta' };
                if (res.status === 429) return { ok: true, detail: 'HTTP 429: Key valida, rate-limited' };
                return { ok: res.ok, detail: `HTTP ${res.status}: Key valida` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },

    {
        name: 'Perplexity',
        tier: 3,
        envKey: 'PERPLEXITY_API_KEY',
        test: async () => {
            const key = process.env.PERPLEXITY_API_KEY;
            if (!key || !key.trim() || key.includes('your-')) {
                return { ok: false, detail: 'Key mancante o placeholder' };
            }
            try {
                const res = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    signal: AbortSignal.timeout(15000),
                    headers: { 'Authorization': `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'llama-3.1-sonar-small-128k-online',
                        messages: [{ role: 'user', content: 'test' }],
                        max_tokens: 5,
                    }),
                });
                if (res.status === 401) return { ok: false, detail: 'HTTP 401: Key invalida' };
                return { ok: res.ok, detail: `HTTP ${res.status}` };
            } catch (e: any) {
                return { ok: false, detail: `Error: ${e.message}` };
            }
        }
    },
];

// ═══════════════════════════════════════════
// ENVFILE VALIDATOR (trova spazi, newline, placeholder)
// ═══════════════════════════════════════════

function validateEnvKeys() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  FASE 0: VALIDAZIONE .env (SENZA CHIAMATE DI RETE)');
    console.log('═══════════════════════════════════════════════════════\n');

    const keysToCheck = [
        'SERPER_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TAVILY_API_KEY', 'JINA_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY',
        'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'SCRAPE_DO_TOKEN',
    ];

    let issues = 0;

    for (const envKey of keysToCheck) {
        const raw = process.env[envKey];

        if (!raw) {
            console.log(`  ❌ ${envKey}: MANCANTE (non presente nel .env)`);
            issues++;
            continue;
        }

        const problems: string[] = [];

        // Trailing/leading whitespace (KILLER invisibile!)
        if (raw !== raw.trim()) {
            problems.push(`SPAZI INVISIBILI (raw length=${raw.length}, trimmed=${raw.trim().length})`);
        }

        // Newline characters
        if (raw.includes('\n') || raw.includes('\r')) {
            problems.push('CONTIENE NEWLINE');
        }

        // Placeholder detection
        const placeholders = ['your-', 'xxx', 'placeholder', 'insert-', 'change-me', 'sk-your-'];
        for (const p of placeholders) {
            if (raw.toLowerCase().includes(p)) {
                problems.push(`PLACEHOLDER RILEVATO ("${p}")`);
            }
        }

        // Surrounding quotes (copiate dal .env con le virgolette)
        if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
            problems.push('HA VIRGOLETTE ATTORNO (il .env non vuole quotes)');
        }

        // Empty after trim
        if (raw.trim().length === 0) {
            problems.push('VUOTA (solo spazi)');
        }

        if (problems.length > 0) {
            console.log(`  ⚠️  ${envKey}: ${problems.join(' | ')}`);
            console.log(`     Valore raw: "${raw.substring(0, 30)}${raw.length > 30 ? '...' : ''}"`);
            issues++;
        } else {
            console.log(`  ✅ ${envKey}: Formato OK (${raw.trim().length} chars, no spazi, no placeholder)`);
        }
    }

    console.log(`\n  Risultato: ${issues === 0 ? '✅ TUTTE LE KEY FORMATTATE CORRETTAMENTE' : `⚠️  ${issues} PROBLEMI TROVATI — CORREGGI PRIMA DI PROCEDERE`}\n`);
    return issues;
}

// ═══════════════════════════════════════════
// PROVIDER LIVE TESTS
// ═══════════════════════════════════════════

async function runProviderTests() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  FASE 1: TEST LIVE DI OGNI PROVIDER (con chiamata reale)');
    console.log('═══════════════════════════════════════════════════════\n');

    const results: { name: string; tier: number; ok: boolean; detail: string }[] = [];

    for (const provider of providers) {
        process.stdout.write(`  🔍 Testing ${provider.name} (Tier ${provider.tier})...`);
        try {
            const result = await provider.test();
            results.push({ name: provider.name, tier: provider.tier, ...result });
            console.log(result.ok ? ` ✅ ${result.detail}` : ` ❌ ${result.detail}`);
        } catch (e: any) {
            results.push({ name: provider.name, tier: provider.tier, ok: false, detail: `CRASH: ${e.message}` });
            console.log(` 💀 CRASH: ${e.message}`);
        }
    }

    return results;
}

// ═══════════════════════════════════════════
// STRATEGIC ASSESSMENT
// ═══════════════════════════════════════════

function strategicAssessment(results: { name: string; tier: number; ok: boolean; detail: string }[]) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  FASE 2: VALUTAZIONE STRATEGICA');
    console.log('═══════════════════════════════════════════════════════\n');

    const working = results.filter(r => r.ok);
    const broken = results.filter(r => !r.ok);
    const freeWorking = working.filter(r => r.tier <= 1);
    const paidWorking = working.filter(r => r.tier >= 2);

    console.log(`  Provider funzionanti: ${working.length}/${results.length}`);
    console.log(`  ├── Free (T0-T1): ${freeWorking.length} funzionanti`);
    console.log(`  └── Paid (T2-T3): ${paidWorking.length} funzionanti`);

    if (freeWorking.length === 0) {
        console.log('\n  🔴 CRITICO: Nessun provider free funziona!');
        console.log('     Il server Hetzner potrebbe avere problemi di rete.');
        console.log('     Test: curl -I https://lite.duckduckgo.com');
    } else if (freeWorking.length >= 2 && paidWorking.length === 0) {
        console.log('\n  🟡 MODALITÀ FREE-ONLY: I provider gratuiti funzionano.');
        console.log('     L\'Engine PUÒ girare solo con DDG + Bing + Jina.');
        console.log('     Stima: ~55-65% delle aziende risolvibili (P.IVA + Website).');
        console.log('     Nessun costo. Nessuna key necessaria.');
        console.log('     Mancano: LLM fallback, vision, bilancio parsing avanzato.');
        console.log('\n     👉 RACCOMANDAZIONE: Lancia il batch in modalità FREE-ONLY.');
        console.log('        Mentre gira, sistema le API key una alla volta.');
    } else if (freeWorking.length >= 2 && paidWorking.length >= 1) {
        console.log('\n  🟢 OPERATIVO: Hai abbastanza provider per un batch completo.');
        console.log(`     Free: ${freeWorking.map(r => r.name).join(', ')}`);
        console.log(`     Paid: ${paidWorking.map(r => r.name).join(', ')}`);
    }

    if (broken.length > 0) {
        console.log('\n  ❌ PROVIDER DA SISTEMARE:');
        for (const b of broken) {
            console.log(`     ${b.name}: ${b.detail}`);
        }
    }

    // Genera comando per fixare il .env
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  FASE 3: COMANDI PER FIXARE');
    console.log('═══════════════════════════════════════════════════════\n');

    for (const b of broken) {
        const envKey = providers.find(p => p.name === b.name)?.envKey;
        if (envKey && envKey !== '(none)') {
            console.log(`  # Fix ${b.name}:`);
            console.log(`  # 1. Vai su dashboard del provider e copia la key`);
            console.log(`  # 2. Esegui (SENZA virgolette attorno al valore):`);
            console.log(`  nano .env  # poi modifica la riga ${envKey}=<incolla_key_qui>`);
            console.log('');
        }
    }
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   OMEGA ENGINE v6 — PROVIDER DIAGNOSTIC SUITE        ║');
    console.log('║   Testa OGNI provider prima di lanciare il batch      ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    // Fase 0: Validazione formato .env (senza rete)
    const envIssues = validateEnvKeys();

    // Fase 1: Test live di ogni provider
    const results = await runProviderTests();

    // Fase 2: Valutazione strategica
    strategicAssessment(results);

    // Exit code per CI/CD
    const allCriticalOk = results.filter(r => r.tier <= 1).some(r => r.ok);
    process.exit(allCriticalOk ? 0 : 1);
}

main().catch(console.error);
