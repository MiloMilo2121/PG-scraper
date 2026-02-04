
/**
 * 🔢 Italian P.IVA Validator & VIES Check
 * 
 * Implements:
 * 1. Mod11 Algorithm (Italian Checksum)
 * 2. VIES API Check (European Database)
 */
import axios from 'axios';

/**
 * Validates Italian P.IVA using Mod11 algorithm.
 */
export function validatePiva(piva: string): boolean {
    const clean = piva.replace(/\s/g, '').replace(/^IT/i, '');
    if (!/^\d{11}$/.test(clean)) return false;

    const digits = clean.split('').map(Number);
    let sumOdd = 0;
    let sumEven = 0;

    for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
            sumOdd += digits[i];
        } else {
            let val = digits[i] * 2;
            if (val > 9) val -= 9;
            sumEven += val;
        }
    }

    const total = sumOdd + sumEven;
    const checkDigit = (10 - (total % 10)) % 10;
    return checkDigit === digits[10];
}

/**
 * Extracts and validates P.IVA from text.
 */
export function extractAndValidatePiva(raw: string): string | null {
    const patterns = [
        /(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva)[\s:\.\-]*(IT)?[\s]?(\d{11})/gi,
        /C\.?\s*F\.?\s*[\\/\.\s]+P\.?\s*I\.?\s*V\.?\s*A\.?[\s:\.\-]*(\d{11})/gi,
        /\bIT[\s]?(\d{11})\b/g,
        /(?:VAT|Tax\s*ID)[\s:\.\-]*(IT)?(\d{11})/gi,
    ];

    for (const pattern of patterns) {
        const matches = raw.matchAll(pattern);
        for (const match of matches) {
            const piva = match[2] || match[1];
            if (piva && validatePiva(piva)) return piva;
        }
    }

    const standalone = raw.match(/\b(\d{11})\b/g);
    if (standalone) {
        for (const candidate of standalone) {
            if (validatePiva(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Task 12: VIES API Validation
 * Checks via EU SOAP Endpoint.
 */
export async function checkVies(piva: string, countryCode: string = 'IT'): Promise<{ valid: boolean, name?: string, address?: string, error?: string }> {
    try {
        const cleanPiva = piva.replace(/^IT/i, '');
        const xml = `
        <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
                <checkVat xmlns="urn:ec.europa.eu:taxation_customs:vies:services:checkVat:types">
                    <countryCode>${countryCode}</countryCode>
                    <vatNumber>${cleanPiva}</vatNumber>
                </checkVat>
            </soap:Body>
        </soap:Envelope>`;

        const response = await axios.post('http://ec.europa.eu/taxation_customs/vies/services/checkVatService', xml, {
            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
            timeout: 5000
        });

        const body = response.data;
        const valid = body.includes('<valid>true</valid>');

        // Simple regex extraction for XML
        const getName = (s: string) => { const m = s.match(/<name>([^<]+)<\/name>/); return m ? m[1].replace(/&amp;/g, '&') : undefined; };
        const getAddr = (s: string) => { const m = s.match(/<address>([^<]+)<\/address>/); return m ? m[1].replace(/&amp;/g, '&') : undefined; };

        return {
            valid,
            name: valid ? getName(body) : undefined,
            address: valid ? getAddr(body) : undefined
        };
    } catch (e) {
        return { valid: false, error: (e as Error).message };
    }
}
