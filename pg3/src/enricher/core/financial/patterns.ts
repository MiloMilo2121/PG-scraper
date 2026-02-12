/**
 * 🧠 REGEX PATTERNS (Law 002)
 * Pre-compiled regexes for performance.
 * Centralized for easy maintenance and testing.
 */

export const FinancialPatterns = {
    // Revenue (Fatturato)
    // Matches: "Fatturato: € 1.5 mln", "Ricavi: 200 milioni", "Volume d'affari: 500k"
    REVENUE: [
        /fatturato\s*(?:\(\d{4}\))?\s*(?:di)?\s*(?:circa)?\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
        /ricavi\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i,
        /volume\s*d['']affari\s*[:\s]*€?\s*([\d.,]+\s*(?:mln|milioni|mila|k|M|€)?)/i
    ],

    // Employees (Dipendenti)
    // Matches: "Dipendenti: 10-20", "Organico: 50", "Addetti: 5"
    EMPLOYEES: [
        /(?:dipendenti|numero\s*dipendenti)\s*(?:\(\d{4}\))?\s*[:\s]*([\d\-\.]+)/i,
        /organico\s*[:\s]*([\d\-\.]+)/i,
        /addetti\s*[:\s]*([\d\-\.]+)/i,
        /(\d+(?:-\d+)?)\s*dipendenti/i
    ],

    // VAT (P.IVA)
    // Matches: "P.IVA 12345678901", "Partita IVA: IT123..."
    VAT: {
        STANDALONE: /\b\d{11}\b/g,
        LABELED: /(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva|C\.?\s*F\.?\s*(?:\/|\s*e\s*)\s*P\.?\s*I\.?\s*V\.?\s*A\.?)[:\s]*(?:IT)?[\s]?(\d{11})/gi,
        IT_PREFIXED: /\bIT\s?(\d{11})\b/g
    },

    // PEC
    // Matches: "example@pec.it", "test@legalmail.it"
    PEC: /([a-zA-Z0-9._%+\-]+@(?:pec\.[a-zA-Z0-9.\-]+|[a-zA-Z0-9.\-]*(?:legalmail|arubapec|postecert|mypec|registerpec|sicurezzapostale|pecspeciale|cert\.legalmail|cgn\.legalmail|pec\.it|pec\.buffetti)\.[a-zA-Z]{2,}))/i
};

export const CompanyPatterns = {
    LEGAL_SUFFIXES: new Set([
        'srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'societa', 'ditta', 'impresa',
        'soc', 'co', 'ltd', 'llc', 'inc', 'group', 'holding', 'the', 'and', 'di',
        'dei', 'della', 'delle', 'del', 'de', 'e'
    ]),

    ADDRESS_NOISE: new Set([
        'via', 'viale', 'piazza', 'pzza', 'corso', 'strada', 's', 'snc', 'n', 'nr',
        'numero', 'interno', 'int'
    ]),

    // Phones
    PHONE: /(?:\+?\d[\d\s()./-]{5,}\d)/g
};
