import { NormalizedInput } from './InputNormalizer';
import { BrowserPool } from './BrowserPool';
import { LLMService } from '../enricher/core/ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../enricher/core/ai/model_router';

export class EnrichmentPostProcessor {
    private browserPool: BrowserPool;

    constructor(browserPool: BrowserPool) {
        this.browserPool = browserPool;
    }

    /**
     * GEMMA 5: AI EMPLOYEE ESTIMATOR
     * Scarica la pagina Chi Siamo, la pulisce e chiede all'LLM di stimare il tier.
     */
    public async estimateEmployees(companyId: string, input: NormalizedInput, discoveredUrl: string): Promise<string | null> {
        try {
            console.log(`[EnrichmentPostProcessor] 🧠 Estimating employees for ${input.company_name} from ${discoveredUrl}`);

            // 1. Fetch Homepage or "Chi Siamo" via Browser Pool
            // To be fast, we just grab HomePage as Italian sites often put "Chi siamo" in the same SPA or homepage text.
            const nav = await this.browserPool.navigateSafe(discoveredUrl);

            if (nav.status !== 'OK' || !nav.html) {
                console.warn(`[EnrichmentPostProcessor] Failed to load ${discoveredUrl}`);
                return null;
            }

            // Clean noise (similar to old IdentityResolver distillContent but using regex for speed without cheerios)
            let text = nav.html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (text.length < 300) {
                console.warn(`[EnrichmentPostProcessor] Text too short (<300 chars).`);
                return null;
            }

            // Ask AI using FREE LLM ModelRouter
            const prompt = `Analizza questo testo tratto dal sito web dell'azienda italiana "${input.company_name}".
        Stima il numero di dipendenti della società.
        Regole:
        1. Rispondi ESCLUSIVAMENTE con la stringa "1-10", "10-50", "50+", o "N/A" se il testo non contiene dati sufficienti.
        2. Non aggiungere spiegazioni.

        TESTO:
        ${text.slice(0, 10000)}`;

            const modelChain = ModelRouter.selectModelChain(TaskDifficulty.SIMPLE);
            const model = modelChain[0];
            const response = await LLMService.complete(prompt, model, modelChain.slice(1));

            const cleanResp = response.replace(/['"]/g, '').trim().toUpperCase();
            if (cleanResp === '1-10' || cleanResp === '10-50' || cleanResp === '50+') {
                console.log(`[EnrichmentPostProcessor] ✅ AI Estimated Employees: ${cleanResp}`);
                return cleanResp;
            }

            return null;

        } catch (e: any) {
            console.warn(`[EnrichmentPostProcessor] AI Employee Estimation failed for ${input.company_name}: ${e.message}`);
            return null;
        }
    }
}
