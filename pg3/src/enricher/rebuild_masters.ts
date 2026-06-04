/**
 * REBUILD MASTERS
 * Ricostruisce MASTER_NO_WEBSITE.csv in modo sicuro.
 * 
 * Logica:
 *   MASTER_NO_WEBSITE = archive/TIERED_NO_WEBSITE (source of truth originale)
 *                       MINUS agenzie già presenti in MASTER_WITH_WEBSITE
 * 
 * Questo garantisce zero duplicati e preserva tutti gli update manuali di Marco.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const OUTPUT_DIR = path.join(__dirname, '../../output/campaigns');
const ARCHIVE_DIR = path.join(OUTPUT_DIR, 'archive');

const ARCHIVE_NO_WEBSITE  = path.join(ARCHIVE_DIR, 'campaign_COMBINED_2026-04-27T17-26-20_TIERED_NO_WEBSITE.csv');
const MASTER_WITH_WEBSITE = path.join(OUTPUT_DIR,  'MASTER_WITH_WEBSITE.csv');
const MASTER_NO_WEBSITE   = path.join(OUTPUT_DIR,  'MASTER_NO_WEBSITE.csv');

function normalize(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function main() {
    console.log('🔧 REBUILD — MASTER_NO_WEBSITE.csv');
    console.log('');

    // 1. Leggi source of truth originale (2.923 agenzie senza sito)
    console.log(`📂 Leggo archive source: ${path.basename(ARCHIVE_NO_WEBSITE)}`);
    const archiveNoWebRaw = parse(
        fs.readFileSync(ARCHIVE_NO_WEBSITE, 'utf-8'),
        { columns: true, skip_empty_lines: true, bom: true }
    ) as any[];
    console.log(`   → ${archiveNoWebRaw.length} righe nel file originale`);

    // 2. Leggi MASTER_WITH_WEBSITE (1.699 agenzie con sito — include gli update manuali di Marco)
    console.log(`📂 Leggo MASTER_WITH_WEBSITE: ${path.basename(MASTER_WITH_WEBSITE)}`);
    const withWebRaw = parse(
        fs.readFileSync(MASTER_WITH_WEBSITE, 'utf-8'),
        { columns: true, skip_empty_lines: true, bom: true }
    ) as any[];
    console.log(`   → ${withWebRaw.length} righe con sito web`);

    // 3. Costruisce un Set di nomi già "promossi" in WITH_WEBSITE
    //    Usiamo una chiave normalizzata per evitare problemi di case/spazi/punteggiatura
    const withWebNames = new Set<string>();
    for (const row of withWebRaw) {
        withWebNames.add(normalize(row.company_name || ''));
    }
    console.log(`   → ${withWebNames.size} nomi unici nel set WITH_WEBSITE`);

    // 4. Filtra: tieni solo le agenzie che NON sono in WITH_WEBSITE
    const rebuilt: any[] = [];
    let skipped = 0;
    for (const row of archiveNoWebRaw) {
        const key = normalize(row.company_name || '');
        if (withWebNames.has(key)) {
            skipped++;
        } else {
            rebuilt.push(row);
        }
    }

    console.log('');
    console.log(`✅ Risultato ricostruzione:`);
    console.log(`   Agenzie nel source originale: ${archiveNoWebRaw.length}`);
    console.log(`   Agenzie già spostate in WITH_WEBSITE (rimosse): ${skipped}`);
    console.log(`   Agenzie che restano in NO_WEBSITE: ${rebuilt.length}`);

    // 5. Scrivi il MASTER_NO_WEBSITE pulito
    const output = stringify(rebuilt, { header: true });
    fs.writeFileSync(MASTER_NO_WEBSITE, output, 'utf-8');
    console.log('');
    console.log(`💾 Scritto: MASTER_NO_WEBSITE.csv (${rebuilt.length} righe)`);
    
    // 6. Verifica finale — rileggi e conta per sicurezza
    const verify = parse(
        fs.readFileSync(MASTER_NO_WEBSITE, 'utf-8'),
        { columns: true, skip_empty_lines: true }
    ) as any[];
    console.log(`🔍 Verifica: file riletto → ${verify.length} righe. ${verify.length === rebuilt.length ? '✅ OK' : '❌ MISMATCH!'}`);
    console.log('');
    console.log('📊 STATO FINALE:');
    console.log(`   MASTER_WITH_WEBSITE.csv : ${withWebRaw.length} agenzie`);
    console.log(`   MASTER_NO_WEBSITE.csv   : ${rebuilt.length} agenzie`);
    console.log(`   TOTALE                  : ${withWebRaw.length + rebuilt.length} agenzie`);
}

main();
