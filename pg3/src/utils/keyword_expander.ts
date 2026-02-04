
export class KeywordExpander {
    public static expand(keyword: string): string[] {
        const variations = [keyword];

        // Simple Italian variations
        if (keyword.includes('Vendita')) {
            variations.push(keyword.replace('Vendita', 'Produzione'));
            variations.push(keyword.replace('Vendita', 'Noleggio'));
        }

        // Synonyms Stub
        const synonyms: { [key: string]: string[] } = {
            'Ristorante': ['Trattoria', 'Osteria', 'Pizzeria'],
            'Hotel': ['Albergo', 'B&B', 'Affittacamere']
        };

        for (const key in synonyms) {
            if (keyword.includes(key)) {
                variations.push(...synonyms[key].map(s => keyword.replace(key, s)));
            }
        }

        return [...new Set(variations)];
    }
}
