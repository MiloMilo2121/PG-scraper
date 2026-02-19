
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync'; // Synchronous parsing for simplicity in script
import { stringify } from 'csv-stringify/sync';

// Configuration
const OUTPUT_SERVER_DIR = path.resolve(process.cwd(), 'output_server/campaigns');
const OUTPUT_LOCAL_DIR = path.resolve(process.cwd(), 'output/campaigns');
const DATE_STR = new Date().toISOString().split('T')[0];
const MASTER_FILENAME = `MASTER_CONSOLIDATED_${DATE_STR}.csv`;

// Unified Schema (Target Headers)
const HEADERS = [
    'company_name',
    'vat_code',
    'website',
    'phone',
    'email',
    'address',
    'city',
    'province',
    'zip_code',
    'region',
    'country',
    'category',
    'revenue',
    'employees',
    'pec',
    'source_file',
    'confidence'
];

interface DeduplicationKey {
    type: 'VAT' | 'WEBSITE' | 'NAME_CITY';
    value: string;
}

// Stats
const stats = {
    filesProcessed: 0,
    totalRowsRead: 0,
    uniqueCompanies: 0,
    duplicatesMerged: 0,
    byVat: 0,
    byWebsite: 0,
    byNameCity: 0
};

// Normalization Helpers
const normalizeVat = (vat?: string): string | null => {
    if (!vat) return null;
    // Remove commonly seen prefixes like "IT" if present duplicatively or just spaces
    let clean = vat.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean.startsWith('IT') && clean.length > 13) {
        clean = clean.substring(2);
    }
    if (clean.length < 5) return null; // Too short to be valid
    return clean;
};

