
/**
 * Task 14: Codice Fiscale Validator (Checksum)
 */
export class FiscalCodeValidator {

    // Character values for Odd positions (0, 2, 4...)
    private static ODD_VALUES: Record<string, number> = {
        '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
        'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
        'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
        'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23
    };

    // Character values for Even positions (1, 3, 5...)
    private static EVEN_VALUES: Record<string, number> = {
        '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
        'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9,
        'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19,
        'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25
    };

    private static CONTROL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    static validate(cf: string): boolean {
        if (!cf) return false;
        const code = cf.toUpperCase().replace(/\s/g, '');

        // Basic format check (16 alphanumeric chars)
        if (!/^[A-Z0-9]{16}$/.test(code)) {
            return false;
        }

        return this.calculateControlChar(code.substring(0, 15)) === code[15];
    }

    private static calculateControlChar(partials: string): string {
        let sum = 0;
        for (let i = 0; i < partials.length; i++) {
            const char = partials[i];
            // Even positions (0-indexed logic in array loop means i is index. 
            // In official specialized algorithm:
            // "Odd" positions are 1st, 3rd... which corresponds to index 0, 2...
            // "Even" positions are 2nd, 4th... which corresponds to index 1, 3...

            if ((i + 1) % 2 === 1) { // Odd Position (1st, 3rd...) -> Index 0, 2...
                sum += this.ODD_VALUES[char] || 0;
            } else { // Even Position (2nd, 4th...) -> Index 1, 3...
                sum += this.EVEN_VALUES[char] || 0;
            }
        }
        return this.CONTROL_CHARS[sum % 26];
    }

    /**
     * Extracts potential CFs from text
     */
    static extract(text: string): string[] {
        const matches = text.match(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi);
        if (!matches) return [];
        return matches
            .map(m => m.toUpperCase())
            .filter(cf => this.validate(cf));
    }
}
