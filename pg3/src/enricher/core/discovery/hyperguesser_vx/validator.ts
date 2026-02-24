import { LLMService } from '../../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../../ai/model_router';
import { FetchedCandidate } from './fetcher';
import { CompanyInput } from '../../../types';
import { Logger } from '../../../utils/logger';

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
                selected_url: { type: "string", description: "The exact URL of the authentic website, or null if absolutely none match." },
                confidence: { type: "number", description: "0.0 to 1.0 confidence score that the selected URL belongs to the target company." },
                reason: { type: "string", description: "Brief explanation of why this URL was chosen based on the provided text." }
            },
            required: ["selected_url", "confidence", "reason"]
        };

        try {
            // Using MODERATE difficulty to route directly to fast/cheap models like glm-4.7-flash
            const modelChain = ModelRouter.selectModelChain(TaskDifficulty.MODERATE);
            const parsed = await LLMService.completeStructured<TriageResult>(prompt, schema, modelChain[0], modelChain.slice(1));

            if (!parsed) {
                return { selected_url: null, confidence: 0, reason: "AI returned null or failed to parse properly." };
            }

            Logger.info(`[HyperGuesserVX] AI Triage Complete -> ${parsed.selected_url || 'NONE'} (Conf: ${parsed.confidence})`);
            return parsed;

        } catch (e: any) {
            Logger.warn(`[HyperGuesserVX] AI Triage Failed: ${e.message}`);
            return { selected_url: null, confidence: 0, reason: `Validation error: ${e.message}` };
        }
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
