import { SearchProvider } from './search_provider';
import { SerpResult } from './serp_analyzer';
import { Logger } from '../../utils/logger';
import { Retry } from '../../../utils/decorators';
import { config } from '../../../shared-runtime/config/runtime_config';

export class PerplexityProvider implements SearchProvider {
    id = 'PERPLEXITY-API-4'; // Tier 4 Oracle
    tier = 4;
    costPerRequest = 0.01; // Example low cost for tier ranking

    @Retry({ attempts: 2, delay: 5000, backoff: 'exponential' })
    async search(query: string, maxResults: number = 3): Promise<SerpResult[]> {
        if (!config.features.perplexityEnabled) {
            throw new Error('DISCOVERY_PERPLEXITY_ENABLED is false. Perplexity provider is disabled.');
        }

        if (!process.env.PERPLEXITY_API_KEY) {
            throw new Error('PERPLEXITY_API_KEY is missing. Skipping Sonar Oracle.');
        }

        Logger.info(`[PerplexityProvider] 🔮 Consulting Sonar Pro Oracle: ${query}`);

        // Extract parameters heavily optimized from Gemma 3 logic
        // The query builder usually passes a string like "NomeAzienda Milano sito web ufficiale"
        // We inject the Sonar specific prompt directly here using the query string.
        const sonarPrompt = `Qual è il sito web ufficiale (www o https) dell'azienda italiana descritta da: "${query}"? Pensa come un esperto di Open Source Intelligence (OSINT). Rispondi SOLO ed ESCLUSIVAMENTE con l'URL senza nessuna punteggiatura o parola aggiuntiva. Se non ne sei assolutamente certo, rispondi "NULL".`;

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar-pro',
                messages: [{ role: 'user', content: sonarPrompt }],
                temperature: 0.1,
                max_tokens: 50
            })
        });

        if (!response.ok) {
            // Throw generic error to let CostRouter retry or fallback
            // In a real system, handle 429 specifically for rate limiting
            throw new Error(`Perplexity API Error: ${response.status}`);
        }

        const data: any = await response.json();
        const content = data.choices && data.choices[0]?.message?.content?.trim();

        const results: SerpResult[] = [];

        if (content && content !== 'NULL' && content !== 'null' && content.includes('.')) {
            let url = content.toLowerCase().replace(/['"<>]/g, '');
            if (!url.startsWith('http')) {
                url = 'https://' + url;
            }
            Logger.info(`[PerplexityProvider] 🎯 SONAR ORACLE BINGO: ${url}`);

            results.push({
                url,
                title: 'Perplexity Sonar Prediction',
                source: 'perplexity_sonar',
            } as any);
        } else {
            Logger.warn(`[PerplexityProvider] Oracle failed to predict or returned NULL.`);
        }

        return results;
    }

    async getCredits(): Promise<number> {
        // Mock credits or check API
        return 1000;
    }
}
