
import { CompanyInput } from '../types';

// Prefixes that indicate a generic/weak mailbox (low reply rate, often unmonitored).
const GENERIC_EMAIL_PREFIXES = [
    'info', 'contatti', 'contact', 'contacts', 'hello', 'office',
    'amministrazione', 'segreteria', 'reception', 'support', 'supporto',
    'admin', 'postmaster', 'webmaster', 'noreply', 'no-reply',
];

function classifyEmail(email: string): 'corporate' | 'generic' {
    const local = email.split('@')[0]?.toLowerCase() ?? '';
    return GENERIC_EMAIL_PREFIXES.some((p) => local === p || local.startsWith(p + '.'))
        ? 'generic'
        : 'corporate';
}

export class LeadScorer {

    /**
     * Calculates a 0–100 score for a lead based on data completeness and quality.
     *
     * Blocks:
     *   1. PHONE      30 pts  — essential reachability signal
     *   2. WEBSITE    30 pts  — confirmed digital presence
     *   3. VAT/PIVA   20 pts  — legal identity validated
     *   4. ADDRESS    10 pts  — postal reachability
     *   5. CONTACT    10 pts  — contact_reachability_bonus (see below)
     *
     * Block 5 — contact_reachability_bonus (cap 10):
     *   PEC present                          → +10  (certified, legally valid)
     *   non-generic email (corporate/personal) → +8  (high deliverability)
     *   generic email (info@, contatti@, …)  → +5  (valid but low reply-rate)
     *   no contact found                     → +0
     */
    static score(company: CompanyInput): number {
        let score = 0;

        // 1. PHONE (Essential) - 30 pts
        if (company.phone && company.phone.length > 5) {
            score += 30;
        }

        // 2. WEBSITE (High Value) - 30 pts
        if (company.website && company.website.includes('.')) {
            score += 30;
        }

        // 3. VAT/PIVA (Validation) - 20 pts
        if (company.piva || company.vat_code) {
            score += 20;
        }

        // 4. ADDRESS (Postal) - 10 pts
        if (company.address && company.address.length > 5) {
            score += 10;
        }

        // 5. CONTACT REACHABILITY BONUS - cap 10 pts
        // PEC takes priority; falls back to email quality if no PEC.
        let contactBonus = 0;
        if (company.pec && company.pec.includes('@')) {
            contactBonus = 10;
        } else if (company.email && company.email.includes('@')) {
            contactBonus = classifyEmail(company.email) === 'corporate' ? 8 : 5;
        }
        score += Math.min(contactBonus, 10);

        return Math.min(score, 100);
    }
}

