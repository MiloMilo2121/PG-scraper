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
        try {
            if (goal === 'vat') {
                const vat = await aiService.searchVAT(companyName, city);
                if (vat) {
                    return [
                        `"${companyName}" "${vat}"`,
                        `"${companyName}" "Partita IVA ${vat}"`,
                        `"${vat}" "${city || 'Italia'}"`,
                    ];
                }
            }
            if (goal === 'website') {
                return [
                    `"${companyName}" ${city || ''} site:.it`,
                    `"${companyName}" "${city || ''}" sito ufficiale`,
                    `"${companyName}" "${city || ''}" contatti`,
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
        city: string | undefined,
        goal: string
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
