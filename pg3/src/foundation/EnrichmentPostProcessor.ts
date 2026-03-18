import { NormalizedInput } from './InputNormalizer';
import { BrowserPool } from './BrowserPool';
import { LLMService } from '../enricher/core/ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../enricher/core/ai/model_router';

export class EnrichmentPostProcessor {
    private browserPool: BrowserPool;
    private static readonly candidatePaths = ['', '/chi-siamo', '/azienda', '/about', '/about-us', '/company', '/profilo-aziendale'];
    private static readonly employeeCountRegexes = [
        /\b(\d{1,4})\s+(?:dipendenti|collaboratori|persone in organico|addetti)\b/i,
        /\bteam\s+di\s+(\d{1,4})\b/i,
        /\borganico\s+(?:di|composto da)\s+(\d{1,4})\b/i,
    ];
    private static readonly employeeRangeRegexes: Array<{ pattern: RegExp; value: string }> = [
        { pattern: /\b(?:microimpresa|piccolo team|team snello|bottega artigiana)\b/i, value: '1-10' },
        { pattern: /\b(?:decine di dipendenti|oltre 10 dipendenti|azienda strutturata)\b/i, value: '10-50' },
        { pattern: /\b(?:oltre 50 dipendenti|piu[ùu] di 50 dipendenti|gruppo industriale)\b/i, value: '50+' },
    ];

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

            const text = await this.loadCandidateText(discoveredUrl);
            if (!text) {
                console.warn(`[EnrichmentPostProcessor] Failed to load ${discoveredUrl}`);
                return null;
            }

            const heuristicEstimate = EnrichmentPostProcessor.estimateFromText(text);
            if (heuristicEstimate) {
                console.log(`[EnrichmentPostProcessor] ✅ Heuristic Estimated Employees: ${heuristicEstimate}`);
                return heuristicEstimate;
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

    private async loadCandidateText(discoveredUrl: string): Promise<string | null> {
        const chunks: string[] = [];
        const seen = new Set<string>();

        for (const path of EnrichmentPostProcessor.candidatePaths) {
            const url = this.resolveUrl(discoveredUrl, path);
            if (!url || seen.has(url)) {
                continue;
            }
            seen.add(url);

            const nav = await this.browserPool.navigateSafe(url);
            if (nav.status !== 'OK' || !nav.html) {
                continue;
            }

            const cleaned = EnrichmentPostProcessor.cleanHtml(nav.html);
            if (cleaned.length >= 40) {
                chunks.push(cleaned);
            }
            if (chunks.join(' ').length >= 2000) {
                break;
            }
        }

        const combined = chunks.join('\n');
        return combined.length >= 40 ? combined : null;
    }

    private resolveUrl(baseUrl: string, path: string): string | null {
        try {
            return path ? new URL(path, baseUrl).toString() : baseUrl;
        } catch {
            return path ? null : baseUrl;
        }
    }

    private static cleanHtml(html: string): string {
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private static estimateFromText(text: string): string | null {
        for (const { pattern, value } of EnrichmentPostProcessor.employeeRangeRegexes) {
            if (pattern.test(text)) {
                return value;
            }
        }

        for (const pattern of EnrichmentPostProcessor.employeeCountRegexes) {
            const match = text.match(pattern);
            if (!match) {
                continue;
            }

            const count = Number.parseInt(match[1], 10);
            if (!Number.isFinite(count) || count <= 0) {
                continue;
            }
            if (count <= 10) {
                return '1-10';
            }
            if (count <= 50) {
                return '10-50';
            }
            return '50+';
        }

        return null;
    }
}
