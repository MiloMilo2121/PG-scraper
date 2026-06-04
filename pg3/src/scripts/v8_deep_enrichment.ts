import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import pLimit from 'p-limit';
import { createOmegaRuntime } from '../enricher/runtime/runtime_composition';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';
import { EmailPermutator } from '../enricher/utils/email_permutator';
import { OpportunisticExtractor } from '../foundation/OpportunisticExtractor';
import { PecHunter } from '../foundation/PecHunter';
import { LinkedInSniper } from '../foundation/LinkedInSniper';
import { HunterClient } from '../enricher/utils/hunter_client';

const OUTPUT_HEADERS = [
    'company_name',
    'city',
    'address',
    'website',
    'email',
    'email_type',
    'pec',
    'contact_source',
    'dm_name',
    'dm_role',
    'dm_linkedin',
    'dm_confidence',
    'employees',
    'category',
    'source'
];

function isRealWebsite(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('wa.me')) return false;
    if (lower.includes('facebook.com')) return false;
    if (lower.includes('instagram.com')) return false;
    if (lower.includes('linkedin.com')) return false;
    return true;
}

async function main() {
    console.log('🚀 OMEGA V8 — DEEP ENRICHMENT PHASE 🚀\n');

    const INPUT_FILE = path.join(process.cwd(), 'output/campaigns/ENRICHMENT_QUEUE.csv');
    const OUTPUT_FILE = path.join(process.cwd(), 'output/campaigns', `MASTER_ENRICHED_V8_ACTIVE.csv`);

    if (!fs.existsSync(INPUT_FILE)) {
        console.error('❌ Enrichment queue not found! Run prepare_enrichment_queue.ts first.');
        process.exit(1);
    }

    // Init
    initializeRuntimeEnvironment();
    const config = initializeRuntimeConfig();
    const runtime = await createOmegaRuntime();
    const { pool, router } = runtime;
    const pecHunter = new PecHunter(pool, router);
    const linkedinSniper = new LinkedInSniper(router);
    const hunterClient = config.hunter.apiKey ? new HunterClient(config.hunter.apiKey) : undefined;

    const fileContent = fs.readFileSync(INPUT_FILE, 'utf8');
    const records = parse(fileContent, { columns: true, skip_empty_lines: true });

    // Load existing results for resuming
    const existingResults: Map<string, any> = new Map();
    if (fs.existsSync(OUTPUT_FILE)) {
        const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const existingRecords = parse(existingContent, { columns: true, skip_empty_lines: true });
        for (const r of existingRecords) {
            if (r.website) existingResults.set(r.website.toLowerCase(), r);
        }
        console.log(`🔄 Found ${existingResults.size} existing results. Resuming...`);
    }

    // Filter
    const queue = records.filter((r: any) => {
        const site = r.website?.toLowerCase();
        return isRealWebsite(site) && !existingResults.has(site);
    });
    
    console.log(`📊 Loaded ${records.length} total records. Remaining to process: ${queue.length}.`);

    const CONCURRENCY = 15;
    const limit = pLimit(CONCURRENCY);
    const results: any[] = Array.from(existingResults.values());
    let processed = 0;
    let enrichedCount = results.filter(r => r.email || r.dm_name).length;

    const saveResults = () => {
        const csv = stringify(results, { 
            header: true,
            columns: OUTPUT_HEADERS
        });
        fs.writeFileSync(OUTPUT_FILE, csv);
        console.log(`\n💾 Checkpoint saved: ${OUTPUT_FILE} (${results.length} records)`);
    };

    const tasks = queue.map((record: any, index: number) => limit(async () => {
        const companyId = `enr-${index}`;
        const companyName = record.company_name;
        const website = record.website;

        console.log(`\n🔍 [${index + 1}/${queue.length}] Enriching: ${companyName}...`);

        const enrichment: any = { 
            ...record,
            email: '',
            email_type: '',
            pec: '',
            contact_source: '',
            dm_name: '',
            dm_role: '',
            dm_linkedin: '',
            dm_confidence: '',
            employees: ''
        };

        try {
            // Stage 1: Website Contact Mining
            const contacts = await pecHunter.hunt(companyId, record, website);
            enrichment.email = contacts.email || '';
            enrichment.pec = contacts.pec || '';
            enrichment.employees = contacts.employees || '';
            enrichment.contact_source = contacts.source || '';

            // Stage 2: Decision Maker Snipe
            const dmResult = await linkedinSniper.snipeDetailed(companyId, record, website);
            if (dmResult.decisionMaker) {
                enrichment.dm_name = dmResult.decisionMaker.name || '';
                enrichment.dm_role = dmResult.decisionMaker.role || '';
                enrichment.dm_linkedin = dmResult.decisionMaker.linkedin_url || '';
                enrichment.dm_confidence = dmResult.decisionMaker.confidence || '';
            }

            // Stage 3: Professional Email Discovery (Hunter.io)
            if (!enrichment.email && website && hunterClient) {
                const domain = HunterClient.extractDomain(website);
                if (domain) {
                    const hunterData = await hunterClient.domainSearch(domain, 5);
                    if (hunterData && hunterData.emails.length > 0) {
                        const best = HunterClient.pickBestEmails(hunterData.emails, 2);
                        if (best.values.length > 0) {
                            enrichment.email = best.values[0];
                            enrichment.email_type = best.isPersonal ? 'hunter_personal' : 'hunter_generic';
                            enrichment.contact_source = 'hunter.io';
                            enrichment.dm_confidence = HunterClient.normalizeConfidence(best.confidence).toString();
                        }
                    }
                }
            }

            // Fallback Stage 3.1: Email Inference (only if Hunter fails and we have a DM)
            if (!enrichment.email && enrichment.dm_name) {
                const names = enrichment.dm_name.split(' ');
                if (names.length >= 2) {
                    const first = names[0];
                    const last = names[names.length - 1];
                    try {
                        const domain = new URL(website).hostname.replace(/^www\./, '');
                        const permutations = await EmailPermutator.findEmails(first, last, domain, false);
                        if (permutations.length > 0) {
                            enrichment.email = permutations[0].email;
                            enrichment.email_type = 'inferred_personal';
                        }
                    } catch (urlErr) { /* ignore */ }
                }
            }

            if (enrichment.email && !enrichment.email_type) {
                enrichment.email_type = enrichment.email.includes('pec') || enrichment.email.includes('legalmail') ? 'pec' : 'generic';
            }

            // Stage 4: Opportunistic Extraction (Already handled in PecHunter Stage 1)

            if (enrichment.email || enrichment.dm_name) enrichedCount++;
            console.log(`   ✅ Done: ${enrichment.email || 'No Email'} | ${enrichment.dm_name || 'No DM'}`);

        } catch (e: any) {
            console.error(`   ⚠️ Error enriching ${companyName}: ${e.message}`);
        } finally {
            results.push(enrichment);
            processed++;
            if (processed % 5 === 0) saveResults();
        }
    }));

    await Promise.all(tasks);
    saveResults();

    console.log(`\n🏆 ENRICHMENT COMPLETE`);
    console.log(`📊 Total Processed: ${processed}`);
    console.log(`✨ Enriched (Email or DM): ${enrichedCount}`);
    
    await runtime.cleanup();
    process.exit(0);
}

main().catch(console.error);
