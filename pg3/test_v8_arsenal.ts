/**
 * 🏴‍☠️ OMEGA V8 ARSENAL TEST
 * Tests ogni Provider individualmente per verificare il fallback chain:
 *   DNS-MX (Tier 0) → CrtSH (Tier 0) → Google/Tor (Tier 1) → Free Aggregator (Tier 3)
 * 
 * USAGE: npx ts-node test_v8_arsenal.ts
 */
import 'dotenv/config';
import { MxDiscoveryProvider } from './src/enricher/core/discovery/mx_discovery_provider';
import { CrtShProvider } from './src/enricher/core/discovery/crtsh_provider';
import { SearXNGProvider } from './src/enricher/core/discovery/searxng_provider';

const TEST_COMPANY_EMAIL = 'info@ferraricaffemilano.it';
const TEST_COMPANY_NAME = 'ferrari caffe milano';
const TEST_PIVA_QUERY = '"IT02012345678" sito web officiale';

async function runTest(
    name: string,
    fn: () => Promise<any[]>
): Promise<void> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 LAYER: ${name}`);
    console.log(`${'─'.repeat(60)}`);
    try {
        const results = await fn();
        if (results.length === 0) {
            console.log(`⚠️  EMPTY — provider alive but returned 0 results.`);
        } else {
            console.log(`✅ ${results.length} result(s) found:`);
            results.slice(0, 3).forEach((r, i) =>
                console.log(`   [${i + 1}] ${r.url} — "${r.title?.slice(0, 55)}..."`)
            );
        }
    } catch (e: any) {
        console.log(`❌ ERROR: ${e.message}`);
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║      OMEGA V8 — FULL ARSENAL LAYER VALIDATION        ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    // ── TIER 0: DNS MX Mining
    await runTest('[T0] DNS-MX-MINING-0 (email domain extraction)', async () => {
        const p = new MxDiscoveryProvider();
        return p.search(TEST_COMPANY_EMAIL);
    });

    // ── TIER 0: CrtSH Certificate Transparency
    await runTest('[T0] CRTSH-API-1 (certificate logs)', async () => {
        const p = new CrtShProvider();
        return p.search(TEST_COMPANY_NAME);
    });

    // ── TIER 1: Google via TorBrowser (SearXNG Provider, now repurposed)
    await runTest('[T1] SEARXNG-NET-1 (Google via Tor headless)', async () => {
        const p = new SearXNGProvider();
        return p.search(TEST_COMPANY_NAME + ' sito web', 5);
    });

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║ NOTE: DDG/Brave/Bing tested in main pipeline run.   ║');
    console.log('║ FREE-AGGR-PROXY-3 requires SCRAPERAPI_FREE_KEYS env. ║');
    console.log('╚══════════════════════════════════════════════════════╝');

    process.exit(0);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
