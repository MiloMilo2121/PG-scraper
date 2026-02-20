import { NormalizedInput } from './InputNormalizer';

export class QuerySanitizer {
    private stopWords = new Set(['srl', 'spa', 'snc', 'sas', 'scarl', 'srls', 'di', 'e', 'il', 'la', 'le', 'i', 'un', 'una', 'da', 'per', 'con', 'su']);

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

    public buildQueryVariants(input: NormalizedInput, target: 'company' | 'linkedin' | 'registry' | 'bilancio'): string[] {
        const variants: string[] = [];

        const cleanName = this.sanitizeForQuery(input.company_name);
        if (!cleanName || this.isOnlyStopWords(cleanName)) return variants;
        const cleanCity = this.sanitizeForQuery(input.city || '');

        if (target === 'company') {
            // Variant 1: Exact
            if (cleanCity) {
                variants.push(`"${cleanName}" ${cleanCity}`);
            } else {
                variants.push(`"${cleanName}"`);
            }
            // Variant 2: Broad
            if (cleanCity) {
                variants.push(`${cleanName} ${cleanCity}`);
            }
            // Variant 3: Domain probe
            variants.push(`"${cleanName}" site:.it`);
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
