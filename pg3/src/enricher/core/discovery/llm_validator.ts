
import { PipelineConfig } from '../../config/pipeline_config';
import { Logger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate_limit';
import { CompanyInput } from '../../types';
import { PromptManager, PromptStrategy } from '../ai/prompt_manager';

/**
 * 🧠 LLM VALIDATOR 🧠
 * Uses Generative AI (GPT-4o-mini) to arbitrate uncertain matches.
 * Solves the "Missing PIVA" bottleneck by performing human-like verification.
 */
export class LLMValidator {
    private static ENDPOINT = 'https://api.openai.com/v1/chat/completions';

    // User-defined model tiers: GPT-5-mini for speed/cost, o3-mini for complex reasoning escalation.
    private static TIER1_MODEL = 'gpt-5-mini';
    private static TIER2_MODEL = 'o3-mini';

    /**
     * Tiered Semantic Verification.
     * 1. Tries Tier 1 (GPT-5-mini).
     * 2. If confidence is uncertain, escalates to Tier 2 (o3-mini).
     */
    static async validate(url: string, contentSnippet: string, company: CompanyInput): Promise<{ valid: boolean; reason: string; confidence: number; model_used: string }> {
        if (!PipelineConfig.KEYS.OPENAI) {
            return { valid: false, reason: 'No OpenAI Key', confidence: 0, model_used: 'none' };
        }

        const cleanSnippet = contentSnippet.replace(/\s+/g, ' ').slice(0, 1500);

        // --- TIER 1 Execution ---
        const tier1Res = await this.callOpenAI(this.TIER1_MODEL, url, cleanSnippet, company);

        // Decision Logic: When to escalate to Tier 2?
        // If Tier 1 is extremely confident (>0.9) or sure it's garbage (<0.2), trust it.
        // If it's in the "grey zone" (0.2 - 0.9), escalate to Reasoning Model.
        if (tier1Res.confidence > 0.9 || tier1Res.confidence < 0.2) {
            return { ...tier1Res, model_used: this.TIER1_MODEL };
        }

        Logger.info(`[LLM] Tier 1 (${this.TIER1_MODEL}) uncertain (${tier1Res.confidence}). Escalating to Tier 2 (${this.TIER2_MODEL})...`);

        // --- TIER 2 Execution ---
        const tier2Res = await this.callOpenAI(this.TIER2_MODEL, url, cleanSnippet, company, PromptStrategy.CHAIN_OF_THOUGHT);
        return { ...tier2Res, model_used: `${this.TIER1_MODEL} -> ${this.TIER2_MODEL}` };
    }

    private static async callOpenAI(model: string, url: string, snippet: string, company: CompanyInput, strategy: PromptStrategy = PromptStrategy.STANDARD): Promise<{ valid: boolean; reason: string; confidence: number }> {

        const manager = PromptManager.getInstance();
        const systemPrompt = manager.getValidationPrompt(strategy, company);

        const userPrompt = `Target Company: "${company.company_name}"
        Location: ${company.city} (${company.province})
        Activity/Category: ${company.category || 'Unknown'}
        
        Candidate Website: ${url}
        Website Content Snippet:
        """${snippet}"""
        
        Is this the correct website?`;

        try {
            // Adjust payload based on model type
            const isReasoning = model.includes('o1') || model.includes('o3');

            const payload: any = {
                model: model,
                messages: [
                    { role: 'user', content: systemPrompt + "\n\n" + userPrompt } // O3/O1 usually prefer single user message or specific role handling, but merging helps for reasoning models that don't support system role sometimes. Let's keep system if supported or merge.
                    // Actually, O1 supports developer/user roles but limited system param.
                    // For safety with O3-mini, we often merge into user or use 'developer' role.
                    // But to keep it standard for now:
                ]
            };

            if (isReasoning) {
                // Reasoning models: merge system instructions into user message for best compliance
                payload.messages = [{ role: 'user', content: systemPrompt + "\n\n---\n\n" + userPrompt }];
                payload.max_completion_tokens = 2000;
            } else {
                payload.messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ];
                payload.temperature = 0.0;
                payload.max_tokens = 200;
            }

            const response = await fetch(this.ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${PipelineConfig.KEYS.OPENAI}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                Logger.warn(`[LLM] API Error (${model}): ${response.statusText}`);
                return { valid: false, reason: `API Error ${model}`, confidence: 0 };
            }

            const data = await response.json();
            const resultRaw = data.choices[0]?.message?.content;

            const jsonStr = resultRaw.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(jsonStr);

            return {
                valid: result.is_match,
                reason: `[${model}] ${result.reason}`,
                confidence: result.confidence
            };

        } catch (error) {
            Logger.error(`[LLM] Validation Failed (${model})`, error);
            // Return a neutral result so it might trigger fallback if this was Tier 1
            return { valid: false, reason: `Exception ${model}`, confidence: 0.5 };
        }
    }
}
