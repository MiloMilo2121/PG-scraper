import { CompanyInput } from '../../types';

/**
 * 📧 EMAIL DOMAIN MINER (OMEGA 6.2-U)
 * Extracts potential corporate domains from the company's email addresses.
 * Aggressively filters out known public email providers and generic PEC providers.
 */
export class EmailDomainMiner {
    private static readonly PUBLIC_DOMAINS = new Set([
        'gmail.com', 'yahoo.com', 'yahoo.it', 'hotmail.com', 'hotmail.it',
        'outlook.com', 'outlook.it', 'live.com', 'live.it', 'msn.com',
        'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'tin.it', 'fastwebnet.it',
        'pec.it', 'legalmail.it', 'arubapec.it', 'mypec.eu', 'telecompost.it', 'postecert.it',
        'icloud.com', 'me.com', 'mac.com'
    ]);

    /**
     * Extracts potential corporate website domains from the provided email addresses.
     */
    public static extractDomains(company: CompanyInput): string[] {
        const emails = [
            company.email,
            (company as any).pec,
            company.decision_maker_email,
            company.dm1_email
        ].filter(e => e && typeof e === 'string' && e.includes('@'));

        const candidates = new Set<string>();

        for (const email of emails) {
            try {
                const domain = email!.split('@')[1].toLowerCase().trim();

                // 1. Exact match against known public domains
                if (this.PUBLIC_DOMAINS.has(domain)) continue;

                // 2. Heuristic checks for generic PEC/Legalmail subdomains not strictly in the Set
                if (
                    domain.includes('.telecompost.it') ||
                    domain.includes('mypec.eu') ||
                    domain.includes('pec.') ||
                    domain.includes('legalmail') ||
                    domain.includes('sicurezzapostale.it') ||
                    domain.includes('gigapec.it') ||
                    domain.includes('registerpec.it')
                ) {
                    continue;
                }

                candidates.add(domain);
            } catch (e) {
                // Ignore parsing errors for malformed emails
            }
        }

        return Array.from(candidates);
    }
}
