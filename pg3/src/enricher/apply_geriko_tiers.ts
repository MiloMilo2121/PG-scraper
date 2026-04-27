import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { GerikoScorer } from './utils/geriko_scorer';

const OUTPUT_DIR = path.join(__dirname, '../../output/campaigns');

function findLatestCombinedCsv(): string | null {
    if (!fs.existsSync(OUTPUT_DIR)) return null;
    const files = fs.readdirSync(OUTPUT_DIR);
    const combinedFiles = files
        .filter(f => f.startsWith('campaign_COMBINED_') && f.endsWith('.csv') && !f.includes('_TIERED'))
        .sort((a, b) => {
            const timeA = fs.statSync(path.join(OUTPUT_DIR, a)).mtimeMs;
            const timeB = fs.statSync(path.join(OUTPUT_DIR, b)).mtimeMs;
            return timeB - timeA; // Discendente
        });
    return combinedFiles.length > 0 ? path.join(OUTPUT_DIR, combinedFiles[0]) : null;
}

async function main() {
    console.log('🎯 GERIKO TIER APPLICATOR');
    
    // Possiamo passare il file via CLI, altrimenti prende l'ultimo
    let targetFile = process.argv[2];
    if (!targetFile) {
        targetFile = findLatestCombinedCsv() || '';
    }

    if (!targetFile || !fs.existsSync(targetFile)) {
        console.error(`❌ CSV non trovato. Genera prima la campagna.`);
        process.exit(1);
    }

    console.log(`📄 Caricamento file: ${path.basename(targetFile)}`);
    const content = fs.readFileSync(targetFile, 'utf-8');
    const rows = parseCsv(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
    });

    console.log(`🔍 Trovate ${rows.length} agenzie. Applicazione scoring...`);

    const tieredRows = rows.map((row: any) => {
        // Mappiamo i dati CSV nel formato atteso da GerikoScorer
        const lead = {
            company_name: row.company_name || '',
            website: row.website || '',
            address: row.address || '',
            phone: row.phone || '',
            websiteContent: '' // Non ancora estratto, lo scoring si baserà sul nome
        };

        const score = GerikoScorer.score(lead as any);
        
        let tierLabel: string = score.category;
        if (tierLabel === 'ANTI_TARGET') tierLabel = 'TIER_D';
        else if (tierLabel === 'SEGMENTO_B') tierLabel = 'TIER_B';
        else if (tierLabel === 'SEGMENTO_C') tierLabel = 'TIER_C';
        else if (tierLabel === 'SEGMENTO_A') tierLabel = 'TIER_A';

        return {
            ...row,
            geriko_tier: tierLabel,
            score_total: score.total,
            score_negatives: score.gerikoComponents.negativeSignals
        };
    });

    // Ordiniamo per Tier
    const tierPriority = { 'TIER_A': 1, 'TIER_C': 2, 'TIER_B': 3, 'TIER_D': 4 };
    tieredRows.sort((a: any, b: any) => {
        const pA = tierPriority[a.geriko_tier as keyof typeof tierPriority] || 99;
        const pB = tierPriority[b.geriko_tier as keyof typeof tierPriority] || 99;
        if (pA !== pB) return pA - pB;
        return b.score_total - a.score_total; // Ordine decrescente di score all'interno dello stesso tier
    });

    const outPath = targetFile.replace('.csv', '_TIERED.csv');
    const headers = Object.keys(tieredRows[0]).map(k => ({ id: k, title: k }));

    const writer = createObjectCsvWriter({
        path: outPath,
        header: headers
    });

    await writer.writeRecords(tieredRows);

    console.log(`\n✅ Elaborazione completata!`);
    console.log(`💾 File salvato in: ${path.basename(outPath)}`);

    // Statistiche
    const counts: Record<string, number> = {};
    for (const r of tieredRows) {
        counts[r.geriko_tier] = (counts[r.geriko_tier] || 0) + 1;
    }

    console.log('\n📊 Statistiche TIER:');
    console.log(`   🏆 TIER A (Prime): ${counts['TIER_A'] || 0}`);
    console.log(`   📈 TIER C (Buone): ${counts['TIER_C'] || 0}`);
    console.log(`   ⚖️ TIER B (Solo Affitti / Bassa priorità): ${counts['TIER_B'] || 0}`);
    console.log(`   🚫 TIER D (Grandi Franchising/Aste): ${counts['TIER_D'] || 0}`);
}

main().catch(console.error);
