
import axios from 'axios';
import { Logger } from '../../utils/logger';

export class ViesService {
    constructor() { }

    /**
     * Validate VAT number using EU VIES API.
     * Retries on network errors and accepts provisionally on persistent API failure
     * to prevent the entire enrichment pipeline from failing when the EU API is flaky.
     */
    async validateVat(vatNumber: string, countryCode: string = 'IT'): Promise<{ isValid: boolean; name?: string; address?: string; provisional?: boolean }> {
        // Basic format check for IT
        if (countryCode === 'IT' && !/^[0-9]{11}$/.test(vatNumber)) {
            return { isValid: false };
        }

        // Italian VAT checksum validation (Luhn mod-10 variant)
        if (countryCode === 'IT' && !this.isValidItalianVatChecksum(vatNumber)) {
            Logger.warn(`[VIES] VAT ${vatNumber} failed checksum validation`);
            return { isValid: false };
        }

        const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;
        let wasNetworkOrServerError = false;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await axios.get(url, { timeout: 10000 });
                if (response.data && response.data.isValid === true) {
                    return {
                        isValid: true,
                        name: response.data.name,
                        address: response.data.address,
                    };
                }
                if (response.data && response.data.isValid === false) {
                    // VIES explicitly said invalid - trust the response
                    return { isValid: false };
                }
            } catch (e) {
                lastError = e as Error;
                const isNetworkError = axios.isAxiosError(e) && (!e.response || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND');
                const isServerError = axios.isAxiosError(e) && e.response && e.response.status >= 500;

                if (isNetworkError || isServerError) {
                    wasNetworkOrServerError = true;
                    if (attempt < MAX_RETRIES) {
                        const delayMs = 1000 * Math.pow(2, attempt);
                        Logger.warn(`[VIES] Attempt ${attempt + 1} failed for ${vatNumber}, retrying in ${delayMs}ms...`, {
                            error_code: axios.isAxiosError(e) ? e.code : undefined,
                        });
                        await new Promise(r => setTimeout(r, delayMs));
                        continue;
                    }
                }
                // Non-retryable error or last attempt
                break;
            }
        }

        // VIES is down/unreachable after retries.
        // Accept provisionally if the checksum passed - this prevents the entire
        // financial enrichment pipeline from failing when the EU VIES API is flaky.
        if (wasNetworkOrServerError) {
            Logger.warn(`[VIES] Service unavailable for ${vatNumber} after ${MAX_RETRIES + 1} attempts. Accepting provisionally (checksum passed).`, {
                error: lastError?.message,
            });
            return { isValid: true, provisional: true };
        }

        return { isValid: false };
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
