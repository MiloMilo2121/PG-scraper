import * as fs from 'fs';
import * as path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { ProxyAgent, fetch } from 'undici';
import * as cheerio from 'cheerio';

const OUTPUT_DIR = path.join(__dirname, '../../output/campaigns');
const EXCLUDED_BRANDS = [
    'remax', 're/max', 'tecnocasa', 'gabetti', 'tempocasa', 'professionecasa',
    'toscano', 'engel & volkers', 'engel & völkers', 'solo affitti', 'kiron', 'pirelli re'
];

const BLACKLIST_DOMAINS = [
    'immobiliare.it', 'idealista.it', 'casa.it', 'paginegialle.it', 'facebook.com',
    'instagram.com', 'linkedin.com', 'google.com', 'infoimprese.it', 'registroimprese.it',
    'trustpilot.com', 'wikipedia.org', 'tripadvisor.it', 'tuttocitta.it', 'prontoimprese.it',
    'infobel.com', 'icitta.it', 'paginebianche.it', 'cylex.it', 'misterimprese.it',
    'virgilio.it', 'reteimprese.it', 'impresaitalia.info', 'pgcasa.it', 'pg.it'
];

class IPRoyalDDGProvider {
    async search(query: string) {
        const proxyUrl = process.env.PROXY_RESIDENTIAL_URL || 'http://vfHrjaXd8Cn6x0h1:ZwNw3AK4mhv2hHPq@geo.iproyal.com:12321';
        const dispatcher = new ProxyAgent({
            uri: proxyUrl,
            connect: { rejectUnauthorized: false }
        });

        const rng = Math.random().toString(36).substring(7);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&_t=${Date.now()}_${rng}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            dispatcher
        });

        const html = await response.text();

        if (html.includes('bots use duckduckgo too') || html.includes('403 Forbidden')) {
            throw new Error('BLOCK');
        }

        const results: any[] = [];
        const $ = cheerio.load(html);
        $('.result__body').each((_, el) => {
            const link = $(el).find('.result__url').attr('href');
            let realUrl = link;
            if (link && link.includes('uddg=')) {
                realUrl = decodeURIComponent(link.split('uddg=')[1].split('&')[0]);
            }
            const title = $(el).find('.result__title').text().trim();
            if (realUrl && realUrl.startsWith('http')) {
                results.push({ url: realUrl, title });
            }
        });

        return results;
    }
}

function findLatestNoWebsiteCsv(): string | null {
    if (!fs.existsSync(OUTPUT_DIR)) return null;
    const files = fs.readdirSync(OUTPUT_DIR);
    const targetFiles = files
        .filter(f => f.startsWith('campaign_COMBINED_') && f.endsWith('_TIERED_NO_WEBSITE.csv'))
        .sort((a, b) => {
            const timeA = fs.statSync(path.join(OUTPUT_DIR, a)).mtimeMs;
            const timeB = fs.statSync(path.join(OUTPUT_DIR, b)).mtimeMs;
            return timeB - timeA;
        });
    return targetFiles.length > 0 ? path.join(OUTPUT_DIR, targetFiles[0]) : null;
}

function isFranchising(name: string): boolean {
    const lowerName = name.toLowerCase();
    return EXCLUDED_BRANDS.some(brand => lowerName.includes(brand));
}

function isValidDomain(url: string): boolean {
    if (!url) return false;
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return !BLACKLIST_DOMAINS.some(b => hostname.includes(b));
    } catch {
        return false;
    }
}

