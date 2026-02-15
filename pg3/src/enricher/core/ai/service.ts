/**
 * 🧠 AI SERVICE — Business Intelligence Layer
 * Tasks 21-30: Contact extraction, classification, navigation, VAT search.
 *
 * Uses LLMService.getClient() for provider-agnostic LLM access.
 * Features: HTML minification, caching (Law 503), adaptive model selection (Law 505).
 */

import OpenAI from 'openai';
import * as crypto from 'crypto';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { LLMService } from './llm_service';
import { HTMLCleaner } from '../../utils/html_cleaner';
import { EXTRACT_CONTACTS_PROMPT, CLASSIFY_BUSINESS_PROMPT } from './prompt_templates';

const AI_MODEL_FAST = config.llm.fastModel;
const AI_MODEL_SMART = config.llm.smartModel;
const AI_MAX_TOKENS = config.llm.maxTokens;
const AI_CACHE_MAX_ENTRIES = config.ai.cacheMaxEntries;
const AI_CACHE_TTL_MS = config.ai.cacheTtlMs;

// Simple in-memory cache (Redis implementation pending scalability needs)
type CachedResponse = {
    response: string;
    tokens: number;
    cachedAt: number;
};
const responseCache: Map<string, CachedResponse> = new Map();

// Token usage tracking
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCacheHits = 0;

function getFromCache(cacheKey: string): CachedResponse | null {
    const cached = responseCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    if (Date.now() - cached.cachedAt > AI_CACHE_TTL_MS) {
        responseCache.delete(cacheKey);
        return null;
    }

    // Refresh insertion order for LRU-like eviction.
    responseCache.delete(cacheKey);
    responseCache.set(cacheKey, cached);
    return cached;
}

function setCache(cacheKey: string, entry: Omit<CachedResponse, 'cachedAt'>): void {
    responseCache.set(cacheKey, {
        ...entry,
        cachedAt: Date.now(),
    });

    while (responseCache.size > AI_CACHE_MAX_ENTRIES) {
        const oldestKey = responseCache.keys().next().value;
        if (!oldestKey) {
            break;
        }
        responseCache.delete(oldestKey);
    }
}

export interface AIExtractionResult {
    vat?: string;
    email?: string;
    phone?: string;
    pec?: string;
    ceo_name?: string;
    business_type?: 'B2B' | 'B2C' | 'BOTH' | 'UNKNOWN';
    sector?: string;
    confidence: number;
}

export class AIService {
    private openai: OpenAI;
    private fastModel: string;
    private smartModel: string;

    constructor() {
        // Use centralized LLMService client (Z.ai or OpenAI)
        this.openai = LLMService.getClient();
        this.fastModel = AI_MODEL_FAST;
        this.smartModel = AI_MODEL_SMART;
    }

    /**
     * Task 22: Clean HTML intelligently (deprecated regex replaced with HTMLCleaner)
     * @deprecated Use HTMLCleaner.extract() or HTMLCleaner.extractContactInfo() instead
     */
    private minifyHTML(html: string): string {
        return HTMLCleaner.minify(html);
    }

    /**
     * Task 27: Generate cache key from input
     */
    private getCacheKey(prompt: string, model: string): string {
        return crypto.createHash('md5').update(`${model}:${prompt}`).digest('hex');
    }

    /**
     * Task 28: Choose model based on task complexity
     */
    private selectModel(taskType: 'extract' | 'classify' | 'search'): string {
        switch (taskType) {
            case 'extract':
                return this.fastModel; // Simple pattern extraction
            case 'classify':
                return this.fastModel; // B2B/B2C classification
            case 'search':
                return this.smartModel; // Complex web search reasoning
            default:
                return this.fastModel;
        }
    }

