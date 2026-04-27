import { Logger } from './logger';
import { LeadData, ScoreBreakdown } from './lead_scorer_v2';

export interface GerikoScoreBreakdown extends Omit<ScoreBreakdown, 'category'> {
    category: 'SEGMENTO_A' | 'SEGMENTO_C' | 'SEGMENTO_B' | 'ANTI_TARGET';
    gerikoComponents: {
        marketingPropensity: number;
        teamStructure: number;
        negativeSignals: number;
    };
}

export class GerikoScorer {
    /**
     * Calculate Geriko ICP Score
     * Focus: "readiness-based", Open House, Process-driven, 4-15 people
     */
    static score(lead: LeadData & { websiteContent?: string }): GerikoScoreBreakdown {
        // Base scoring
        const marketing = this.scoreMarketing(lead);
        const team = this.scoreTeam(lead);
        const negatives = this.scoreNegatives(lead);

        const totalGeriko = Math.round(marketing + team - negatives);
        
        // Define final category based on Geriko ICP rules
        const category = this.categorize(totalGeriko, negatives, lead);

        return {
            total: totalGeriko,
            category,
            components: { contact: 0, data: 0, website: 0 }, // fallback per compatibilità
            gerikoComponents: {
                marketingPropensity: marketing,
                teamStructure: team,
                negativeSignals: negatives
            }
        };
    }

    private static scoreMarketing(lead: LeadData & { websiteContent?: string }): number {
        let score = 0;
        const content = (lead.websiteContent || lead.company_name || '').toLowerCase();

        // Strong signals (Segment A)
        if (content.includes('open house') || content.includes('openhouse')) score += 35;
        if (content.includes('visita virtuale') || content.includes('virtual tour') || content.includes('3d')) score += 20;
        if (content.includes('multiproposta') || content.includes('metodo')) score += 15;
        if (content.includes('home staging')) score += 10;

        return Math.min(80, score);
    }

    private static scoreTeam(lead: LeadData & { websiteContent?: string }): number {
        let score = 0;
        const content = (lead.websiteContent || '').toLowerCase();

        // Indicatori di agenzia strutturata (4-15 persone, Segmento A)
        if (content.includes('il nostro team') || content.includes('chi siamo')) score += 10;
        if (content.includes('entra nel team') || content.includes('lavora con noi')) score += 10;
        
        // Se c'è un numero di dipendenti esplicito nei dati aziendali
        if (lead.employees) {
            const empStr = lead.employees.toString();
            if (empStr.includes('5') || empStr.includes('10') || empStr.includes('15')) {
                score += 20; // Sweet spot
            } else if (empStr === '1' || empStr === '2') {
                score += 5; // Troppo piccola
            } else {
                score += 10; 
            }
        }

        return Math.min(40, score);
    }

    private static scoreNegatives(lead: LeadData & { websiteContent?: string }): number {
        let score = 0;
        const content = (lead.websiteContent || '').toLowerCase();
        const name = (lead.company_name || '').toLowerCase();

        // Anti-Target Segment D (Grandi Franchising - dovrebbero essere già esclusi, ma controllo extra)
        const antiTargetBrands = ['tecnocasa', 'gabetti', 'tempocasa', 'remax', 're/max', 'professionecasa', 'toscano'];
        if (antiTargetBrands.some(b => name.includes(b))) score += 100; // Istant-kill

        // Anti-Target Segment B (Solo Affitti, Niente acquirenti)
        if (name.includes('solo affitti') || content.includes('specializzati in affitti')) score += 100;

        // Anti-Target Aste Giudiziarie (Rischio reputazionale per Geriko)
        if (content.includes('aste giudiziarie') || content.includes('saldo e stralcio')) score += 100;

        // Anti-Target Extra-Lusso Puro (Non prioritario)
        if (name.includes('luxury') && !content.includes('residenziale')) score += 30;

        return score;
    }

    private static categorize(score: number, negatives: number, lead: LeadData): 'SEGMENTO_A' | 'SEGMENTO_C' | 'SEGMENTO_B' | 'ANTI_TARGET' {
        if (negatives >= 100) return 'ANTI_TARGET';
        
        // Criteri per segmento A (High-need, process-driven)
        if (score >= 45) return 'SEGMENTO_A';
        
        // Criteri per Segmento C (Piccoli franchising/locali, score medio)
        if (score >= 15) return 'SEGMENTO_C';

        // Il resto cade nel segmento B (bassa domanda o poca propensione)
        return 'SEGMENTO_B';
    }

    static filterAndSortTargetA(leads: (LeadData & { websiteContent?: string })[]): (LeadData & GerikoScoreBreakdown)[] {
        return leads
            .map(lead => ({ ...lead, ...this.score(lead) }))
            .filter(lead => lead.category === 'SEGMENTO_A')
            .sort((a, b) => b.total - a.total);
    }
}
