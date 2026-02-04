
/**
 * 🇮🇹 ISTAT & CAP VALIDATOR 🇮🇹
 * Task 19: Validate Postal Codes and Cities
 */

export class IstatValidator {

    // Simplified map of Province Capitals to CAP ranges (Heuristic)
    // In a full implementation, we would load `comuni.json` (~8000 entries).
    // Here we check format and consistency for major zones.
    private static REGIONS: Record<string, RegExp> = {
        'MI': /^20\d{3}$/, // Milano
        'RM': /^00\d{3}$/, // Roma
        'TO': /^10\d{3}$/, // Torino
        'NA': /^80\d{3}$/, // Napoli
        'LO': /^26\d{3}$/, // Lodi (User's specific focus)
        'CR': /^26\d{3}$/, // Cremona
        'BG': /^24\d{3}$/, // Bergamo
        'PV': /^27\d{3}$/, // Pavia
        'BS': /^25\d{3}$/, // Brescia
        'MB': /^20\d{3}$/, // Monza
        'VA': /^21\d{3}$/, // Varese
        'CO': /^22\d{3}$/, // Como
        'LC': /^23\d{3}$/, // Lecco
        'SO': /^23\d{3}$/, // Sondrio
        'MN': /^46\d{3}$/, // Mantova
    };

    /**
     * Validates that a CAP is potentially valid for a given province (if known).
     * Always checks strict 5-digit format.
     */
    static validate(cap: string, province?: string): boolean {
        // 1. Basic Format: 5 Digits
        if (!/^\d{5}$/.test(cap)) return false;

        // 2. Province Check (if provided and known)
        if (province) {
            const shortProv = province.trim().toUpperCase().substring(0, 2);
            const pattern = this.REGIONS[shortProv];
            if (pattern) {
                return pattern.test(cap);
            }
        }

        return true;
    }

    /**
     * Normalizes City Name (Title Case, remove extra spaces)
     */
    static normalizeCity(city: string): string {
        return city
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/(?:^|\s)\S/g, a => a.toUpperCase());
    }
}
