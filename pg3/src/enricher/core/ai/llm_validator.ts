import { CompanyInput } from '../../types'; // Restore CompanyInput
import { config } from '../../config';
import { Logger } from '../../utils/logger';
import { LLMService } from './llm_service';
import { ModelRouter } from './model_router';
import { HTMLCleaner } from '../../utils/html_cleaner';
import { VALIDATE_COMPANY_PROMPT, SELECT_BEST_URL_PROMPT } from './prompt_templates';

/**
 * 🧠 LLM VALIDATOR — AI-Powered Business Validation
 *
 * Uses structured prompts and cleaned HTML for accurate company/website validation.
 * Replaced inline prompts with PromptTemplates (Law 506).
 * Replaced raw text truncation with HTMLCleaner (Law 501).
 */

export interface ValidationResult {
    isValid: boolean;
    confidence: number;
    reason: string;
    matchedSignals?: string[];
    rejectedSignals?: string[];
    entity_type: 'official_site' | 'directory' | 'social' | 'uncertain';
    next_action: 'accept' | 'crawl_contact' | 'reject' | 'manual_review';
}

export class LLMValidator {
    /**
     * Validate whether scraped webpage belongs to the target company.
     * Uses structured prompts + Cheerio-cleaned HTML for better accuracy.
     */
    public static async validateCompany(company: CompanyInput, scrapedHtml: string): Promise<ValidationResult> {
        const hasAnyLLMProvider = process.env.OPENAI_API_KEY || process.env.Z_AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY;
        if (!hasAnyLLMProvider) {
            return {
                isValid: false,
                confidence: 0,
                reason: 'LLM disabled (missing API key)',
                entity_type: 'uncertain',
                next_action: 'reject',
            };
        }

        // Clean HTML intelligently (Law 501: Cost Awareness)
        const cleaned = HTMLCleaner.extract(scrapedHtml, 2500, true);
        const cleanText = HTMLCleaner.toString(cleaned);

        // Build prompt from template
        const vat = (company.vat_code || company.piva || company.vat || '').replace(/\D/g, '');
        const phone = (company.phone || '').replace(/\D/g, '');

        const prompt = VALIDATE_COMPANY_PROMPT.template({
            companyName: company.company_name,
            city: company.city || '',
            address: company.address,
            vat,
            phone,
            cleanHtml: cleanText,
        });

        try {
            // Define a type that matches the prompt schema strictly
            type PromptResponse = {
                isValid: boolean;
                confidence: number;
                reasoning: string;
                matched_signals: string[];
                rejected_signals: string[];
                entity_type: 'official_site' | 'directory' | 'social' | 'uncertain';
                next_action: 'accept' | 'crawl_contact' | 'reject' | 'manual_review';
            };

            const modelChain = ModelRouter.selectTaskChain('company_validation', { strictJson: true });
            const res = await LLMService.completeStructured<PromptResponse>(
                prompt,
                VALIDATE_COMPANY_PROMPT.schema as Record<string, unknown>,
                modelChain[0],
                modelChain.slice(1)
            );

            // Log model usage for verification (Law 007)
            if (res) {
                ModelRouter.logTaskSelection('company_validation', { strictJson: true });
            }

            if (res && typeof res.isValid === 'boolean' && typeof res.confidence === 'number') {
                return {
                    isValid: res.isValid,
                    confidence: Math.max(0, Math.min(1, res.confidence)),
                    reason: res.reasoning || 'LLM validated',
                    matchedSignals: res.matched_signals || [],
                    rejectedSignals: res.rejected_signals || [],
                    entity_type: res.entity_type || 'uncertain',
                    next_action: res.next_action || 'reject',
                };
            }
        } catch (error) {
            Logger.error('[LLMValidator] Structured output failed, trying legacy fallback', { error: error as Error });

            // Fallback to legacy completeJSON if structured outputs fail
            try {
                const legacyRes = await LLMService.completeJSON<ValidationResult>(prompt);
                if (legacyRes && typeof legacyRes.isValid === 'boolean' && typeof legacyRes.confidence === 'number') {
                    return {
                        isValid: legacyRes.isValid,
                        confidence: Math.max(0, Math.min(1, legacyRes.confidence)),
                        reason: legacyRes.reason || 'LLM validated (legacy)',
                        entity_type: legacyRes.entity_type || 'uncertain',
                        next_action: legacyRes.next_action || 'reject',
                    };
                }
            } catch (legacyError) {
                Logger.error('[LLMValidator] Legacy fallback also failed', { error: legacyError as Error });
            }
        }

        // If both structured and legacy failed, reject
        return {
            isValid: false,
            confidence: 0,
            reason: 'LLM validation error',
            entity_type: 'uncertain',
            next_action: 'reject',
        };
    }

    /**
     * 🧠 SMART SERP SELECTION — AI chooses best URL from search results.
     * Uses configured smart model (GLM-5) with structured prompt template.
     */
    public static async selectBestUrl(
        company: CompanyInput,
        serpResults: Array<{ url: string; title: string; snippet: string }>
    ): Promise<{ bestUrl: string | null; confidence: number; reasoning: string; signals?: string[] }> {
        const hasAnyLLM = process.env.OPENAI_API_KEY || process.env.Z_AI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.KIMI_API_KEY;
        if (!hasAnyLLM) {
            Logger.warn('[LLMValidator] selectBestUrl: No LLM API key configured');
            return { bestUrl: null, confidence: 0, reasoning: 'LLM disabled (missing API key)' };
        }

        if (serpResults.length === 0) {
            return { bestUrl: null, confidence: 0, reasoning: 'No search results provided' };
        }

        // Build prompt from template
        const prompt = SELECT_BEST_URL_PROMPT.template({
            companyName: company.company_name,
            city: company.city || 'Italy',
            urls: serpResults.slice(0, 10), // Top 10 results only
        });

        try {
            type SelectResponse = {
                bestUrl: string | null;
                confidence: number;
                reasoning: string;
                signals: string[];
            };

            const selModelChain = ModelRouter.selectTaskChain('serp_url_selection', { strictJson: true });
            const res = await LLMService.completeStructured<SelectResponse>(
                prompt,
                SELECT_BEST_URL_PROMPT.schema as Record<string, unknown>,
                selModelChain[0],
                selModelChain.slice(1)
            );

            if (res && typeof res.confidence === 'number') {
                return {
                    bestUrl: res.bestUrl,
                    confidence: Math.max(0, Math.min(1, res.confidence)),
                    reasoning: res.reasoning || 'LLM selected best URL',
                    signals: res.signals || [],
                };
            }
        } catch (error) {
            Logger.error('[LLMValidator] selectBestUrl failed', { error: error as Error });
        }

        // Fallback: return first result with low confidence
        return {
            bestUrl: serpResults[0]?.url || null,
            confidence: 0.3,
            reasoning: 'Fallback: selected first search result (LLM failed)',
        };
    }
}
