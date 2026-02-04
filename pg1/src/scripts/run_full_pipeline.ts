import * as fs from 'fs';
import * as csv from 'fast-csv';
import { RecoveryManager } from '../modules/recovery/recovery-manager';
import { Pipeline } from '../pipeline';
import * as path from 'path';

const FILES = {
    INPUT: '', // Set from args
    TEMP_OUTPUT: 'temp_phase1_output.csv',
    FINAL_OUTPUT: 'output_master.csv'
};

interface CompanyData {
    company_name: string;
    city: string;
    address: string;
    phone: string;
    industry: string;
    status: string;
    search_date: string;
    [key: string]: any;
}

// deduplicate input helper
async function deduplicateInput(inputPath: string, outputPath: string): Promise<number> {
    const unique = new Map<string, any>();

    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(inputPath)
            .pipe(csv.parse({ headers: true }))
            .on('data', (row) => {
                // Key by Name + City to avoid merging different branches
                const key = `${row.company_name.toLowerCase()}|${row.city.toLowerCase()}`;
                if (!unique.has(key)) {
                    unique.set(key, row);
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });

    const ws = fs.createWriteStream(outputPath);
    const csvStream = csv.format({ headers: true });
    csvStream.pipe(ws);

    for (const row of unique.values()) {
        csvStream.write(row);
    }
    csvStream.end();

    await new Promise((resolve) => ws.on('finish', resolve));
    return unique.size;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: npx ts-node src/scripts/run_full_pipeline.ts <input_csv>');
        process.exit(1);
    }

    FILES.INPUT = args[0];
    const DEDUPED_INPUT = 'temp_deduped_input.csv';

    console.log('🚀 Starting Ultimate Crawler Pipeline...');

    // 0. Deduplicate
    console.log('\n[Phase 0] Deduplicating Input...');
    const count = await deduplicateInput(FILES.INPUT, DEDUPED_INPUT);
    console.log(`Input reduced to ${count} unique companies.`);

    // 1. Standard Search
    console.log('\n[Phase 1] Running Standard Search (Fast + AI Verify)...');
    try {
        // Run Pipeline directly (in-process) to avoid zombie processes and buffer overflows
        await Pipeline.run(DEDUPED_INPUT, FILES.TEMP_OUTPUT);
    } catch (e) {
        console.error('Phase 1 failed.', e);
        process.exit(1);
    }

    // Load Phase 1 Results
    const companies = new Map<string, CompanyData>();
    await new Promise<void>((resolve) => {
        fs.createReadStream(FILES.TEMP_OUTPUT)
            .pipe(csv.parse({ headers: true }))
            .on('data', (row: CompanyData) => {
                row.search_date = new Date().toISOString().split('T')[0];
                companies.set(row.company_name, row); // Key by name (deduped already) is fine-ish, but dangerous if names not unique. 
                // But Phase 0 deduped by name+city. Here row comes from Phase 1 output.
                // We should use same key strategy? 
                // Phase 1 output preserves company_name. 
                // Let's assume company_name is unique enough after dedupe or key by Name+City.
                // Using Name+City key:
                const key = `${row.company_name.toLowerCase()}|${row.city.toLowerCase()}`;
                companies.set(key, row);
            })
            .on('end', resolve);
    });

    // Initialize Recovery Manager
    const recovery = new RecoveryManager();
    await recovery.init();

    // 2. Recovery Phases
    const missing = Array.from(companies.values()).filter(c => c.status === 'NO_DOMAIN_FOUND');
    console.log(`\nStarting Recovery for ${missing.length} missing companies...`);

    let recovered = 0;

    for (const company of missing) {
        let saved = false;

        // Phase 2: AI Direct
        if (!saved) {
            process.stdout.write(`[${company.company_name}] AI Direct... `);
            if (await recovery.phaseAiDirect(company)) {
                console.log('✅ RECOVERED');
                saved = true;
            } else {
                console.log('❌');
            }
        }

        // Phase 3: Deep Search
        if (!saved) {
            process.stdout.write(`[${company.company_name}] Deep Search... `);
            if (await recovery.phaseDeepSearch(company)) {
                console.log('✅ RECOVERED');
                saved = true;
            } else {
                console.log('❌');
            }
        }

        // Phase 4: Sherlock Mode
        if (!saved) {
            process.stdout.write(`[${company.company_name}] Sherlock Mode... `);
            if (await recovery.phaseSherlock(company)) {
                console.log('✅ RECOVERED');
                saved = true;
            } else {
                console.log('❌');
            }
        }

        // Phase 5: Reason Analysis
        if (!saved) {
            process.stdout.write(`[${company.company_name}] Final Analysis... `);
            await recovery.phaseFinalAnalysis(company);
            console.log(`Done (${company.decision_reason})`);
        }

        if (saved) recovered++;
    }

    await recovery.close();

    // 3. Write Master Output
    console.log(`\n💾 Writing Master File: ${FILES.FINAL_OUTPUT}`);
    const ws = fs.createWriteStream(FILES.FINAL_OUTPUT);

    // Convert Map values to array
    const sortedCompanies = Array.from(companies.values());

    // Get headers
    const headers = new Set<string>(['company_name', 'status', 'site_url_official', 'decision_reason', 'search_date', 'confidence']);
    // Add rest
    if (sortedCompanies.length > 0) Object.keys(sortedCompanies[0]).forEach(k => headers.add(k));

    const csvStream = csv.format({ headers: Array.from(headers) });
    csvStream.pipe(ws);
    sortedCompanies.forEach(c => csvStream.write(c));
    csvStream.end();

    await new Promise((resolve) => ws.on('finish', resolve));

    // 4. Cleanup
    console.log('\n🧹 Cleaning up...');
    try {
        if (fs.existsSync(DEDUPED_INPUT)) fs.unlinkSync(DEDUPED_INPUT);
        if (fs.existsSync(FILES.TEMP_OUTPUT)) fs.unlinkSync(FILES.TEMP_OUTPUT);
        if (fs.existsSync('temp_pass1_done.csv')) fs.unlinkSync('temp_pass1_done.csv');
        // Delete other intermediate files if any
    } catch (e) { }

    console.log(`\n✨ Ultimate Pipeline Complete ✨`);
    console.log(`Total Unique: ${count}`);
    console.log(`Recovered in phases 2-5: ${recovered}`);
    console.log(`File: ${FILES.FINAL_OUTPUT}`);
}

main().catch(console.error);