    /**
     * 🔍 Core AI call with caching and analytics
     */
    private async call(
        prompt: string,
        taskType: 'extract' | 'classify' | 'search',
        forceSmartModel: boolean = false
    ): Promise<string> {
        const model = forceSmartModel ? this.smartModel : this.selectModel(taskType);
        const cacheKey = this.getCacheKey(prompt, model);

        // Check cache
        const cached = getFromCache(cacheKey);
        if (cached) {
            totalCacheHits += 1;
            Logger.info('🎯 AI cache hit', { model, tokens_saved: cached.tokens });
            return cached.response;
        }

        try {
            const completion = await this.openai.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: AI_MAX_TOKENS,
                temperature: 0.1, // Low temperature for factual extraction
            });

            const response = completion.choices[0]?.message?.content?.trim() || '';
            const inputTokens = completion.usage?.prompt_tokens || 0;
            const outputTokens = completion.usage?.completion_tokens || 0;

            // Task 30: Track token usage
            totalInputTokens += inputTokens;
            totalOutputTokens += outputTokens;

            // Cache response
            setCache(cacheKey, {
                response,
                tokens: inputTokens + outputTokens,
            });

            Logger.info('🤖 AI call completed', {
                model,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
            });

            return response;
        } catch (error) {
            Logger.logError('AI call failed', error as Error);
            throw error;
        }
    }

    /**
     * Task 24: Extract hidden contacts from text
     */
    async extractContacts(html: string, companyName: string = ''): Promise<AIExtractionResult> {
        // Use HTMLCleaner for intelligent contact info extraction (Law 501)
        const cleaned = HTMLCleaner.extract(html, 2500, true);
        const cleanText = HTMLCleaner.toString(cleaned);

        // Use structured prompt template
        const prompt = EXTRACT_CONTACTS_PROMPT.template({
            companyName: companyName || 'Unknown',
            cleanHtml: cleanText,
        });

        try {
            const response = await this.call(prompt, 'extract');
            const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanJson);

            // FALLBACK STRATEGY (Law 505): If confidence is low, escalate to Smart Model (GLM-5)
            if (!result.confidence || result.confidence < 0.6) {
                Logger.info(`[AIService] Low confidence (${result.confidence}) in contact extraction. Retrying with GLM-5...`);
                const smartResponse = await this.call(prompt, 'extract', true);
                const smartJson = smartResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(smartJson);
            }

            return result;
        } catch (error) {
            Logger.warn('[AIService] Contact extraction failed (Fast Model). Retrying with Smart Model...', { error: error as Error });
            try {
                const smartResponse = await this.call(prompt, 'extract', true);
                const smartJson = smartResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(smartJson);
            } catch (smartError) {
                Logger.error('[AIService] Contact extraction failed (Smart Model)', { error: smartError as Error });
                return { confidence: 0 };
            }
        }
    }

    /**
     * Task 23: Classify business type
     */
    async classifyBusiness(html: string, companyName: string): Promise<{
        type: 'B2B' | 'B2C' | 'BOTH' | 'UNKNOWN';
        sector: string;
        confidence: number;
        reasoning: string;
        tags?: string[];
    }> {
        // Use HTMLCleaner for intelligent extraction (Law 501)
        const cleaned = HTMLCleaner.extract(html, 3000, false);
        const cleanText = HTMLCleaner.toString(cleaned);

        // Use structured prompt template
        const prompt = CLASSIFY_BUSINESS_PROMPT.template({
            companyName,
            cleanHtml: cleanText,
        });

        try {
            const response = await this.call(prompt, 'classify');
            const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            let parsed = JSON.parse(cleanJson);

            // FALLBACK STRATEGY (Law 505): If confidence is low, escalate to Smart Model (GLM-5)
            if (!parsed.confidence || parsed.confidence < 0.6) {
                Logger.info(`[AIService] Low confidence (${parsed.confidence}) in classification. Retrying with GLM-5...`);
                const smartResponse = await this.call(prompt, 'classify', true);
                const smartJson = smartResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                parsed = JSON.parse(smartJson);
            }

            // Map new deductive fields to existing structure
            // E.g. sector = "Manufacturing (Precision Machining)"
            const fullSector = parsed.specific_niche
                ? `${parsed.primary_sector} (${parsed.specific_niche})`
                : parsed.primary_sector || parsed.sector || 'Unknown';

            if (parsed.deduced_tags && Array.isArray(parsed.deduced_tags)) {
                Logger.info(`[AIService] Deduced tags for ${companyName}: ${parsed.deduced_tags.join(', ')}`);
            }

            return {
                type: parsed.type || 'UNKNOWN',
                sector: fullSector,
                confidence: parsed.confidence || 0,
                reasoning: parsed.reasoning || '',
                tags: parsed.deduced_tags || []
            };
        } catch (error) {
            Logger.warn(`[AIService] Classification failed (Fast Model) for ${companyName}. Retrying with Smart Model...`, { error: error as Error });
            try {
                const smartResponse = await this.call(prompt, 'classify', true);
                const smartJson = smartResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(smartJson);

                const fullSector = parsed.specific_niche
                    ? `${parsed.primary_sector} (${parsed.specific_niche})`
                    : parsed.primary_sector || parsed.sector || 'Unknown';

                return {
                    type: parsed.type || 'UNKNOWN',
                    sector: fullSector,
                    confidence: parsed.confidence || 0,
                    reasoning: parsed.reasoning || '',
                    tags: parsed.deduced_tags || []
                };

            } catch (smartError) {
                Logger.error(`[AIService] Classification failed (Smart Model) for ${companyName}`, { error: smartError as Error });
                return { type: 'UNKNOWN', sector: 'Unknown', confidence: 0, reasoning: 'Classification failed' };
            }
        }
    }

    /**
     * Task 21: Search for VAT number using AI
     */
    async searchVAT(companyName: string, city?: string): Promise<string | null> {
        const prompt = `Find the Italian VAT number (Partita IVA) for this company:
Company: "${companyName}"
City: "${city || 'Italy'}"

A valid Italian Partita IVA is exactly 11 digits.

Return ONLY the 11-digit number if found, or "null" if not found.
Do not return any explanation or additional text.`;

        try {
            const response = await this.call(prompt, 'search');
            const cleaned = response.replace(/[^\d]/g, '');
            if (cleaned.length === 11) {
                return cleaned;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Task 25: AI Navigation Agent - suggest which link to click
     */
    async suggestNavigation(links: string[], goal: string): Promise<string | null> {
        const prompt = `You are navigating a website. Your goal: ${goal}

Available links on this page:
${links.slice(0, 20).map((l, i) => `${i + 1}. ${l}`).join('\n')}

Which link number is most likely to lead to the goal? 
Return ONLY the number (1-20) or "none" if no good match.`;

        try {
            const response = await this.call(prompt, 'classify');
            const num = parseInt(response.replace(/[^\d]/g, ''));
            if (num >= 1 && num <= links.length) {
                return links[num - 1];
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Task 26: Semantic VAT validation
     */
    async validateVATContext(vat: string, companyName: string, pageText: string): Promise<boolean> {
        const prompt = `In this text from a company webpage, determine if the VAT number "${vat}" actually belongs to the company "${companyName}".

Consider:
- Is the VAT in a footer or legal section?
- Is the company name mentioned near the VAT?
- Could this VAT belong to a different entity on the page?

Text excerpt:
${pageText.substring(0, 2000)}

Answer ONLY "yes" or "no".`;

        try {
            const response = await this.call(prompt, 'classify');
            return response.toLowerCase().includes('yes');
        } catch {
            return false; // Fail closed: don't accept VAT ownership when validation fails
        }
    }

    /**
     * Task 30: Get token usage statistics
     */
    getTokenStats(): {
        totalInputTokens: number;
        totalOutputTokens: number;
        estimatedCostUSD: number;
        cacheHits: number;
    } {
        // Approximate pricing (GLM-4-flash)
        const inputCost = (totalInputTokens / 1000000) * 0.10;
        const outputCost = (totalOutputTokens / 1000000) * 0.40;

        return {
            totalInputTokens,
            totalOutputTokens,
            estimatedCostUSD: inputCost + outputCost,
            cacheHits: totalCacheHits,
        };
    }

    /**
     * 🧹 Clear cache
     */
    clearCache(): void {
        responseCache.clear();
    }
}

export const aiService = new AIService();
