
import { LLMService } from './llm_service';
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';

/**
 * 🎯 VALIDATION RESULT
 * Extended schema per Zero-Cost AI Upgrade report (Chapter 3).
 * Includes entity_type and next_action for agentic decision pipeline.
 */
export interface ValidationResult {
    isValid: boolean;
    confidence: number;
    reason: string;
    entity_type: 'official_site' | 'directory' | 'social' | 'uncertain';
    next_action: 'accept' | 'crawl_contact' | 'reject';
    correctedData?: Record<string, unknown>;
}

/**
 * JSON Schema for OpenAI Structured Outputs (Law 502: machine-readable immediately).
 * All fields required + additionalProperties: false = guaranteed structure.
 */
const VALIDATION_SCHEMA = {
    type: 'object' as const,
    properties: {
        isValid: { type: 'boolean' as const },
        confidence: { type: 'number' as const },
        reason: { type: 'string' as const },
        entity_type: {
            type: 'string' as const,
            enum: ['official_site', 'directory', 'social', 'uncertain'],
        },
        next_action: {
            type: 'string' as const,
            enum: ['accept', 'crawl_contact', 'reject'],
        },
    },
    required: ['isValid', 'confidence', 'reason', 'entity_type', 'next_action'] as const,
    additionalProperties: false as const,
};

export class LLMValidator {
    /**
     * Validate whether scraped text belongs to the target company.
     * Uses OpenAI Structured Outputs for guaranteed valid JSON (replacing brittle regex parsing).
     */
    public static async validateCompany(company: CompanyInput, scrapedText: string): Promise<ValidationResult> {
        if (!process.env.OPENAI_API_KEY) {
            return {
                isValid: false,
                confidence: 0,
                reason: 'LLM disabled (missing API key)',
                entity_type: 'uncertain',
                next_action: 'reject',
            };
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
1) Return isValid=false for directories/aggregators/social pages. Set entity_type accordingly.
2) Strong positive signal: exact VAT or exact phone on a non-directory page.
3) Medium positive signal: company name + city/address coherence on a dedicated business site.
4) If evidence is weak or ambiguous, return isValid=false with entity_type="uncertain".
5) Set next_action to "crawl_contact" if the page looks promising but lacks definitive proof.
6) Set next_action to "accept" only when confidence >= 0.80 and the site is clearly official.
7) Set next_action to "reject" when the page is clearly unrelated or is a directory/social.

Page text (truncated):
${LLMService.truncate(scrapedText, 1200)}
        `.trim();

        try {
            const res = await LLMService.completeStructured<ValidationResult>(
                prompt,
                VALIDATION_SCHEMA as Record<string, unknown>,
            );

            if (res && typeof res.isValid === 'boolean' && typeof res.confidence === 'number') {
                return {
                    isValid: res.isValid,
                    confidence: Math.max(0, Math.min(1, res.confidence)),
                    reason: typeof res.reason === 'string' && res.reason.trim() ? res.reason.trim() : 'LLM validated',
                    entity_type: res.entity_type || 'uncertain',
                    next_action: res.next_action || 'reject',
                };
            }
        } catch (error) {
            Logger.error('[LLMValidator] Structured output failed, trying legacy fallback', { error: error as Error });

            // Fallback to legacy completeJSON if structured outputs fail (e.g., model doesn't support it)
            try {
                const legacyRes = await LLMService.completeJSON<ValidationResult>(prompt);
                if (legacyRes && typeof legacyRes.isValid === 'boolean' && typeof legacyRes.confidence === 'number') {
                    return {
                        isValid: legacyRes.isValid,
                        confidence: Math.max(0, Math.min(1, legacyRes.confidence)),
                        reason: typeof legacyRes.reason === 'string' && legacyRes.reason.trim()
                            ? legacyRes.reason.trim()
                            : 'LLM validated (legacy)',
                        entity_type: legacyRes.entity_type || 'uncertain',
                        next_action: legacyRes.next_action || 'reject',
                    };
                }
            } catch (legacyError) {
                Logger.error('[LLMValidator] Legacy fallback also failed', { error: legacyError as Error });
            }
        }

        // Final fallback: silent failure is forbidden (Law 008)
        return {
            isValid: false,
            confidence: 0,
            reason: 'LLM Failure (both structured and legacy)',
            entity_type: 'uncertain',
            next_action: 'reject',
        };
    }
}
