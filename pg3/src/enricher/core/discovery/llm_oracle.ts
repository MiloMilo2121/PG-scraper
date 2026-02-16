/**
 * LLM ORACLE — Domain Inference via Large Language Models
 *
 * Uses LLMs to "remember" or "infer" the website of a company.
 * LLMs have compressed the internet — they often know the URL without searching.
 *
 * Chain-of-Thought prompt architecture for Italian SME domain inference.
 * Uses the cheapest available model (DeepSeek V3 / GLM-4-Flash / GPT-4o-mini).
 */

import { CompanyInput } from '../../types';
import { LLMService } from '../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../ai/model_router';
import { Logger } from '../../utils/logger';

export interface OracleResult {
    candidates: Array<{
        url: string;
        confidence: number;
        reasoning: string;
    }>;
    model: string;
}

// Simple in-memory cache for LLM oracle responses (eternal — the answer for "Rossi Srl" never changes)
const oracleCache = new Map<string, OracleResult>();
const MAX_CACHE_SIZE = 2000;

export class LLMOracle {
    /**
     * Ask the LLM to infer the most likely website for a company.
     * Returns candidate URLs with confidence scores.
     */
    static async infer(company: CompanyInput): Promise<OracleResult | null> {
        const cacheKey = this.buildCacheKey(company);
        const cached = oracleCache.get(cacheKey);
        if (cached) {
            Logger.info(`[LLMOracle] Cache hit for "${company.company_name}"`);
            return cached;
        }

        const model = ModelRouter.selectModel(TaskDifficulty.SIMPLE);
        const prompt = this.buildPrompt(company);

        try {
            const schema = {
                type: 'object' as const,
                properties: {
                    candidates: {
                        type: 'array' as const,
                        items: {
                            type: 'object' as const,
                            properties: {
                                url: { type: 'string' as const },
                                confidence: { type: 'number' as const },
                                reasoning: { type: 'string' as const },
                            },
                            required: ['url', 'confidence', 'reasoning'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['candidates'],
                additionalProperties: false,
            };

            const result = await LLMService.completeStructured<{ candidates: Array<{ url: string; confidence: number; reasoning: string }> }>(
                prompt,
                schema,
                model
            );

            if (!result || !result.candidates || result.candidates.length === 0) {
                Logger.info(`[LLMOracle] No candidates returned for "${company.company_name}"`);
                return null;
            }

            // Validate and normalize URLs
            const validCandidates = result.candidates
                .filter(c => c.url && c.url.includes('.') && c.confidence > 0.3)
                .map(c => ({
                    url: c.url.startsWith('http') ? c.url : `https://${c.url}`,
                    confidence: Math.min(c.confidence, 0.85), // Cap at 0.85 — LLM can hallucinate
                    reasoning: c.reasoning || '',
                }))
                .slice(0, 5);

            const oracleResult: OracleResult = {
                candidates: validCandidates,
                model,
            };

            // Cache the result
            if (oracleCache.size >= MAX_CACHE_SIZE) {
                // Evict oldest entry
                const firstKey = oracleCache.keys().next().value;
                if (firstKey) oracleCache.delete(firstKey);
            }
            oracleCache.set(cacheKey, oracleResult);

            Logger.info(`[LLMOracle] Inferred ${validCandidates.length} candidates for "${company.company_name}" via ${model}`);
            return oracleResult;

        } catch (error) {
            Logger.warn(`[LLMOracle] Inference failed for "${company.company_name}"`, { error: error as Error });
            return null;
        }
    }

    private static buildPrompt(company: CompanyInput): string {
        const name = company.company_name;
        const city = company.city || 'unknown city';
        const province = company.province || '';
        const category = company.category || 'unknown sector';

        return `You are a domain name inference engine for Italian companies.

Analyze the company "${name}" located in "${city}" (${province}), sector: "${category}".

Your task:
1. Is this a well-known local entity? If yes, recall the URL from your training data.
2. If not well-known, construct the most likely domain based on Italian SME naming conventions:
   - Most Italian SMEs use {companyname}.it
   - Legal suffixes (SRL, SPA, SNC) are usually stripped from domains
   - Some use {name}{city}.it or {name}{sector}.it
3. Consider common patterns: {brand}.it, {brand}.com, {firstname}{lastname}.it

Output a JSON with candidate URLs and confidence scores (0.0-1.0).
Higher confidence = more certain. Only include candidates you believe actually exist.
If you have no idea, return an empty candidates array.`;
    }

    private static buildCacheKey(company: CompanyInput): string {
        const name = (company.company_name || '').toLowerCase().trim();
        const city = (company.city || '').toLowerCase().trim();
        return `${name}|${city}`;
    }
}