const normalizeUrl = (url?: string): string | null => {
    if (!url) return null;
    try {
        let clean = url.trim().toLowerCase();
        // Remove trailing slash
        if (clean.endsWith('/')) clean = clean.slice(0, -1);

        // Remove protocol for comparison
        clean = clean.replace(/^https?:\/\//, '');
        // Remove www.
        clean = clean.replace(/^www\./, '');

        // Valid Domain Check (basic)
        if (!clean.includes('.') || clean.length < 4) return null;

        // Blacklist Check
        const junkDomains = [
            'facebook.com',
            'linkedin.com',
            'instagram.com',
            'twitter.com',
            'paginegialle.it',
            'paginebianche.it',
            'virgilio.it',
            'kompass.com',
            'europages.co',
            'tripadvisor.it',
            'consodata.it'
        ];

        if (junkDomains.some(d => clean.includes(d))) return null;

        return clean;
    } catch {
        return null;
    }
};

const slugify = (text?: string): string => {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
};

// Key Generation Hierarchy
const getDeduplicationKeys = (record: any): DeduplicationKey[] => {
    const keys: DeduplicationKey[] = [];

    // 1. VAT (Highest trust)
    const vat = normalizeVat(record.vat_code || record.vat || record.piva || record.partita_iva);
    if (vat) {
        keys.push({ type: 'VAT', value: vat });
    }

    // 2. Website (Medium trust)
    const website = normalizeUrl(record.website || record.site || record.url || record.pg_url);
    if (website &&
        !website.includes('facebook.com') &&
        !website.includes('linkedin.com') &&
        !website.includes('paginegialle.it') &&
        !website.includes('instagram.com')) {
        keys.push({ type: 'WEBSITE', value: website });
    }

    // 3. Name + City (Fallback)
    const name = record.company_name || record.ragione_sociale || record.name;
    const city = record.city || record.citta || record.comune || record.query_location; // Fallback to query_location

    if (name && city) {
        const slug = `${slugify(name)}|${slugify(city)}`;
        if (name.length > 2 && city.length > 2) {
            keys.push({ type: 'NAME_CITY', value: slug });
        }
    }

    return keys;
};

// Data Merging Logic
const mergeRecords = (existing: any, incoming: any): any => {
    const merged = { ...existing };

    // Heuristic: Prefer longer/more complete data
    // Also specific field logic

    // Helper to pick best string
    const pickBest = (a: string, b: string): string => {
        if (!a && !b) return '';
        if (!a) return b;
        if (!b) return a;
        // If both exist, take the longer one usually implies more detail (e.g. full address vs partial)
        // detailed check for "undefined" string
        if (a === 'undefined' || a === 'null') return b;
        if (b === 'undefined' || b === 'null') return a;

        return a.length >= b.length ? a : b;
    };

    merged.company_name = pickBest(existing.company_name, incoming.company_name);
    merged.vat_code = pickBest(existing.vat_code, incoming.vat_code);

    // For website, prefer non-PG/social if possible, but our normalizeUrl handles that for keying.
    // For the record value, just take longest.
    merged.website = pickBest(existing.website, incoming.website);

    merged.phone = pickBest(existing.phone, incoming.phone);
    merged.email = pickBest(existing.email, incoming.email);
    merged.address = pickBest(existing.address, incoming.address);
    merged.city = pickBest(existing.city, incoming.city);
    merged.province = pickBest(existing.province, incoming.province);
    merged.zip_code = pickBest(existing.zip_code, incoming.zip_code);
    merged.region = pickBest(existing.region, incoming.region);
    merged.country = pickBest(existing.country, incoming.country);
    merged.category = pickBest(existing.category, incoming.category);
    merged.revenue = pickBest(existing.revenue, incoming.revenue);
    merged.employees = pickBest(existing.employees, incoming.employees);
    merged.pec = pickBest(existing.pec, incoming.pec);
    merged.confidence = pickBest(existing.confidence, incoming.confidence);

    // Merge source files list
    if (incoming.source_file && !existing.source_file.includes(incoming.source_file)) {
        merged.source_file = existing.source_file + ';' + incoming.source_file;
    } else if (!existing.source_file && incoming.source_file) {
        merged.source_file = incoming.source_file;
    }

    return merged;
};


const cleanValue = (val: any): string => {
    if (!val) return '';
    return String(val)
        .replace(/\s+/g, ' ') // Collapse multiple spaces/newlines to single space
        .trim();
};

const mapRecord = (record: any, filePath: string): any => {
    return {
        company_name: cleanValue(record.company_name || record.ragione_sociale || record.name),
        vat_code: normalizeVat(record.vat_code || record.vat || record.piva || record.partita_iva) || '',
        // Use normalizeUrl to ensure we strictly filter junk from the final output too, not just for key generation
        website: normalizeUrl(record.website || record.site || record.url || record.pg_url) || '',
        phone: cleanValue(record.phone || record.telefono || record.tel),
        email: cleanValue(record.email || record.mail),
        address: cleanValue(record.address || record.indirizzo || record.via),
        city: cleanValue(record.city || record.citta || record.comune || record.query_location),
        province: cleanValue(record.province || record.provincia || record.prov),
        zip_code: cleanValue(record.zip_code || record.cap),
        region: cleanValue(record.region || record.regione),
        country: cleanValue(record.country || record.paese || 'IT'),
        category: cleanValue(record.category || record.categoria),
        revenue: cleanValue(record.revenue || record.fatturato),
        employees: cleanValue(record.employees || record.dipendenti),
        pec: cleanValue(record.pec),
        source_file: path.basename(filePath),
        confidence: cleanValue(record.confidence)
    };
};

const main = () => {
    console.log('🚀 Starting CSV Merger Strategy...');

    // Master Storage
    // Primary Key -> Record
    // We need a way to link secondary keys to primary records to allow merging
    // Map<KeyString, RecordObject>
    // But since multiple keys point to same object, we might need an indirection?
    // Actually, we can just look up.

    // We will use a dedicated class or structure? No, let's keep it simple.
    // Map<Key, Record>
    // But if Key A points to Record 1, and Key B (from same new record) points to Record 2...
    // That means Record 1 and Record 2 are duplicates!
    // This is the classic Union-Find problem or connected components.
    // Given the scale might be large, but not HUGE (< 1M probably?), we can use a simpler approach.
    // 1. Iterate all records.
    // 2. For each record, generate ALL keys.
    // 3. Check if ANY key exists in our indices.
    // 4. If yes -> Merge into that existing record.
    // 5. If multiple existing records found -> Merge them ALL together! (Transitive property)
    // 6. If no -> Create new.

    const records: any[] = []; // Store actual record objects
    const keyIndex = new Map<string, number>(); // KeyString -> Index in records array

    const filesToProcess: string[] = [];

    // 1. Gather files
    if (fs.existsSync(OUTPUT_SERVER_DIR)) {
        const serverFiles = fs.readdirSync(OUTPUT_SERVER_DIR)
            .filter(f => f.endsWith('.csv') && !f.includes('MASTER_CONSOLIDATED'))
            .map(f => path.join(OUTPUT_SERVER_DIR, f));
        filesToProcess.push(...serverFiles);
    }

    if (fs.existsSync(OUTPUT_LOCAL_DIR)) {
        const localFiles = fs.readdirSync(OUTPUT_LOCAL_DIR)
            .filter(f => f.endsWith('.csv') && !f.includes('MASTER_CONSOLIDATED'))
            .map(f => path.join(OUTPUT_LOCAL_DIR, f));
        filesToProcess.push(...localFiles);
    }

    console.log(`Found ${filesToProcess.length} CSV files to process.`);

    for (const filePath of filesToProcess) {
        console.log(`Processing: ${path.basename(filePath)}`);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        let parsedRecords: any[] = [];
        try {
            parsedRecords = parse(fileContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true
            });
        } catch (e: any) {
            console.error(`❌ Error parsing ${path.basename(filePath)}: ${e.message}`);
            continue;
        }

        stats.filesProcessed++;
        stats.totalRowsRead += parsedRecords.length;

        for (const rawRecord of parsedRecords) {
            const incomingRecord = mapRecord(rawRecord, filePath);
            const keys = getDeduplicationKeys(incomingRecord);

            if (keys.length === 0) continue; // Skip garbage

            // Find matching existing records
            const matchingIndices = new Set<number>();
            for (const k of keys) {
                const keyStr = `${k.type}:${k.value}`;
                if (keyIndex.has(keyStr)) {
                    matchingIndices.add(keyIndex.get(keyStr)!);
                }
            }

            if (matchingIndices.size === 0) {
                // New Unique Record
                const newIndex = records.length;
                records.push(incomingRecord);

                // Index it
                for (const k of keys) {
                    const keyStr = `${k.type}:${k.value}`;
                    keyIndex.set(keyStr, newIndex);
                }
                stats.uniqueCompanies++;

                if (keys.some(k => k.type === 'VAT')) stats.byVat++;
                else if (keys.some(k => k.type === 'WEBSITE')) stats.byWebsite++;
                else stats.byNameCity++;

            } else {
                // Merge with existing(s)
                // If multiple matches, it means we found a link between previously usageparated records!
                // We must merge ALL of them + current into one.

                // Convert Set to Array
                const indices = Array.from(matchingIndices).sort((a, b) => a - b);

                // Primary is the first one found (simplest strategy to keep stability)
                const primaryIndex = indices[0];
                let primaryRecord = records[primaryIndex];

                // Merge incoming
                primaryRecord = mergeRecords(primaryRecord, incomingRecord);
                stats.duplicatesMerged++;

                // If appropriate, merge other matched records into primary
                // NOTE: This can be tricky with array indices shifting if we remove.
                // Instead, we mark others as "deleted" or just merge data into primary and point index to primary.
                // Pointing index to primary is safer.

                for (let i = 1; i < indices.length; i++) {
                    const secondaryIndex = indices[i];
                    if (secondaryIndex === primaryIndex) continue;

                    const secondaryRecord = records[secondaryIndex];
                    if (!secondaryRecord) continue; // Already merged/moved?

                    // Merge secondary into primary
                    primaryRecord = mergeRecords(primaryRecord, secondaryRecord);

                    // Mark secondary as null in records array (lazy delete)
                    records[secondaryIndex] = null;

                    // Update stats? effectively we merged two existing records.
                    stats.duplicatesMerged++;
                }

                // Update primary
                records[primaryIndex] = primaryRecord;

                // Update indices for ALL keys of the incoming record AND the secondary records...
                // Ideally we'd re-index everything.
                // For now, let's just update keys of incoming.
                for (const k of keys) {
                    const keyStr = `${k.type}:${k.value}`;
                    keyIndex.set(keyStr, primaryIndex);
                }
            }
        }
    }

    // Filter out nulls (merged records)
    const finalRecords = records.filter(r => r !== null);

    // Write Output
    console.log('💾 Writing Master CSV...');

    // Ensure output dir exists
    if (!fs.existsSync(OUTPUT_SERVER_DIR)) {
        fs.mkdirSync(OUTPUT_SERVER_DIR, { recursive: true });
    }

    const outputContent = stringify(finalRecords, { header: true, columns: HEADERS });
    const outputPath = path.join(OUTPUT_SERVER_DIR, MASTER_FILENAME);
    fs.writeFileSync(outputPath, outputContent);

    console.log('\n==========================================');
    console.log('✅ MERGE COMPLETE');
    console.log('==========================================');
    console.log(`📂 Output File:      ${outputPath}`);
    console.log(`📄 Files Processed:  ${stats.filesProcessed}`);
    console.log(`📥 Total Rows Read:  ${stats.totalRowsRead}`);
    console.log(`🏢 Unique Companies: ${finalRecords.length}`);
    console.log(`♻️  Duplicates Merged: ${stats.totalRowsRead - finalRecords.length}`); // Approx
    console.log('==========================================');
};

main();
