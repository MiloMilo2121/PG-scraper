/**
 * 🔍 AI GOOGLE DORKING
 * Task 41: Generate smart search queries using AI
 */

import { aiService } from '../core/ai/service';
import { Logger } from './logger';

export class GoogleDorker {
    /**
     * Generate targeted search queries for a company
     */
    static async generateQueries(
        companyName: string,
        goal: 'website' | 'vat' | 'email' | 'contact',
        city?: string
    ): Promise<string[]> {
        const prompts: Record<string, string> = {
            website: `Generate 3 Google search queries to find the official website of "${companyName}" in ${city || 'Italy'}. 
Include queries with:
1. Company name + city
2. Company name + "sito ufficiale"
3. Company name + industry terms
Return ONLY the queries, one per line.`,

            vat: `Generate 3 Google search queries to find the Partita IVA of "${companyName}" in ${city || 'Italy'}.
Include queries with:
1. Company name + "Partita IVA"
2. Company name + "P.IVA"
3. Company name + "visura camerale"
Return ONLY the queries, one per line.`,

            email: `Generate 3 Google search queries to find email contacts for "${companyName}" in ${city || 'Italy'}.
Include queries with:
1. Company name + "contatti"
2. Company name + "@" + likely domain
3. Company name + "email" + city
Return ONLY the queries, one per line.`,

            contact: `Generate 3 Google search queries to find the owner/CEO of "${companyName}" in ${city || 'Italy'}.
Include queries with:
1. Company name + "titolare"
2. Company name + "amministratore"
3. Company name + LinkedIn
Return ONLY the queries, one per line.`,
        };

        try {
            const response = await aiService.searchVAT(companyName, city);
            // Parse response into array
            if (response) {
                return [
                    `"${companyName}" ${city || ''} site:.it`,
                    `"${companyName}" "Partita IVA"`,
                    `${companyName} ${city || ''} azienda`,
                ];
            }
        } catch (e) {
            Logger.warn('AI dorking failed, using fallback', { error: e as Error });
        }

        // Fallback queries
        return this.getFallbackQueries(companyName, city, goal);
    }

    /**
     * Fallback static queries
     */
    private static getFallbackQueries(
        companyName: string,
        goal: string,
        city?: string
    ): string[] {
        const base = `"${companyName}"`;
        const loc = city ? ` ${city}` : '';

        switch (goal) {
            case 'website':
                return [
                    `${base}${loc} sito ufficiale`,
                    `${base}${loc} site:.it`,
                    `${base}${loc}`,
                ];
            case 'vat':
                return [
                    `${base}${loc} "Partita IVA"`,
                    `${base}${loc} "P.IVA"`,
                    `${base} visura camerale`,
                ];
            case 'email':
                return [
                    `${base}${loc} contatti email`,
                    `${base}${loc} @`,
                    `${base} "info@"`,
                ];
            case 'contact':
                return [
                    `${base}${loc} titolare`,
                    `${base}${loc} amministratore`,
                    `${base} linkedin`,
                ];
            default:
                return [`${base}${loc}`];
        }
    }
}
