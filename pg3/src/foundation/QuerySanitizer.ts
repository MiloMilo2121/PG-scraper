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

        const cleanName = this.sanitizeForQuery(input.company_name);
        if (!cleanName || this.isOnlyStopWords(cleanName)) return variants;
        const cleanCity = this.sanitizeForQuery(input.city || '');

        if (target === 'company') {
            const exclusions = this.exclusionDorks;

            // THE GOD-TIER OVERRIDE: 1st Priority is the raw P.IVA
            if (piva) {
                const cleanPiva = piva.replace(/[^0-9]/g, '');
                if (cleanPiva.length === 11) {
                    variants.push(`"${cleanPiva}" ${exclusions}`);
                }
            }

            // Variant 1: Exact name + city + Exclusions (High Precision Sniper)
            if (cleanCity) {
                variants.push(`"${cleanName}" "${cleanCity}" ${exclusions}`);
            } else {
                variants.push(`"${cleanName}" ${exclusions}`);
            }

            // Variant 2: Contact Vector / Intitle Match
            if (cleanCity) {
                variants.push(`intitle:"${cleanName}" "contatti" "${cleanCity}" ${exclusions}`);
                // Privacy / Note Legali Vector
                variants.push(`"${cleanName}" "${cleanCity}" ("privacy policy" OR "note legali") ${exclusions}`);
            } else {
                variants.push(`intitle:"${cleanName}" "contatti" ${exclusions}`);
            }

            // Variant 3: Standard Fallback
            variants.push(`"${cleanName}" ${cleanCity || ''} sito ufficiale`);
        } else if (target === 'linkedin') {
            const v1 = this.buildCompanyQuery(input, { target: 'linkedin', includeDomain: 'site:linkedin.com/in' });
            if (v1) variants.push(v1);
        } else if (target === 'registry') {
            const v1 = this.buildCompanyQuery(input, { target: 'registry', includeDomain: 'site:registroimprese.it OR site:informazione-aziende.it' });
            if (v1) variants.push(v1);
        } else if (target === 'bilancio') {
            const v1 = this.buildCompanyQuery(input, { target: 'bilancio', fileType: 'filetype:pdf' });
            if (v1) variants.push(v1);
        }

        return variants.slice(0, 3);
    }
}
