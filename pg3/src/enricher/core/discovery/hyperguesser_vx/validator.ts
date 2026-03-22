import { LLMService } from '../../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../../ai/model_router';
import { FetchedCandidate } from './fetcher';
import { CompanyInput } from '../../../types';
import { Logger } from '../../../utils/logger';
import { ContentFilter } from '../content_filter';

export interface TriageResult {
    selected_url: string | null;
    confidence: number;
    reason: string;
}

export class HyperGuesserVXValidator {
    /**
     * Sends all scraped domain texts to the LLM (GLM-4.7-Flash) in a single batch
     * asking it to determine the real website among the candidates.
     */
    static async validateBatch(company: CompanyInput, candidates: FetchedCandidate[]): Promise<TriageResult> {
        if (!candidates.length) {
            return { selected_url: null, confidence: 0, reason: "No candidates to validate." };
        }

        Logger.info(`[HyperGuesserVX] Sending ${candidates.length} candidate texts to AI for Triage...`);

        const prompt = this.buildPrompt(company, candidates);
        const schema = {
            type: "object",
            properties: {
                selected_url: {
                    anyOf: [
                        { type: "string" },
                        { type: "null" }
                    ],
                    description: "The exact URL of the authentic website, or null if absolutely none match."
                },
                confidence: { type: "number", description: "0.0 to 1.0 confidence score that the selected URL belongs to the target company." },
                reason: { type: "string", description: "Brief explanation of why this URL was chosen based on the provided text." }
            },
            required: ["selected_url", "confidence", "reason"],
            additionalProperties: false
        };

        const deterministicFallback = this.selectDeterministicCandidate(company, candidates);

        try {
            const modelChain = this.buildModelChain();
            const parsed = await LLMService.completeStructured<TriageResult>(prompt, schema, modelChain[0], modelChain.slice(1));

            if (!parsed) {
                return deterministicFallback ?? { selected_url: null, confidence: 0, reason: "AI returned null or failed to parse properly." };
            }

            if ((!parsed.selected_url || parsed.confidence < 0.70) && deterministicFallback) {
                return deterministicFallback;
            }

            Logger.info(`[HyperGuesserVX] AI Triage Complete -> ${parsed.selected_url || 'NONE'} (Conf: ${parsed.confidence})`);
            return parsed;

        } catch (e: any) {
            Logger.warn(`[HyperGuesserVX] AI Triage Failed: ${e.message}`);
            return deterministicFallback ?? { selected_url: null, confidence: 0, reason: `Validation error: ${e.message}` };
        }
    }

    private static buildModelChain(): string[] {
        const preferred = ['gpt-4o-mini', ...ModelRouter.selectModelChain(TaskDifficulty.MODERATE)];
        return Array.from(new Set(preferred));
    }

    private static selectDeterministicCandidate(company: CompanyInput, candidates: FetchedCandidate[]): TriageResult | null {
        const scored = candidates
            .map((candidate) => ({
                candidate,
                score: this.scoreCandidate(company, candidate),
            }))
            .sort((left, right) => right.score - left.score);

        const best = scored[0];
        if (!best || best.score < 0.72) {
            return null;
        }

        return {
            selected_url: best.candidate.url,
            confidence: Number(Math.min(0.89, best.score).toFixed(2)),
            reason: 'Deterministic fallback selected the strongest domain/title/company match.',
        };
    }

    private static scoreCandidate(company: CompanyInput, candidate: FetchedCandidate): number {
        const title = (candidate.title || '').toLowerCase();
        const body = (candidate.text || '').toLowerCase();
        const companyTokens = this.companyTokens(company.company_name || '');
        const compactVariants = this.companyCompactVariants(company.company_name || '');

        const titleMatches = companyTokens.filter((token) => title.includes(token));
        const bodyMatches = companyTokens.filter((token) => body.includes(token));

        let score = 0;

        if (companyTokens.length > 0) {
            score += (titleMatches.length / companyTokens.length) * 0.45;
            score += (bodyMatches.length / companyTokens.length) * 0.25;
        }

        let domainSlug = '';
        try {
            domainSlug = new URL(candidate.url).hostname.replace(/^www\./i, '').split('.')[0].toLowerCase();
        } catch {
            domainSlug = '';
        }

        if (compactVariants.some((variant) => domainSlug === variant)) {
            score += 0.30;
        } else if (compactVariants.some((variant) => domainSlug.includes(variant) || variant.includes(domainSlug))) {
            score += 0.18;
        }

        const locationSignals = [company.city, company.province]
            .filter(Boolean)
            .map((value) => (value || '').toLowerCase());
        if (locationSignals.some((signal) => signal && (title.includes(signal) || body.includes(signal)))) {
            score += 0.10;
        }

        if (ContentFilter.isDirectoryOrSocial(candidate.url)) {
            score -= 0.60;
        }
        if (ContentFilter.isDirectoryLikeTitle(candidate.title || '')) {
            score -= 0.20;
        }

        return Math.max(0, score);
    }

    private static companyTokens(companyName: string): string[] {
        return Array.from(new Set(
            companyName
                .toLowerCase()
                .replace(/s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societa'?|unipersonale|in liquidazione/gi, ' ')
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((token) => token.length >= 4)
        ));
    }

    private static companyCompactVariants(companyName: string): string[] {
        const normalized = companyName
            .toLowerCase()
            .replace(/s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societa'?|unipersonale|in liquidazione/gi, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .trim();

        const compact = normalized.replace(/\s+/g, '');
        const tokens = normalized.split(/\s+/).filter((token) => token.length >= 4);
        const firstTwo = tokens.slice(0, 2).join('');

        return Array.from(new Set([compact, firstTwo].filter((variant) => variant.length >= 4)));
    }

    private static buildPrompt(comp: CompanyInput, candidates: FetchedCandidate[]): string {
        const candidatesText = candidates.map((c, i) => `
--- SITO CANDIDATO ${i + 1} ---
URL: ${c.url}
TITOLO PAGINA: ${c.title}
TESTO ESTRATTO (Raw HTML testo):
${c.text}
------------------------
        `).join('\n');

        return `
Sei un investigatore OSINT esperto in aziende italiane. 
Ho estratto il testo grezzo (raw text) da ${candidates.length} siti web plausibili. 

L'azienda che stiamo cercando è la seguente:
Nome: ${comp.company_name}
Indirizzo: IN VIA ${comp.address || 'Non specificato'}, ${comp.city} (${comp.province})
Settore: ${comp.category || 'Non specificato'}
Partita IVA: ${comp.vat_code || 'Non specificata'}
Telefono: ${comp.phone || 'Non specificato'}

Domanda: leggendo i testi qui sotto, quale di questi ${candidates.length} testi appartiene al SITO UFFICIALE dell'azienda?
Devi cercare corrispondenze di nomi, vie, città, numeri civici, settori merceologici o telefoni.

${candidatesText}

Se trovi il sito ufficiale autentico al 100%, restituisci il suo "selected_url" e una confidence alta (0.8 - 1.0).
Se NESSUNO dei testi corrisponde minimamente all'azienda in questione (es. sono siti parcheggiati, agenzie web, o omonimi in altre città senza legami), restituisci null come "selected_url" e confidence 0. Sii molto severo.

IMPORTANTE: La tua risposta deve essere unicamente in formato JSON valido, aderente allo schema richiesto.
        `;
    }
}
