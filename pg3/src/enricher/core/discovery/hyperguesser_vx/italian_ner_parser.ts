export interface NerResult {
    original: string;
    normalized: string;
    legalEntity: string | null;
    descriptors: string[];
    brandTokens: string[];
    coreBrand: string;
}

export class ItalianNerParser {
    // Suffixes and prefixes that denote legal entity types, not part of the core brand
    private static LEGAL_ENTITIES = [
        'srl', 's.r.l.', 'srls', 's.r.l.s.', 'spa', 's.p.a.',
        'snc', 's.n.c.', 'sas', 's.a.s.', 'sapa', 's.a.p.a.',
        'ss', 's.s.', 'societa a responsabilita limitata',
        'societa per azioni', 'societa in nome collettivo',
        'societa in accomandita semplice', 'societa semplice',
        'coop', 'cooperativa', 'soc. coop.', 'societa cooperativa',
        'scarl', 's.c.a.r.l.', 'scrl', 's.c.r.l.',
        'onlus', 'a.p.s.', 'aps', 'ets'
    ];

    // Common generic descriptors that often accompany the brand but aren't the brand itself
    // Useful for filtering out noise during domain generation
    private static DESCRIPTORS = [
        'ditta', 'impresa', 'studio', 'officina', 'autofficina', 'carrozzeria',
        'autosoccorso', 'soccorso stradale', 'centro revisioni', 'gommista',
        'elettrauto', 'meccatronica', 'impianti', 'elettrici', 'termoidraulica',
        'costruzioni', 'edile', 'edilizia', 'immobiliare', 'autotrasporti',
        'logistica', 'servizi', 'pulizie', 'ristorante', 'pizzeria', 'bar',
        'hotel', 'albergo', 'bed and breakfast', 'b&b', 'agriturismo',
        'farmacia', 'parafarmacia', 'ottica', 'odontoiatrica', 'dentistico',
        'poliambulatorio', 'clinica', 'veterinaria', 'supermercato', 'minimarket',
        'macelleria', 'panificio', 'pasticceria', 'gelateria', 'abbigliamento',
        'calzature', 'pelletteria', 'lavanderia', 'estetica', 'parrucchiere',
        'barbiere', 'acconciature', 'fiorista', 'vivaio', 'agricola',
        'farm', 'azienda agricola', 'societa agricola', 'fondazione', 'associazione',
        'gruppo', 'group', 'sistemi', 'systems', 'tecnologie', 'technologies',
        'soluzioni', 'solutions', 'consulting', 'consulenze', 'partners',
        'fratelli', 'f.lli', 'sorelle', 'figli', 'eredi', 'di', 'e', '&', 'and'
    ];

    /**
     * Parses an Italian company name to extract the core brand name,
     * separating it from legal entities and generic descriptors.
     */
    static parse(companyName: string): NerResult {
        const original = companyName;
        // Normalize: lowercase, remove accents, replace special chars with spaces (except standard text chars)
        let normalized = companyName.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9&.\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        let legalEntity: string | null = null;
        let descriptors: string[] = [];
        let brandTokens: string[] = [];

        // 1. Extract and remove legal entity
        for (const entity of this.LEGAL_ENTITIES) {
            // Match legal entity as a whole word, allowing for dots
            const regex = new RegExp(`(^|\\s)${entity.replace(/\./g, '\\.')}($|\\s)`, 'i');
            if (regex.test(normalized)) {
                legalEntity = entity;
                normalized = normalized.replace(regex, ' ').replace(/\s+/g, ' ').trim();
                break; // Assume only one primary legal entity
            }
        }

        // 2. Tokenize the remaining string
        let workingString = normalized.replace(/[.\-&]/g, ' ').replace(/\s+/g, ' ').trim();
        const tokens = workingString.split(' ').filter(t => t.length > 0);

        // 3. Separate descriptors from brand tokens
        for (const token of tokens) {
            let isDescriptor = false;
            for (const desc of this.DESCRIPTORS) {
                if (token === desc) {
                    descriptors.push(token);
                    isDescriptor = true;
                    break;
                }
            }
            if (!isDescriptor) {
                brandTokens.push(token);
            }
        }

        if (brandTokens.length === 0 && tokens.length > 0) {
            brandTokens = [...tokens];
            descriptors = [];
        }

        const coreBrand = brandTokens.join(' ');

        return {
            original,
            normalized,
            legalEntity,
            descriptors,
            brandTokens,
            coreBrand
        };
    }
}
