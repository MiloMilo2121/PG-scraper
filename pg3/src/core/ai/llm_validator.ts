
import { LLMService } from './llm_service';

export interface ValidationResult {
    isValid: boolean;
    confidence: number;
    reason: string;
    correctedData?: any;
}

export class LLMValidator {
    public static async validateCompany(company: any, scrapedText: string): Promise<ValidationResult> {
        const prompt = `
        verify if this text belongs to company "${company.company_name}" located in "${company.city}".
        Text: ${LLMService.truncate(scrapedText, 1000)}
        
        Respond with JSON: { "isValid": boolean, "confidence": number (0-1), "reason": string }
        `;

        const res = await LLMService.completeJSON<ValidationResult>(prompt);
        if (res) return res;

        // Fallback Logic
        return { isValid: false, confidence: 0, reason: "LLM Failure" };
    }
}
