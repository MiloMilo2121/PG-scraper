/**
 * ICP Export Script — Video Potenziato
 * Reads enrichment_results, applies ICP heuristics, exports qualified lead list.
 */
import Database from 'better-sqlite3';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = process.env.SQLITE_PATH || './data/antigravity.db';
const OUTPUT_PATH = './output/icp_leads_video_potenziato.csv';

// Keywords that indicate premium/semi-premium positioning
const PREMIUM_KEYWORDS = [
    'laser', 'skin', 'premium', 'luxury', 'clinic', 'clinique',
    'antiage', 'anti-age', 'rimodellamento', 'epilazione definitiva',
    'diodo', 'radiofrequenza', 'hifu', 'filler', 'botox',
    'nail', 'lash', 'spa', 'benessere', 'trattamenti',
    'estetica avanzata', 'medical', 'dermo', 'beauty studio',
];

// Keywords that indicate out-of-ICP (hairdressers, medical, unrelated)
const WEAK_SIGNALS = [
    'parrucchiere', 'parrucchieri', 'barbiere', 'barberia', 'salone capelli',
    'coiffeur', 'acconciature', 'tintoria', 'lavanderia',
    'inalatorio', 'polispecialistico', 'chirurgo', 'medico', 'clinica medica',
    'dentista', 'odontoiatrico', 'fisioterapia', 'ortopedico',
];

// Generic domains that suggest low digital presence
const GENERIC_EMAIL_DOMAINS = ['gmail.com', 'libero.it', 'yahoo.it', 'hotmail.it', 'alice.it', 'tiscali.it'];

interface Lead {
    company_name: string;
    city: string;
    province: string;
    address: string;
    phone: string;
    website: string;
    email: string;
    pec: string;
    decision_maker_name: string;
    decision_maker_role: string;
    category: string;
    lead_score: number;
    discovery_method: string;
    reason_code: string;
    // ICP fields
    premium_signal: string;
    visual_opportunity_signal: string;
    icp_tier: string;
    notes_for_outreach: string;
    business_type: string;
}

function extractPremiumSignals(name: string, website: string, category: string): string[] {
    const text = `${name} ${website} ${category}`.toLowerCase();
    return PREMIUM_KEYWORDS.filter(kw => text.includes(kw));
}

function isWeakTarget(name: string, category: string): boolean {
    const text = `${name} ${category}`.toLowerCase();
    return WEAK_SIGNALS.some(kw => text.includes(kw));
}

function hasGenericEmail(email: string): boolean {
    if (!email) return false;
    const domain = email.split('@')[1]?.toLowerCase() || '';
    return GENERIC_EMAIL_DOMAINS.includes(domain);
}

function classifyBusinessType(name: string, category: string): string {
    const text = `${name} ${category}`.toLowerCase();
    if (text.includes('laser') || text.includes('epilazione')) return 'epilazione_laser';
    if (text.includes('nail') || text.includes('unghie')) return 'nail_studio';
    if (text.includes('lash') || text.includes('ciglia')) return 'lash_studio';
    if (text.includes('skin') || text.includes('dermo') || text.includes('viso')) return 'skin_clinic';
    if (text.includes('spa') || text.includes('benessere') || text.includes('terme')) return 'beauty_spa';
    if (text.includes('beauty') || text.includes('center') || text.includes('centre')) return 'beauty_center';
    return 'centro_estetico';
}

