import { request } from 'undici';
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
            const res = await request(url, {
                method: 'GET',
                bodyTimeout: 10000,
                headersTimeout: 10000,
            });

            const statusCode = res.statusCode;

            if (statusCode >= 200 && statusCode < 300) {
                const data = await res.body.json() as any;

                if (data?.isValid === true) {
                    return {
                        isValid: true,
                        name: data.name,
                        address: data.address,
                    };
                }

                // Explicit invalid response
                return { isValid: false };
            }

            // Client error (400/404) — likely invalid
            if (statusCode >= 400 && statusCode < 500) {
                Logger.warn(`[VIES] Client error (${statusCode}) for ${vatNumber}. Assuming invalid.`);
                return { isValid: false };
            }

            // Server error (5xx) — accept provisionally for IT if checksum passed
            if (statusCode >= 500 && countryCode === 'IT') {
                Logger.warn(`[VIES] System unavailable. Accepting ${vatNumber} provisionally (Checksum OK).`);
                return { isValid: true, provisional: true };
            }

            throw new NetworkError(`VIES validation failed: HTTP ${statusCode}`);

        } catch (e: any) {
            if (e instanceof NetworkError) throw e;

            const isNetworkError = e.code === 'UND_ERR_CONNECT_TIMEOUT' || e.code === 'UND_ERR_BODY_TIMEOUT' || e.code === 'ENOTFOUND';

            if (isNetworkError && countryCode === 'IT') {
                Logger.warn(`[VIES] System unavailable. Accepting ${vatNumber} provisionally (Checksum OK).`);
                return { isValid: true, provisional: true };
            }

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