async function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('🚀 AVVIO DOMAIN DISCOVERY (NO-WEBSITE RECOVERY)');
    const targetFile = findLatestNoWebsiteCsv();

    if (!targetFile) {
        console.error('❌ Nessun file _NO_WEBSITE.csv trovato!');
        process.exit(1);
    }

    console.log(`📄 Caricamento file: ${path.basename(targetFile)}`);
    const content = fs.readFileSync(targetFile, 'utf-8');
    const rows: any[] = parseCsv(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
    });

    console.log(`🔍 Record totali senza sito: ${rows.length}`);

    // Filtriamo via i franchising
    const eligibleRows = rows.filter(row => !isFranchising(row.company_name || ''));
    console.log(`🧹 Dopo filtro Franchising rimangono: ${eligibleRows.length} agenzie da cercare.`);

    const provider = new IPRoyalDDGProvider(); // Usiamo proxy residenziali IPRoyal
    const recoveredRows: any[] = [];
    const failedRows: any[] = [];

    const outPath = targetFile.replace('_NO_WEBSITE.csv', '_RECOVERED.csv');
    const headers = Object.keys(rows[0]).map(k => ({ id: k, title: k }));
    // Aggiungiamo anche lo status se serve
    headers.push({ id: 'discovery_status', title: 'discovery_status' });

    const csvWriter = createObjectCsvWriter({
        path: outPath,
        header: headers,
        append: false // Sovrascriviamo all'avvio
    });

    console.log(`💾 Scriverò i risultati man mano su: ${path.basename(outPath)}`);

    let recoveredCount = 0;

    // Per loggare e non riempire la console
    let checkInterval = setInterval(() => {
        console.log(`⏳ Status: Processate ${recoveredRows.length + failedRows.length}/${eligibleRows.length}. Recuperate: ${recoveredCount}`);
    }, 15000);

    for (let i = 0; i < eligibleRows.length; i++) {
        const row = eligibleRows[i];
        const query = `"${row.company_name}" ${row.city || ''} agenzia immobiliare sito web`;

        try {
            // Aggiungo jitter delay per non essere bloccati da DDG
            await delay(3000 + Math.random() * 3000);
            const results = await provider.search(query);

            // Cerco il primo risultato che non è blacklistato
            const validResult = results.find(r => isValidDomain(r.url));

            if (validResult) {
                row.website = validResult.url;
                row.discovery_status = 'RECOVERED';
                recoveredCount++;
                recoveredRows.push(row);
                console.log(`   ✅ [${i + 1}/${eligibleRows.length}] ${row.company_name} -> ${row.website}`);
            } else {
                row.discovery_status = 'NOT_FOUND';
                failedRows.push(row);
                // console.log(`   ❌ [${i+1}/${eligibleRows.length}] ${row.company_name} -> Nessun sito trovato`);
            }

            // Salva ogni 10 record
            if ((i + 1) % 10 === 0 || i === eligibleRows.length - 1) {
                // Riscrive tutto il file (non efficientissimo ma sicuro in caso di crash se usassimo append, o meglio qui facciamo l'append di quelli nuovi)
            }
            // Scriviamo riga per riga
            await createObjectCsvWriter({ path: outPath, header: headers, append: fs.existsSync(outPath) }).writeRecords([row]);

        } catch (error: any) {
            console.error(`   ⚠️ Errore su ${row.company_name}: ${error.message}`);
            // Se blocca, fermiamo un po'
            if (error.message.includes('BLOCK')) {
                console.log('🛑 BLOCCO DDG DETECTED. Pausa di 30 secondi...');
                await delay(30000);
                i--; // Riprova questo record
            } else {
                row.discovery_status = 'ERROR';
                failedRows.push(row);
                await createObjectCsvWriter({ path: outPath, header: headers, append: fs.existsSync(outPath) }).writeRecords([row]);
            }
        }
    }

    clearInterval(checkInterval);

    console.log(`\n🎉 DISCOVERY COMPLETATA!`);
    console.log(`   Totale eligibili: ${eligibleRows.length}`);
    console.log(`   Recuperate con successo: ${recoveredCount}`);
    console.log(`   Non trovate/Errori: ${failedRows.length}`);
    console.log(`💾 File salvato: ${path.basename(outPath)}`);
}

main().catch(console.error);
