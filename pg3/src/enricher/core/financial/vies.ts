import axios from 'axios';
import { Logger } from '../../utils/logger';
import { NetworkError } from '../../../utils/errors';
import { Retry } from '../../../utils/decorators';

interface ViesResult {
    isValid: boolean;
    name?: string;
    address?: string;
    provisional?: boolean;
}

export class ViesService {

    /**
     * Validate VAT number using EU VIES API
     */
    @Retry({ attempts: 3, delay: 1000, backoff: 'exponential' })
    async validateVat(vatNumber: string, countryCode: string = 'IT'): Promise<ViesResult> {
        // 1. Basic format check
        if (countryCode === 'IT') {
            if (!/^[0-9]{11}$/.test(vatNumber)) return { isValid: false };
            if (!this.isValidItalianVatChecksum(vatNumber)) {
                Logger.warn(`[VIES] VAT ${vatNumber} failed checksum validation`);
                return { isValid: false };
            }
        }

        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;

        try {
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data?.isValid === true) {
                return {
                    isValid: true,
                    name: response.data.name,
                    address: response.data.address,
                };
            }

            // Explicit invalid response
            return { isValid: false };

        } catch (e: any) {
            const isNetworkError = !e.response || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT';
            const isServerError = e.response?.status >= 500;
            const isClientError = e.response?.status >= 400 && e.response?.status < 500;

            // ⚠️ SAFEGUARD: If client error (400/404), it's likely invalid. Do NOT accept provisionally.
            if (isClientError) {
                Logger.warn(`[VIES] Client error (${e.response.status}) for ${vatNumber}. Assuming invalid.`);
                return { isValid: false };
            }

            // 🟢 FALLBACK: If network/server failure + Checksum passed (IT only), accept PROVISIONALLY.
            if ((isNetworkError || isServerError) && countryCode === 'IT') {
                Logger.warn(`[VIES] System unavailable. Accepting ${vatNumber} provisionally (Checksum OK).`);
                return { isValid: true, provisional: true };
            }

            // Retry logic handled by decorator, but if we reach here after retries (via re-throw), 
            // the decorator will give up.
            throw new NetworkError(`VIES validation failed: ${e.message}`);
        }
    }

    /**
     * Italian VAT (P.IVA) checksum validation.
     * Uses the Luhn-like algorithm specified by the Italian tax authority.
     */
    private isValidItalianVatChecksum(vat: string): boolean {
        if (!/^\d{11}$/.test(vat)) return false;

        const digits = vat.split('').map(Number);
        let sum = 0;

        for (let i = 0; i < 11; i++) {
            if (i % 2 === 0) {
                sum += digits[i];
            } else {
                const doubled = digits[i] * 2;
                sum += doubled > 9 ? doubled - 9 : doubled;
            }
        }

        return sum % 10 === 0;
    }
}
