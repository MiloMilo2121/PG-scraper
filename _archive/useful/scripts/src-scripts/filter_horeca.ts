import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const inputCsv = process.argv[2];
if (!inputCsv || !fs.existsSync(inputCsv)) {
    console.error("❌ Usage: ts-node filter_horeca.ts <input_master.csv>");
    process.exit(1);
}

console.log(`🔍 Loading and parsing ${inputCsv}...`);
const fileContent = fs.readFileSync(inputCsv, 'utf8');
const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
});

console.log(`📊 Found ${records.length} total records.`);

// Keywords for Ho.Re.Ca
const horecaKeywords = [
    'ristorant',
    'trattori',
    'pizzeri',
    'osteri',
    'agriturism',
    'hotel',
    'albergh',
    'catering',
    'locanda',
    'pub '
];

const filtered = records.filter((r: any) => {
    const rawCat = (r.category || '').toLowerCase();
    // Also check company name just in case the category is missing but it's obviously a restaurant
    const rawName = (r.company_name || r.ragione_sociale || '').toLowerCase();

    return horecaKeywords.some(kw => rawCat.includes(kw) || rawName.includes(kw));
});

console.log(`🎯 Found ${filtered.length} Ho.Re.Ca / Restaurant records!`);

if (filtered.length === 0) {
    console.error("❌ No Ho.Re.Ca records found! Aborting output.");
    process.exit(1);
}

const inputBasename = path.basename(inputCsv, path.extname(inputCsv));
const outputDir = path.dirname(inputCsv);
// Create exactly the name we expect: MASTER_RISTORANTI.csv
const outputCsv = path.join(outputDir, inputBasename.replace('MASTER_CONSOLIDATED', 'MASTER_RISTORANTI') + '.csv');

const csvContent = stringify(filtered, { header: true });
fs.writeFileSync(outputCsv, csvContent, 'utf8');

console.log(`✅ Filtered CSV saved successfully: ${outputCsv}`);
process.exit(0);
