import { UnifiedDiscoveryService, DiscoveryMode } from '../enricher/core/discovery/unified_discovery_service';

async function run() {
    const name = process.argv[2] || "Autofficina Coffani di Coffani Massimiliano & Alberto SNC";
    const city = process.argv[3] || "Brescia";
    const province = process.argv[4] || "BS";

    console.log(`\n===========================================`);
    console.log(`💣 OMEGA V6.3 - HYPERGUESSER VX ONLY TEST 💣`);
    console.log(`===========================================`);
    console.log(`Azienda:  ${name}`);
    console.log(`Città:    ${city}`);
    console.log(`Prov.:    ${province}`);
    console.log(`===========================================\n`);

    const service = new UnifiedDiscoveryService();
    const startTime = Date.now();

    const result = await service.discover({
        id: 'test_vx_1',
        company_name: name,
        city: city,
        province: province
    }, DiscoveryMode.HYPERGUESSER_VX_ONLY);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n⏱️  Tempo totale: ${duration} secondi\n`);
    console.log("📊 RISULTATO FINALE:");

    if (result.status === 'FOUND_VALID') {
        console.log(`✅ SITO TROVATO: ${result.url}`);
        console.log(`🎯 Confidence:  ${result.confidence}`);
        console.log(`🧠 AI Reason:   ${result.details?.reasons?.[0]}`);
    } else {
        console.log(`❌ SITO NON TROVATO (Status: ${result.status})`);
        console.log(`⚠️ Reason: ${result.details?.error || result.reason_code}`);
    }
}

run().catch(console.error);
