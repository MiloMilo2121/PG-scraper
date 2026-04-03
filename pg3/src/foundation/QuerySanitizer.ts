import { NormalizedInput } from './InputNormalizer';

export class QuerySanitizer {
    private stopWords = new Set(['srl', 'spa', 'snc', 'sas', 'scarl', 'srls', 'di', 'e', 'il', 'la', 'le', 'i', 'un', 'una', 'da', 'per', 'con', 'su']);

    // THE EXCLUSION DORK ENGINE (Gemma 2)
    // Rimuove pesantemente il rumore dalle query prima ancora che vengano processate dal motore di ricerca.
    private exclusionDorks = '-site:facebook.com -site:instagram.com -site:linkedin.com -site:paginegialle.it -site:registroimprese.it -site:tuttocitta.it -site:tripadvisor.com -site:kompass.com -site:europages.it -site:yelp.it -site:trustpilot.com -site:informazione-aziende.it -site:impresaitalia.info -site:dnb.com -site:prontopro.it -site:misterimprese.it';


    public sanitizeForQuery(text: string): string {
        if (!text) return '';

        let sanitized = text;
        // 1. Remove all quotes
        sanitized = sanitized.replace(/["'«»‹›„“”‘’]/g, '');
        // 2. Remove/Escape special chars: ( ) [ ] { } < > | & ! ^ ~ * ? : / \
        sanitized = sanitized.replace(/[\(\)\[\]\{\}\<\>\|\&\!\^\~\*\?\:\/\\]/g, ' ');
        // 3. Replace apostrophes (was caught by 1, but if it wasn't, space it out)
        sanitized = sanitized.replace(/'/g, ' ');
        // Deduplicate spaces
        sanitized = sanitized.replace(/\s+/g, ' ').trim();
        // 4. Truncate to 200 chars max
        if (sanitized.length > 200) {
            sanitized = sanitized.substring(0, 200).trim();
        }

        return sanitized;
    }

    private isOnlyStopWords(text: string): boolean {
        const words = text.toLowerCase().split(/\s+/);
        return words.every(w => this.stopWords.has(w));
    }

    private pushUniqueVariant(variants: string[], seen: Set<string>, query: string | null | undefined) {
        if (!query) {
            return;
        }

        const trimmed = query.trim();
        if (!trimmed) {
            return;
        }

        const normalized = trimmed.replace(/\s+/g, ' ');
        if (seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        variants.push(normalized.length > 200 ? normalized.substring(0, 200).trim() : normalized);
    }

    private extractWebsiteHost(website?: string): string | null {
        if (!website) {
            return null;
        }

        try {
            const hostname = new URL(website).hostname.replace(/^www\./i, '').toLowerCase();
            return hostname || null;
        } catch {
            return null;
        }
    }

    private buildDomainHintTokens(input: NormalizedInput): string[] {
        const tokens = new Set<string>();
        const websiteHost = this.extractWebsiteHost(input.website);
        const emailDomain = input.email_domain?.replace(/^www\./i, '').toLowerCase();

        for (const host of [websiteHost, emailDomain]) {
            if (!host) {
                continue;
            }

            tokens.add(host);
            const root = host.split('.').slice(0, -1).join('.');
            if (root) {
                tokens.add(root);
            }
        }

        return [...tokens].filter(Boolean);
    }

    public buildCompanyQuery(input: NormalizedInput, options: {
        target: 'serp' | 'linkedin' | 'registry' | 'bilancio';
        includeCity?: boolean;
        includeDomain?: string;
        fileType?: string;
    }): string | null {
        const cleanName = this.sanitizeForQuery(input.company_name);
        if (!cleanName || this.isOnlyStopWords(cleanName)) return null;

        let parts: string[] = [];

        if (options.includeDomain) {
            parts.push(options.includeDomain);
        }

        // Exact match wraps the CLEANED name in syntactically safe double quotes
        parts.push(`"${cleanName}"`);

        // Roles or specific keywords based on target
        if (options.target === 'linkedin') {
            parts.push('Titolare OR CEO OR Amministratore');
        }

        if (options.includeCity !== false && input.city) {
            const cleanCity = this.sanitizeForQuery(input.city);
            if (cleanCity) {
                parts.push(cleanCity);
            }
        }

        if (options.fileType) {
            parts.push(options.fileType);
        }

        if (options.target === 'bilancio') {
            parts.push('bilancio OR "stato patrimoniale"');
        }

        const query = parts.join(' ').trim();
        if (query.length > 200) {
            return query.substring(0, 200).trim();
        }
        return query;
    }

    public buildQueryVariants(input: NormalizedInput, target: 'company' | 'linkedin' | 'registry' | 'bilancio', piva?: string): string[] {
        const variants: string[] = [];
        const seen = new Set<string>();

        const cleanName = this.sanitizeForQuery(input.company_name);
        if (!cleanName || this.isOnlyStopWords(cleanName)) return variants;
        const cleanCity = this.sanitizeForQuery(input.city || '');
        const cleanProvince = this.sanitizeForQuery(input.provincia || '');
        const cleanAddress = this.sanitizeForQuery(input.address || '').split(',')[0]?.trim() || '';
        const cleanPhone = (input.phone || '').replace(/\D/g, '');
        const locationHints = [cleanCity, cleanProvince].filter(Boolean);
        const sanitizedVariants = Array.from(new Set(
            (input.company_name_variants || [input.company_name])
                .map((variant) => this.sanitizeForQuery(variant))
                .filter((variant) => variant && !this.isOnlyStopWords(variant))
        ));

        if (target === 'company') {
            const exclusions = this.exclusionDorks;

            // THE GOD-TIER OVERRIDE: 1st Priority is the raw P.IVA
            if (piva) {
                const cleanPiva = piva.replace(/[^0-9]/g, '');
                if (cleanPiva.length === 11) {
                    this.pushUniqueVariant(variants, seen, `"${cleanPiva}" ${exclusions}`);
                }
            }

            const primaryName = sanitizedVariants[0] || cleanName;
            if (input.email_domain) {
                const emailDomain = input.email_domain.replace(/^www\./i, '').trim().toLowerCase();
                if (emailDomain) {
                    this.pushUniqueVariant(
                        variants,
                        seen,
                        `site:${emailDomain} "${primaryName}" ${locationHints.join(' ')}`
                    );
                }
            }

            for (const candidateName of sanitizedVariants.slice(0, 3)) {
                const exactLocationQuery = locationHints.length > 0
                    ? `"${candidateName}" ${locationHints.map((hint) => `"${hint}"`).join(' ')} ${exclusions}`
                    : `"${candidateName}" ${exclusions}`;
                this.pushUniqueVariant(variants, seen, exactLocationQuery);

                const contactVector = locationHints.length > 0
                    ? `intitle:"${candidateName}" ("contatti" OR "chi siamo" OR "azienda") ${locationHints.map((hint) => `"${hint}"`).join(' ')} ${exclusions}`
                    : `intitle:"${candidateName}" ("contatti" OR "chi siamo" OR "azienda") ${exclusions}`;
                this.pushUniqueVariant(variants, seen, contactVector);

                const legalVector = locationHints.length > 0
                    ? `"${candidateName}" ${locationHints.map((hint) => `"${hint}"`).join(' ')} ("privacy policy" OR "note legali" OR "partita iva") ${exclusions}`
                    : `"${candidateName}" ("privacy policy" OR "note legali" OR "partita iva") ${exclusions}`;
                this.pushUniqueVariant(variants, seen, legalVector);
            }

            if (cleanPhone.length >= 8) {
                this.pushUniqueVariant(variants, seen, `"${primaryName}" "${cleanPhone}" ${exclusions}`);
            }

            if (cleanAddress.length >= 6) {
                this.pushUniqueVariant(variants, seen, `"${primaryName}" "${cleanAddress}" ${locationHints.join(' ')} ${exclusions}`);
            }

            this.pushUniqueVariant(variants, seen, `"${primaryName}" ${locationHints.join(' ')} sito ufficiale`);
            this.pushUniqueVariant(variants, seen, `"${primaryName}" ${locationHints.join(' ')} ("contatti" OR "chi siamo")`);
        } else if (target === 'linkedin') {
            const domainHints = this.buildDomainHintTokens(input);
            const primaryName = sanitizedVariants[0] || cleanName;
            const locationQuery = locationHints.join(' ');
            const domainQuery = domainHints.length > 0
                ? `(${domainHints.map((hint) => `"${hint}"`).join(' OR ')})`
                : '';
            const leadershipRoles = '(Titolare OR Founder OR CEO OR Amministratore OR Owner OR "Managing Director" OR Presidente)';

            this.pushUniqueVariant(
                variants,
                seen,
                `site:linkedin.com/in "${primaryName}" ${locationQuery} ${leadershipRoles}`
            );
            this.pushUniqueVariant(
                variants,
                seen,
                `site:linkedin.com/in "${primaryName}" ${locationQuery} ("branch manager" OR "responsabile" OR "direttore" OR "co-founder")`
            );

            if (domainQuery) {
                this.pushUniqueVariant(
                    variants,
                    seen,
                    `site:linkedin.com/in "${primaryName}" ${locationQuery} ${domainQuery}`
                );
                this.pushUniqueVariant(
                    variants,
                    seen,
                    `site:linkedin.com/in ${domainQuery} ${locationQuery} ${leadershipRoles}`
                );
            }

            for (const candidateName of sanitizedVariants.slice(1, 3)) {
                this.pushUniqueVariant(
                    variants,
                    seen,
                    `site:linkedin.com/in "${candidateName}" ${locationQuery} ${leadershipRoles}`
                );
            }
        } else if (target === 'registry') {
            const v1 = this.buildCompanyQuery(input, { target: 'registry', includeDomain: 'site:registroimprese.it OR site:informazione-aziende.it' });
            if (v1) variants.push(v1);
        } else if (target === 'bilancio') {
            const primaryName = sanitizedVariants[0] || cleanName;
            const locationQuery = locationHints.join(' ');
            const cleanPiva = (piva || '').replace(/[^0-9]/g, '');

            if (cleanPiva.length === 11) {
                this.pushUniqueVariant(
                    variants,
                    seen,
                    `"${cleanPiva}" filetype:pdf (bilancio OR fatturato OR "stato patrimoniale")`
                );
            }

            this.pushUniqueVariant(
                variants,
                seen,
                `"${primaryName}" ${locationQuery} filetype:pdf (bilancio OR fatturato OR "stato patrimoniale")`
            );
            this.pushUniqueVariant(
                variants,
                seen,
                `"${primaryName}" ${locationQuery} ("fatturato" OR "ricavi" OR dipendenti OR EBITDA)`
            );
            this.pushUniqueVariant(
                variants,
                seen,
                `site:fatturatoitalia.it "${primaryName}" ${locationQuery}`
            );
            this.pushUniqueVariant(
                variants,
                seen,
                `site:registroimprese.it "${primaryName}" ${locationQuery} bilancio`
            );
            if (input.website || input.email_domain) {
                const domainHints = this.buildDomainHintTokens(input);
                for (const hint of domainHints.slice(0, 2)) {
                    this.pushUniqueVariant(
                        variants,
                        seen,
                        `"${primaryName}" "${hint}" ${locationQuery} (bilancio OR fatturato OR dipendenti)`
                    );
                }
            }
        }

        return variants.slice(0, target === 'company' ? 12 : target === 'linkedin' ? 5 : 4);
    }
}
