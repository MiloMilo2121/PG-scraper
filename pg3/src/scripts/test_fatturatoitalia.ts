/**
 * TEST: FatturatoItaliaProvider
 * Tests both lookup modes: by VAT and by name.
 *
 * Run: npx ts-node src/scripts/test_fatturatoitalia.ts
 */
import 'dotenv/config';
import { FatturatoItaliaProvider } from '../foundation/FatturatoItaliaProvider';

async function run() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║   FatturatoItalia.it Provider — TEST SUITE     ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    // — Test 1: Lookup by VAT (most reliable) —
    console.log('📋 TEST 1: Lookup by VAT (Barilla — 01654010345)');
    console.log('─'.repeat(50));
    const byVat = await FatturatoItaliaProvider.lookupByVat('01654010345');
    if (byVat) {
        console.log('✅ SUCCESS');
        console.table({
            'Ragione Sociale': byVat.ragione_sociale,
            'P.IVA':          byVat.vat_code,
            'Fatturato':      byVat.fatturato_current?.toLocaleString('it-IT') + ' €',
            'Utile':          byVat.utile_current?.toLocaleString('it-IT') + ' €' || 'N/A',
            'Dipendenti':     byVat.dipendenti || 'N/A',
            'Anno':           byVat.bilancio_year,
            'Fonte':          byVat.source_url,
            'Confidence':     byVat.confidence.toFixed(2),
        });
        if (byVat.history?.length) {
            console.log('\n📈 5-Year History:');
            console.table(byVat.history.map(h => ({
                year: h.year,
                fatturato: h.fatturato?.toLocaleString('it-IT') ?? 'N/A',
                utile: h.utile?.toLocaleString('it-IT') ?? 'N/A',
            })));
        }
    } else {
        console.log('❌ No result found.');
    }

    console.log('\n');

    // — Test 2: Lookup by Name —
    console.log('📋 TEST 2: Lookup by Name (Ferrero, Cuneo/Alba)');
    console.log('─'.repeat(50));
    const byName = await FatturatoItaliaProvider.lookupByName('Ferrero International', {
        province: 'CN',
        city: 'Alba',
    });
    if (byName) {
        console.log('✅ SUCCESS');
        console.table({
            'Ragione Sociale': byName.ragione_sociale,
            'Fatturato':      byName.fatturato_current?.toLocaleString('it-IT') + ' €',
            'Anno':           byName.bilancio_year,
            'Confidence':     byName.confidence.toFixed(2),
        });
    } else {
        console.log('❌ No result found.');
    }

    console.log('\n');

    // — Test 3: Convenience Method (.lookup) —
    console.log('📋 TEST 3: .lookup() Convenience Method (Enel, Roma)');
    console.log('─'.repeat(50));
    const convenience = await FatturatoItaliaProvider.lookup({
        vatCode: '15844561009',
        companyName: 'Enel SpA',
        city: 'Roma',
    });
    if (convenience) {
        console.log('✅ SUCCESS');
        console.table({
            'Ragione Sociale': convenience.ragione_sociale,
            'Fatturato':      convenience.fatturato_current?.toLocaleString('it-IT') + ' €',
            'Utile':          convenience.utile_current?.toLocaleString('it-IT') + ' €' || 'N/A',
            'Anno':           convenience.bilancio_year,
            'Confidence':     convenience.confidence.toFixed(2),
        });
    } else {
        console.log('❌ No result found.');
    }

    console.log('\n✅ Test suite complete.\n');
}

run().catch(console.error);
