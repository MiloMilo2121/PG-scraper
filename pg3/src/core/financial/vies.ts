
import axios from 'axios';
import { Logger } from '../../utils/logger';

export class ViesService {
    constructor() { }

    /**
     * Validate VAT number using EU VIES API
     */
    async validateVat(vatNumber: string, countryCode: string = 'IT'): Promise<{ isValid: boolean; name?: string; address?: string }> {
        // Basic format check for IT
        if (countryCode === 'IT' && !/^[0-9]{11}$/.test(vatNumber)) {
            return { isValid: false };
        }

        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;

        try {
            const response = await axios.get(url, { timeout: 10000 });
            if (response.data && response.data.isValid) {
                return {
                    isValid: true,
                    name: response.data.name,
                    address: response.data.address
                };
            }
        } catch (e) {
            // VIES is often down or slow. We shouldn't fail the whole process.
            // this.logger.warn(`   [VIES] Service unavailable or error for ${vatNumber}: ${(e as Error).message}`);
        }

        // Fallback: If 11 digits and numeric, assume valid struct for now if VIES fails?
        // No, strict validation means we only return true if VIES confirms.
        return { isValid: false };
    }
}
