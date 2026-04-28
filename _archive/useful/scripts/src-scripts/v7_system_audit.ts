import dotenv from 'dotenv';
dotenv.config();

import { request } from 'undici';
import axios from 'axios';

async function runAudit() {
    console.log("=========================================");
    console.log("🛠️  OMEGA V7 - FULL SYSTEM & API AUDIT 🛠️");
    console.log("=========================================\n");

    let allSystemsGo = true;

    // 1. STATO VARIABILI D'AMBIENTE
    console.log("🔍 CHECK 1: ENVIRONMENT VARIABLES");
    const requiredKeys = ['SERPER_API_KEY', 'PROXY_RESIDENTIAL_URL', 'Z_AI_API_KEY'];
    for (const key of requiredKeys) {
        if (!process.env[key]) {
            console.error(`   ❌ MANCANTE: ${key}`);
            allSystemsGo = false;
        } else {
            console.log(`   ✅ PRESENTE: ${key} (${process.env[key]?.substring(0, 8)}...)`);
        }
    }
    console.log("");

    // 2. TEST SERPER.DEV (Motore di ricerca)
    console.log("🔍 CHECK 2: SERPER.DEV API");
    try {
        const res = await axios.post('https://google.serper.dev/search', {
            q: "test",
            num: 1
        }, {
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        if (res.data && res.data.organic) {
            console.log("   ✅ SERPER.DEV: Autenticazione OK. Ricerca funzionante.");
        } else {
            throw new Error("Risposta inattesa");
        }
    } catch (e: any) {
        console.error(`   ❌ SERPER.DEV FALLITO: ${e.response?.status || e.message}`);
        allSystemsGo = false;
    }
    console.log("");



    // 5. TEST DEEPSEEK API (LLM)
    console.log("🔍 CHECK 5: DEEPSEEK API");
    if (process.env.DEEPSEEK_API_KEY) {
        try {
            const res = await axios.post("https://api.deepseek.com/v1/chat/completions", {
                model: "deepseek-chat",
                messages: [{ role: "user", content: "Ping. Respondi solo 'Pong'." }],
                max_tokens: 5
            }, {
                headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
                timeout: 8000
            });
            console.log("   ✅ DEEPSEEK: Autenticazione OK. Risposta:", res.data.choices[0].message.content.trim());
        } catch (e: any) {
            console.error(`   ❌ DEEPSEEK FALLITO: ${e.response?.status} - ${e.response?.data?.error?.message || e.message}`);
            allSystemsGo = false;
        }
    } else {
        console.log("   ⚠️ DEEPSEEK: Chiave non configurata, salto.");
    }
    console.log("");

    // 6. TEST PROXY RESIDENZIALE (IPRoyal)
    console.log("🔍 CHECK 6: PROXY RESIDENZIALE (IPRoyal)");
    try {
        const proxyUrl = process.env.PROXY_RESIDENTIAL_URL;
        if (!proxyUrl) {
            console.error(`   ❌ PROXY FALLITO: URL mancante.`);
            allSystemsGo = false;
        } else {
            // Facciamo una chiamata tramite il proxy a httpbin.org/ip
            const { ProxyAgent } = require('undici');
            const agent = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
            const res = await request('https://httpbin.org/ip', { dispatcher: agent, bodyTimeout: 8000 });
            const data = await res.body.json();
            console.log(`   ✅ PROXY OK: La chiamata è uscita con un IP pulito (${(data as any).origin.split(',')[0]}).`);
        }
    } catch (e: any) {
        console.error(`   ❌ PROXY FALLITO: ${e.message}`);
        allSystemsGo = false;
    }
    console.log("");

    // RISULTATO
    console.log("=========================================");
    if (allSystemsGo) {
        console.log("🟢 AUDIT SUPERATO CON SUCCESSO! IL SISTEMA È PRONTO PER LA PRODUZIONE.");
    } else {
        console.log("🔴 AUDIT FALLITO! CI SONO ERRORI DA CORREGGERE NEL .ENV O NELLE CREDENZIALI.");
    }
}

runAudit().catch(console.error);
