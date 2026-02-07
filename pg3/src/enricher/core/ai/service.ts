/**
 * 🧠 AI SERVICE - OpenAI Integration
 * Tasks 21-30: Complete AI intelligence layer
 * 
 * Features:
 * - HTML minification for token savings (Task 22)
 * - Business classification (Task 23)
 * - Hidden contact extraction (Task 24)
 * - Adaptive model selection (Task 28)
 * - Response caching (Task 27)
 * - Token analytics (Task 30)
 */

import OpenAI from 'openai';
import * as crypto from 'crypto';
import { Logger } from '../../utils/logger';
import { config } from '../../config';

const AI_MODEL_FAST = config.llm.fastModel;
const AI_MODEL_SMART = config.llm.smartModel;
const AI_MAX_TOKENS = config.llm.maxTokens;
const AI_CACHE_MAX_ENTRIES = config.ai.cacheMaxEntries;
const AI_CACHE_TTL_MS = config.ai.cacheTtlMs;

// Simple in-memory cache (Redis TODO)
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
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
        });
        this.fastModel = AI_MODEL_FAST;
        this.smartModel = AI_MODEL_SMART;
    }

    /**
     * Task 22: Minify HTML to reduce tokens
     */
    private minifyHTML(html: string): string {
        return html
            // Remove scripts
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            // Remove styles
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            // Remove SVG
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
            // Remove comments
            .replace(/<!--[\s\S]*?-->/g, '')
            // Remove excessive whitespace
            .replace(/\s+/g, ' ')
            // Remove common useless tags
            .replace(/<(?:meta|link|noscript)[^>]*>/gi, '')
            // Limit length
            .substring(0, 8000);
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
        taskType: 'extract' | 'classify' | 'search'
    ): Promise<string> {
        const model = this.selectModel(taskType);
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
    async extractContacts(html: string, companyName: string): Promise<AIExtractionResult> {
        const minified = this.minifyHTML(html);

        const prompt = `Extract business contact information from this webpage for "${companyName}".
Look for:
1. VAT number (Partita IVA) - 11 digit Italian number
2. PEC email (ends with @pec, @legalmail, @arubapec)
3. CEO/Owner name
4. Phone numbers (especially mobile +39 3xx)
5. Email addresses (especially personal ones, not info@)

Return ONLY valid JSON:
{
  "vat": "12345678901" or null,
  "pec": "example@pec.it" or null,
  "ceo_name": "Mario Rossi" or null,
  "phone": "+39 3xx xxx xxxx" or null,
  "email": "personal@domain.it" or null,
  "confidence": 0.0-1.0
}

Text:
${minified}`;

        try {
            const response = await this.call(prompt, 'extract');
            return JSON.parse(response);
        } catch {
            return { confidence: 0 };
        }
    }

    /**
     * Task 23: Classify business type
     */
    async classifyBusiness(html: string, companyName: string): Promise<{
        type: 'B2B' | 'B2C' | 'BOTH' | 'UNKNOWN';
        sector: string;
        confidence: number;
    }> {
        const minified = this.minifyHTML(html);

        const prompt = `Analyze this company homepage and classify:

Company: "${companyName}"

Questions:
1. Is this company B2B (sells to businesses), B2C (sells to consumers), or BOTH?
2. What is the primary industry sector?

Return ONLY valid JSON:
{
  "type": "B2B" | "B2C" | "BOTH" | "UNKNOWN",
  "sector": "Manufacturing" | "Services" | "Retail" | "Technology" | "Healthcare" | "Other",
  "confidence": 0.0-1.0
}

Text:
${minified.substring(0, 4000)}`;

        try {
            const response = await this.call(prompt, 'classify');
            return JSON.parse(response);
        } catch {
            return { type: 'UNKNOWN', sector: 'Unknown', confidence: 0 };
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
            return true; // Default to accepting if AI fails
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
        // Approximate pricing (GPT-4o-mini)
        const inputCost = (totalInputTokens / 1000000) * 0.15;
        const outputCost = (totalOutputTokens / 1000000) * 0.60;

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
