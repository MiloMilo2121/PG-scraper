import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';

const OUTPUT_DIR = path.join(__dirname, '../../output/campaigns');

function findLatestTieredCsv(): string | null {
    if (!fs.existsSync(OUTPUT_DIR)) return null;
    const files = fs.readdirSync(OUTPUT_DIR);
    const tieredFiles = files
        .filter(f => f.startsWith('campaign_COMBINED_') && f.endsWith('_TIERED.csv'))
        .sort((a, b) => {
            const timeA = fs.statSync(path.join(OUTPUT_DIR, a)).mtimeMs;
            const timeB = fs.statSync(path.join(OUTPUT_DIR, b)).mtimeMs;
            return timeB - timeA;
        });
    return tieredFiles.length > 0 ? path.join(OUTPUT_DIR, tieredFiles[0]) : null;
}

async function main() {
    const targetFile = findLatestTieredCsv();
    if (!targetFile) {
        console.error('❌ Nessun file TIERED trovato.');
        return;
    }

    console.log(`📄 Caricamento file: ${path.basename(targetFile)}`);
    const content = fs.readFileSync(targetFile, 'utf-8');
    const rows: any[] = parseCsv(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
    });

    const withWebsite = [];
    const withoutWebsite = [];

    for (const row of rows) {
        if (row.website && row.website.trim() !== '') {
            withWebsite.push(row);
        } else {
            withoutWebsite.push(row);
        }
    }

    console.log(`\n📊 Statistiche Split:`);
    console.log(`   🌐 Con Sito Web: ${withWebsite.length}`);
    console.log(`   📞 Senza Sito Web (solo tel/indirizzo): ${withoutWebsite.length}`);

    const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));

    const withWebsitePath = targetFile.replace('.csv', '_WITH_WEBSITE.csv');
    const withoutWebsitePath = targetFile.replace('.csv', '_NO_WEBSITE.csv');

    if (withWebsite.length > 0) {
        const writerWith = createObjectCsvWriter({ path: withWebsitePath, header: headers });
        await writerWith.writeRecords(withWebsite);
        console.log(`💾 Salvato: ${path.basename(withWebsitePath)}`);
    }

    if (withoutWebsite.length > 0) {
        const writerWithout = createObjectCsvWriter({ path: withoutWebsitePath, header: headers });
        await writerWithout.writeRecords(withoutWebsite);
        console.log(`💾 Salvato: ${path.basename(withoutWebsitePath)}`);
    }

    console.log('\n✅ Split completato con successo!');
}

main().catch(console.error);
