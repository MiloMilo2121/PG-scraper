
import { LLMService } from './llm_service';
import { CompanyInput } from '../../types';

export interface ValidationResult {
    isValid: boolean;
    confidence: number;
    reason: string;
    correctedData?: any;
}

export class LLMValidator {
    public static async validateCompany(company: CompanyInput, scrapedText: string): Promise<ValidationResult> {
        if (!process.env.OPENAI_API_KEY) {
            return { isValid: false, confidence: 0, reason: 'LLM disabled (missing API key)' };
        }

        const vat = (company.vat_code || company.piva || company.vat || '').replace(/\D/g, '');
        const phone = (company.phone || '').replace(/\D/g, '');
        const prompt = `
You are validating whether webpage text belongs to the exact company below.

Target company:
- Name: "${company.company_name}"
- City: "${company.city || ''}"
- Address: "${company.address || ''}"
- VAT: "${vat}"
- Phone: "${phone}"

Rules:
1) Return "isValid=false" for directories/aggregators/social pages.
2) Strong positive signal: exact VAT or exact phone.
3) Medium positive signal: company name + city/address coherence.
4) If evidence is weak or ambiguous, return false.

Page text:
${LLMService.truncate(scrapedText, 1200)}

Respond with strict JSON only:
{"isValid": boolean, "confidence": number, "reason": string}
        `;

        const res = await LLMService.completeJSON<ValidationResult>(prompt);
        if (res && typeof res.isValid === 'boolean' && typeof res.confidence === 'number') {
            return {
                isValid: res.isValid,
                confidence: Math.max(0, Math.min(1, res.confidence)),
                reason: typeof res.reason === 'string' && res.reason.trim() ? res.reason.trim() : 'LLM validated',
            };
        }

        // Fallback Logic
        return { isValid: false, confidence: 0, reason: "LLM Failure" };
    }
}
