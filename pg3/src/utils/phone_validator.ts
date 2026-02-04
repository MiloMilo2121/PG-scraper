
import { parsePhoneNumber, PhoneNumber } from 'libphonenumber-js';

/**
 * Task 13: Strict Phone Number Normalization
 */
export class PhoneValidator {
    /**
     * Normalizes a phone number to E.164 format.
     * @param phone Raw phone string
     * @param countryCode Default country code (e.g., 'IT')
     * @returns E.164 string (e.g., +3902123456) or null if invalid
     */
    static normalize(phone: string, countryCode: any = 'IT'): string | null {
        try {
            if (!phone) return null;

            // Remove common junk
            // (already handled by libphonenumber, but some aggressive cleanup helps)
            let clean = phone.replace(/[^\d\+\(\)\s\-\.]/g, '');

            const phoneNumber: PhoneNumber | undefined = parsePhoneNumber(clean, countryCode);

            if (phoneNumber && phoneNumber.isValid()) {
                return phoneNumber.number; // Returns E.164
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Checks if a number is a mobile number
     */
    static isMobile(phone: string, countryCode: any = 'IT'): boolean {
        try {
            const phoneNumber = parsePhoneNumber(phone, countryCode);
            return phoneNumber ? phoneNumber.getType() === 'MOBILE' : false;
        } catch {
            return false;
        }
    }

    /**
     * Formats for display (National format)
     */
    static format(phone: string, countryCode: any = 'IT'): string | null {
        try {
            const phoneNumber = parsePhoneNumber(phone, countryCode);
            return phoneNumber ? phoneNumber.formatNational() : null;
        } catch {
            return null;
        }
    }
}
