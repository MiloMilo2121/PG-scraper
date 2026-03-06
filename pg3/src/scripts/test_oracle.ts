import { OracleClient } from '../enricher/utils/oracle_client';
import { Logger } from '../enricher/utils/logger';

async function runTest() {
    console.log("🚀 INIZIO TEST OMEGA V9: PYTHON ORACLE (Crawl4AI) 🚀\n");

    // Un sito notoriamente protetto da Cloudflare Turnstile o DataDome
    const hardTargets = [
        'https://reportaziende.it/', // Storicamente protetto da Cloudflare massiccio
        'https://www.registroimprese.it/' // Target istituzionale
    ];

    for (const target of hardTargets) {
        console.log(`\n======================================================`);
        console.log(`🎯 Testando Target: ${target}`);
        console.log(`======================================================`);

        try {
            console.log(`[TEST] Invocando Python Oracle su porta 8000 per bypass Javascript...`);
            console.time('OracleFetch');

            const result = await OracleClient.fetchHtmlStealth(target, 45000); // 45 sec timeout per permettere al mouse AI di muoversi

            console.timeEnd('OracleFetch');

            if (result.success) {
                console.log(`✅ SUCCESSO! L'Oracle ha bucato le difese.`);
                console.log(`📊 Lunghezza HTML estratto: ${result.html.length} caratteri`);

                // Mostra un pezzettino di HTML per provare che non è la pagina del Captcha
                const snippet = result.html.substring(0, 300).replace(/\s+/g, ' ');
                console.log(`\n📄 Snippet HTML:\n${snippet}...\n`);
            } else {
                console.log(`❌ FALLIMENTO. L'Oracle ha restituito un errore controllato.`);
                console.log(`Causa: ${result.error}`);
            }

        } catch (error: any) {
            console.log(`🚨 ERRORE CRITICO DI SISTEMA.`);
            if (error.message === 'PYTHON_ORACLE_OFFLINE') {
                console.log(`⚠️ Il server Python non è acceso!`);
                console.log(`Devi prima lanciare: cd ops/oracle && source venv/bin/activate && python3 server.py`);
            } else {
                console.log(`Errore sconosciuto: ${error.message}`);
            }
        }
    }

    console.log("\n🏁 Test completato.");
}

runTest().catch(console.error);