function scoreLead(row: any): { tier: string; premiumSignal: string; visualOpportunity: string; notes: string } {
    const name = (row.company_name || '').toLowerCase();
    const website = (row.website_validated || '').toLowerCase();
    const category = (row.category || '').toLowerCase();
    const email = row.email || '';
    const pec = row.pec || '';
    const score = row.lead_score || 0;
    const hasWebsite = !!row.website_validated;
    const hasEmail = !!(email || pec);
    const hasPhone = !!row.phone;

    const premiumKws = extractPremiumSignals(name, website, category);
    const isWeak = isWeakTarget(name, category);
    const genericMail = hasGenericEmail(email);

    const premiumSignal = premiumKws.length > 0 ? premiumKws.join(', ') : 'none';

    // Visual opportunity: has website but email is generic OR website domain hints at simple presence
    const simpleWebsite = website.includes('wix') || website.includes('wordpress') || website.includes('altervista') || website.includes('webnode');
    const visualOpportunity = hasWebsite
        ? (genericMail ? 'email_generica_sito_presente' : simpleWebsite ? 'sito_builder_semplice' : 'sito_presente_ottimizzabile')
        : 'no_sito_solo_listing';

    const notes: string[] = [];
    if (pec) notes.push('PEC disponibile — outreach formale possibile');
    if (hasWebsite && !hasEmail) notes.push('Sito trovato ma email non estratta — verifica manuale');
    if (genericMail) notes.push('Email generica — probabile low-engagement, valutare LinkedIn');
    if (premiumKws.length > 0) notes.push(`Segnali premium: ${premiumKws.join(', ')}`);
    if (row.discovery_method?.includes('HYPER_GUESSER')) notes.push('Sito trovato via HyperGuesser — presidiato online');
    if (row.discovery_method?.includes('PIVA')) notes.push('P.IVA verificata — azienda strutturata');

    // ICP Tier assignment
    let tier: string;
    if (isWeak) {
        tier = 'DROP';
        notes.push('OUT-OF-ICP: parrucchiere/barbiere/salone');
    } else if (hasWebsite && hasEmail && (premiumKws.length > 0 || score >= 78)) {
        tier = 'T1';
    } else if (hasWebsite && hasEmail) {
        tier = 'T2';
    } else if (hasWebsite || hasPhone) {
        tier = 'T3';
    } else {
        tier = 'DROP';
    }

    return {
        tier,
        premiumSignal,
        visualOpportunity,
        notes: notes.join(' | '),
    };
}

async function main() {
    console.log('📊 ICP Export — Video Potenziato');
    const db = new Database(DB_PATH, { readonly: true });

    const rows = db.prepare(`
        SELECT
            c.company_name, c.city, c.province, c.address, c.phone, c.category,
            e.website_validated, e.email, e.pec,
            e.decision_maker_name, e.decision_maker_role,
            e.lead_score, e.discovery_method, e.reason_code
        FROM enrichment_results e
        JOIN companies c ON c.id = e.company_id
        ORDER BY e.lead_score DESC
    `).all() as any[];

    console.log(`Found ${rows.length} enriched records`);

    const leads: Lead[] = rows.map(row => {
        const icp = scoreLead(row);
        return {
            company_name: row.company_name || '',
            city: row.city || '',
            province: row.province || '',
            address: row.address || '',
            phone: row.phone || '',
            website: row.website_validated || '',
            email: row.email || '',
            pec: row.pec || '',
            decision_maker_name: row.decision_maker_name || '',
            decision_maker_role: row.decision_maker_role || '',
            category: row.category || '',
            lead_score: row.lead_score || 0,
            discovery_method: row.discovery_method || '',
            reason_code: row.reason_code || '',
            business_type: classifyBusinessType(row.company_name || '', row.category || ''),
            premium_signal: icp.premiumSignal,
            visual_opportunity_signal: icp.visualOpportunity,
            icp_tier: icp.tier,
            notes_for_outreach: icp.notes,
        };
    });

    // Stats
    const tiers = { T1: 0, T2: 0, T3: 0, DROP: 0 };
    leads.forEach(l => { tiers[l.icp_tier as keyof typeof tiers]++; });
    console.log('Tier breakdown:', tiers);

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

    const writer = createObjectCsvWriter({
        path: OUTPUT_PATH,
        header: [
            { id: 'icp_tier', title: 'icp_tier' },
            { id: 'company_name', title: 'company_name' },
            { id: 'business_type', title: 'business_type' },
            { id: 'city', title: 'city' },
            { id: 'province', title: 'province' },
            { id: 'website', title: 'website' },
            { id: 'email', title: 'email' },
            { id: 'pec', title: 'pec' },
            { id: 'phone', title: 'phone' },
            { id: 'decision_maker_name', title: 'decision_maker_name' },
            { id: 'decision_maker_role', title: 'decision_maker_role' },
            { id: 'lead_score', title: 'lead_score' },
            { id: 'premium_signal', title: 'premium_signal' },
            { id: 'visual_opportunity_signal', title: 'visual_opportunity_signal' },
            { id: 'notes_for_outreach', title: 'notes_for_outreach' },
            { id: 'discovery_method', title: 'discovery_method' },
            { id: 'reason_code', title: 'reason_code' },
            { id: 'address', title: 'address' },
        ],
    });

    await writer.writeRecords(leads);
    console.log(`✅ Exported ${leads.length} leads → ${OUTPUT_PATH}`);
    console.log(`T1: ${tiers.T1} | T2: ${tiers.T2} | T3: ${tiers.T3} | DROP: ${tiers.DROP}`);

    db.close();
}

main().catch(console.error);
