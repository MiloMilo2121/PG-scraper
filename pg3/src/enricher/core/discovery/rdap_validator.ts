import { request } from 'undici';
import { Logger } from '../../utils/logger';
import { CompanyInput } from '../../types';

export class RdapValidator {
    /**
     * Controlla un dominio via RDAP (WHOIS moderno) per cercare prove di appartenenza:
     * Partita IVA (P.IVA) o Nome Azienda nei record vCard del registratore.
     * ZERO COST: usa endpoint REST gratuiti e pubblici (NIC.it o RDAP.org)
     * 
     * @returns confidence_boost: un punteggio extra se c'è un match (es. 0.3 per nome, 0.8 per P.IVA)
     */
    static async checkDomainOwnership(domain: string, company: CompanyInput): Promise<number> {
        let confidenceBoost = 0;

        try {
            const cleanDomain = this.normalizeDomainInput(domain);
            if (!cleanDomain) {
                return 0;
            }
            const tld = cleanDomain.split('.').pop();

            // Determina l'endpoint migliore. rdap.nic.it per i .it è molto veloce.
            // rdap.org fa i redirect ai registry competenti
            const endpoint = tld === 'it'
                ? `https://rdap.nic.it/domain/${cleanDomain}`
                : `https://rdap.org/domain/${cleanDomain}`;

            const res = await request(endpoint, {
                method: 'GET',
                bodyTimeout: 8000,
                headersTimeout: 8000,
                headers: {
                    'Accept': 'application/rdap+json',
                    'User-Agent': 'Antigravity/OMEGAv7'
                }
            });

            if (res.statusCode === 404 || res.statusCode === 429) return 0;
            if (res.statusCode !== 200) return 0;

            const data = await res.body.json() as any;

            if (!data || !data.entities) return 0;

            const rdapStringPayload = JSON.stringify(data).toLowerCase();

            // Check 1: P.IVA / VAT ID Match (Golden Signal)
            const piva = ((company as any).piva || (company as any).vat_code || (company as any).vat || '')
                .replace(/[^0-9]/g, '');
            if (piva && piva.length >= 11 && rdapStringPayload.includes(piva)) {
                Logger.info(`[RDAPValidator] 🎯 BINGO! Found exact P.IVA ${piva} in WHOIS/RDAP for ${cleanDomain}`);
                return 0.9;
            }

            // Check 2: Name Match in vCard
            for (const entity of data.entities) {
                if (entity.vcardArray && entity.vcardArray[1]) {
                    for (const vcardEntry of entity.vcardArray[1]) {
                        if (vcardEntry[0] === 'fn' || vcardEntry[0] === 'org') {
                            const registrantName = (vcardEntry[3] || '').toString().toLowerCase();
                            const score = this.scoreNameMatch(company.company_name, registrantName);
                            if (score > 0.6) {
                                Logger.info(`[RDAPValidator] ✅ Found strong name match in RDAP for ${cleanDomain}: "${registrantName}" (Score: ${score})`);
                                confidenceBoost = Math.max(confidenceBoost, 0.4);
                            } else if (score > 0.4) {
                                Logger.info(`[RDAPValidator] 🔍 Found weak name match in RDAP for ${cleanDomain}: "${registrantName}" (Score: ${score})`);
                                confidenceBoost = Math.max(confidenceBoost, 0.2);
                            }
                        }
                    }
                }
            }

            // Check 3: Raw string fallback for company tokens in entire JSON
            if (confidenceBoost === 0) {
                const nameScore = this.scoreNameMatch(company.company_name, rdapStringPayload);
                if (nameScore > 0.8) {
                    confidenceBoost = 0.2;
                }
            }

        } catch (e: any) {
            // Rate limit (429) or Not Found (404) are common in RDAP. We silently ignore.
            if (e.response && (e.response.status === 404 || e.response.status === 429)) {
                // Ignore silent failure
            } else {
                Logger.warn(`[RDAPValidator] Failed looking up ${domain}: ${e.message}`);
            }
        }

        return confidenceBoost;
    }

    private static normalizeDomainInput(domain: string): string | undefined {
        const trimmed = (domain || '').trim().toLowerCase();
        if (!trimmed) {
            return undefined;
        }

        try {
            const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
            const hostname = new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
            return hostname || undefined;
        } catch {
            const fallback = trimmed
                .replace(/^www\./i, '')
                .replace(/^https?:\/\//i, '')
                .split('/')[0]
                .replace(/:\d+$/, '')
                .trim();
            return fallback.includes('.') ? fallback : undefined;
        }
    }

    private static tokenizeCompanyName(name: string): string[] {
        if (!name) return [];
        return name
            .toLowerCase()
            .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&/gi, '')
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(t => t.length > 2);
    }

    private static scoreNameMatch(companyName: string, candidateText: string): number {
        const tokens = this.tokenizeCompanyName(companyName);
        if (tokens.length === 0) return 0;

        const hay = candidateText.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
        let matched = 0;

        for (const t of tokens) {
            if (t.length < 3) continue;
            // Check for exact word boundary match in the text
            if (new RegExp(`\\b${t}\\b`).test(hay)) {
                matched++;
            }
        }

        const totalValidTokens = tokens.filter(t => t.length >= 3).length || 1;
        return matched / totalValidTokens;
    }
}
