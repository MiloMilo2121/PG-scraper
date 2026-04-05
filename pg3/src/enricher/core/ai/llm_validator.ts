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
    private static readonly REJECT_HOST_MARKERS = [
        'paginegialle.it',
        'facebook.com',
        'linkedin.com',
        'instagram.com',
        'tripadvisor.',
        'trustpilot.',
        'yelp.',
        'kompass.',
        'infobel.',
        'misterimprese.',
        'europages.',
        'tuttocitta.',
        'amazon.',
        'ebay.',
    ];

    private static readonly REJECT_PATH_MARKERS = [
        '/jobs',
        '/job',
        '/news',
        '/blog',
        '/post/',
        '/posts/',
        '/article',
        '/articles/',
        '/listing',
        '/directory',
        '/reviews',
        '/recensioni',
    ];

    private static getCompanyTokens(company: CompanyInput): string[] {
        return String(company.company_name || '')
            .toLowerCase()
            .replace(/s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|sas|srl|spa|snc/gi, ' ')
            .split(/\s+/)
            .map((token) => token.replace(/[^a-z0-9]/gi, ''))
            .filter((token) => token.length >= 3);
    }

    private static normalizeHost(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            return '';
        }
    }

    private static looksLikeRejectedUrl(url: string): boolean {
        const host = this.normalizeHost(url);
        const lowerUrl = url.toLowerCase();
        return this.REJECT_HOST_MARKERS.some((marker) => host.includes(marker))
            || this.REJECT_PATH_MARKERS.some((marker) => lowerUrl.includes(marker));
    }

    private static scoreSerpCandidate(
        company: CompanyInput,
        candidate: { url: string; title: string; snippet: string }
    ): { score: number; rejected: boolean; signals: string[] } {
        const companyTokens = this.getCompanyTokens(company);
        const city = String(company.city || '').toLowerCase();
        const title = String(candidate.title || '').toLowerCase();
        const snippet = String(candidate.snippet || '').toLowerCase();
        const haystack = `${title} ${snippet}`;
        const host = this.normalizeHost(candidate.url);
        const domainBase = host.split('.').slice(0, -1).join('.');
        const signals: string[] = [];

        if (!candidate.url || this.looksLikeRejectedUrl(candidate.url)) {
            return {
                score: Number.NEGATIVE_INFINITY,
                rejected: true,
                signals: ['rejected_directory_or_social'],
            };
        }

        let score = 0;
        const tokenMatches = companyTokens.filter((token) => haystack.includes(token) || domainBase.includes(token));
        if (tokenMatches.length > 0) {
            score += tokenMatches.length * 2.5;
            signals.push('company_token_match');
        }

        if (company.company_name && title.includes(String(company.company_name).toLowerCase())) {
            score += 2.5;
            signals.push('title_exact_name');
        }

        if (city && haystack.includes(city)) {
            score += 1.5;
            signals.push('city_match');
        }

        if (!candidate.url.includes('/', candidate.url.indexOf(host) + host.length + 1)) {
            score += 1;
            signals.push('shallow_homepage');
        }

        if (domainBase && companyTokens.some((token) => domainBase.includes(token))) {
            score += 2;
            signals.push('domain_brand_match');
        }

        if (/contatti|chi siamo|azienda|home|homepage/i.test(candidate.title) || /contatti|chi siamo|azienda/i.test(candidate.url)) {
            score += 0.75;
            signals.push('official_page_shape');
        }

        if (/directory|recensioni|reviews|tripadvisor|linkedin|facebook|instagram/i.test(haystack)) {
            score -= 4;
            signals.push('weak_context_penalty');
        }

        return { score, rejected: false, signals };
    }

    private static deterministicBestUrl(
        company: CompanyInput,
        serpResults: Array<{ url: string; title: string; snippet: string }>
    ): { bestUrl: string | null; confidence: number; reasoning: string; signals: string[] } {
        const scored = serpResults
            .map((candidate) => ({
                candidate,
                ...this.scoreSerpCandidate(company, candidate),
            }))
            .filter((entry) => !entry.rejected)
            .sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (!best || best.score < 3.5) {
            return {
                bestUrl: null,
                confidence: 0.1,
                reasoning: 'No non-directory/social result with sufficient entity evidence',
                signals: best?.signals || ['no_safe_candidate'],
            };
        }

        const confidence = Math.max(0.35, Math.min(0.79, Number((0.35 + (best.score / 12)).toFixed(2))));
        return {
            bestUrl: best.candidate.url,
            confidence,
            reasoning: 'Deterministic fallback selected the strongest non-directory candidate',
            signals: best.signals,
        };
    }

    private static isSafeSelectedUrl(url: string | null | undefined): boolean {
        return !!url && !this.looksLikeRejectedUrl(url);
    }

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
        const cleaned = HTMLCleaner.extract(scrapedHtml, 4000, true);
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
                modelChain.slice(1),
                VALIDATE_COMPANY_PROMPT.system,
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
                const legacyRes = await LLMService.completeJSON<ValidationResult>(prompt, VALIDATE_COMPANY_PROMPT.system);
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
                selModelChain.slice(1),
                SELECT_BEST_URL_PROMPT.system,
            );

            if (res && typeof res.confidence === 'number') {
                if (res.bestUrl && !this.isSafeSelectedUrl(res.bestUrl)) {
                    return this.deterministicBestUrl(company, serpResults);
                }
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

        return this.deterministicBestUrl(company, serpResults);
    }
}
