
/**
 * 🛡️ CONTENT FILTER & JUNK DETECTOR 🛡️
 * Handles Tasks 15, 16, 17, 18
 */

export class ContentFilter {

    // Task 15: Directory Blocklist
    private static DIRECTORIES = [
        'paginegialle.it', 'paginebianche.it', 'yelp.it', 'tripadvisor.it',
        'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com',
        'virgilio.it', 'kompass.com', 'europages.com', 'misterimprese.it',
        'prontopro.it', 'habitissimo.it', 'infojobs.it', 'indeed.com',
        'glassdoor.it', 'trovalavoro.it', 'bakeca.it', 'subito.it',
        'wikipedia.org', 'amazon.it', 'ebay.it', 'groupon.it',
        'guidatitolari.it', 'registroimprese.it', 'ufficiocamerale.it',
        'informazione-aziende.it', 'trovanumeri.com', 'reteimprese.it', 'area-clienti.com',
        'pagineimprese.it', 'aziende.virgilio.it', 'yelp.com', 'linkedin.it'
    ];

    // Task 16: Parking / Domain for Sale patterns
    private static PARKING_KEYWORDS = [
        'domain is for sale', 'buy this domain', 'questo dominio è in vendita',
        'domain parked', 'godaddy', 'sedo', 'dan.com', 'afternic',
        'huge domains', 'domain name is available', 'acquista questo dominio',
        'is available for purchase', 'under verification', 'sito in costruzione'
    ];

    // Task 17: Under Construction patterns
    private static CONSTRUCTION_KEYWORDS = [
        'coming soon', 'lavori in corso', 'sito in manutenzione',
        'website under construction', 'stiamo arrivando', 'work in progress',
        'sito in allestimento', 'torneremo presto'
    ];

    // Task 18: Foreign Language Detection (Simple Heuristic)
    // We check for common Italian stop words. If low density, it's foreign.
    private static ITALIAN_STOP_WORDS = [
        ' il ', ' lo ', ' la ', ' i ', ' gli ', ' le ',
        ' di ', ' a ', ' da ', ' in ', ' con ', ' su ', ' per ', ' tra ', ' fra ',
        ' è ', ' sono ', ' siamo ', ' azienda ', ' contatti ', ' chi siamo ', ' dove siamo ',
        ' home ', ' servizi ', ' prodotti ' // Common menu items
    ];

    /**
     * Checks if a URL belongs to a directory/social/junk domain.
     */
    static isDirectoryOrSocial(url: string): boolean {
        try {
            const withProtocol = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
            const domain = new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase();
            return this.DIRECTORIES.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
        } catch {
            return true; // Invalid URL is junk
        }
    }

    /**
     * Reject obvious directory-like pages by title.
     */
    static isDirectoryLikeTitle(title: string): boolean {
        const t = title.toLowerCase();
        // ASSUMPTION: Use multi-word phrases to avoid false positives on legitimate business pages.
        // Single words like 'orari', 'trova', 'aziende' appear commonly on company pages.
        const badSignals = [
            'elenco aziende',
            'elenco imprese',
            'trova aziende',
            'directory aziende',
            'directory imprese',
            'imprese in',
            'recensioni di',
            'scheda azienda',
        ];
        return badSignals.some((signal) => t.includes(signal));
    }

    /**
     * Analyzes page text to detect Parking/Construction/Junk.
     * Returns TRUE if the content is VALID (Not junk).
     */
    static isValidContent(text: string): { valid: boolean; reason?: string } {
        const lowerText = text.toLowerCase();

        // 1. Check Parking
        for (const kw of this.PARKING_KEYWORDS) {
            if (lowerText.includes(kw)) {
                return { valid: false, reason: `Parking Page detected: ${kw}` };
            }
        }

        // 2. Check Under Construction
        // We look for strict matches or high prominence to avoid false positives in blog posts
        // For now, strict inclusion is safer for "lavori in corso"
        for (const kw of this.CONSTRUCTION_KEYWORDS) {
            if (lowerText.includes(kw) && lowerText.length < 500) { // Only if short text usually
                return { valid: false, reason: `Under Construction detected: ${kw}` };
            }
        }

        return { valid: true };
    }

    /**
     * Checks if text appears to be Italian.
     */
    static isItalianLanguage(text: string): boolean {
        const lowerText = text.toLowerCase();
        if (lowerText.length < 120) {
            // Too short to classify reliably
            return true;
        }
        let score = 0;

        // Count occurrences of Italian stop words
        for (const word of this.ITALIAN_STOP_WORDS) {
            if (lowerText.includes(word)) score++;
        }

        // HEURISTIC: If we find at least 3 distinct Italian common words, we accept.
        // This is very permissive to verify "Multilingual" sites where Italian is present.
        return score >= 2;
    }
}
