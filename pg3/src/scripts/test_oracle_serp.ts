import { OracleSearchProvider } from '../enricher/core/discovery/oracle_search_provider';
import { Logger } from '../enricher/utils/logger';
import { OracleClient } from '../enricher/utils/oracle_client';
import * as fs from 'fs';

async function testOracleSerp() {
    console.log("🚀 INIZIO TEST OMEGA V9: PYTHON ORACLE SERP BYPASS (Crawl4AI) 🚀\n");

    const provider = new OracleSearchProvider();
    
    // Unità di test difficile che in genere attiva i captchas dopo alcune query
    const targetQuery = '"Pizzeria da Michele Napoli" sito web';

    console.log(`\n======================================================`);
    console.log(`🎯 Testando Query: ${targetQuery}`);
    console.log(`======================================================`);

    try {
        console.log(`[TEST] Invocando Python Oracle (magic=True) per estrarre la SERP in Stealth...`);
        console.time('OracleSerpFetch');

        const results = await provider.search(targetQuery);

        console.timeEnd('OracleSerpFetch');

        // Fetch raw HTML separately to debug
        const rawRes = await OracleClient.fetchHtmlStealth(`https://www.google.com/search?q=${encodeURIComponent(targetQuery)}&hl=it&gl=IT`, 60000);
        fs.writeFileSync('/tmp/google_oracle_debug.html', rawRes.html);

        if (results && results.length > 0) {
            console.log(`✅ SUCCESSO! L'Oracle ha bucato Google e bypassato il JS.`);
            console.log(`📊 Risultati estratti: ${results.length}`);

            results.forEach((res, i) => {
                console.log(`   [${i + 1}] ${res.title}`);
                console.log(`       URL: ${res.url}`);
            });
        } else {
            console.log(`❌ FALLIMENTO. Nessun risultato utile estratto. Forse il selettore DOM è cambiato o il bypass è fallito.`);
        }

    } catch (error: any) {
        console.log(`🚨 ERRORE LOGICO/SISTEMA.`);
        if (error.message === 'PYTHON_ORACLE_OFFLINE') {
            console.log(`⚠️ Il server Python non è acceso!`);
            console.log(`Lancia: cd ops/oracle && source venv/bin/activate && python3 server.py`);
        } else {
            console.log(`Errore sconosciuto: ${error.message} \n ${error.stack}`);
        }
    }

    console.log("\n🏁 Test completato.");
}

testOracleSerp().catch(console.error);
