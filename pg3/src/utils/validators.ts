
export class Validators {
    // Task 9: PIVA Extraction V2
    public static extractPIVA(text: string): string | null {
        const match = text.match(/\bIT\d{11}\b/i) || text.match(/\b\d{11}\b/);
        return match ? match[0].toUpperCase() : null;
    }

    public static validateVIES(piva: string): Promise<boolean> {
        // Mock VIES check
        return Promise.resolve(true);
    }

    // Task 10: Phone Formatting
    public static formatPhone(phone: string): string {
        // Strip non-digits
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('39')) return '+' + digits;
        if (digits.length === 10 && digits.startsWith('3')) return '+39' + digits; // Mobile
        if (digits.length >= 9 && digits.startsWith('0')) return '+39' + digits; // Landline
        return phone;
    }

    // Task 8: Language Detection
    public static isItalian(text: string): boolean {
        const commonWords = [' e ', ' di ', ' il ', ' la ', ' che ', ' per '];
        let score = 0;
        const lower = text.toLowerCase();
        for (const w of commonWords) {
            if (lower.includes(w)) score++;
        }
        return score >= 2;
    }
}
