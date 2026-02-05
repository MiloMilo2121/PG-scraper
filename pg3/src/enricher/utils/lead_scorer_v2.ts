/**
 * 🏆 LEAD SCORING v2
 * Task 35: Weighted scoring algorithm
 * 
 * Score Components:
 * - Contact Quality: Personal email, mobile phone, CEO name
 * - Data Completeness: VAT, revenue, employees
 * - Website Quality: Valid domain, SSL, relevance
 */

import { Logger } from './logger';

export interface LeadData {
    company_name: string;
    email?: string;
    phone?: string;
    website?: string;
    vat?: string;
    revenue?: string;
    employees?: string;
    pec?: string;
    ceo_name?: string;
    business_type?: string;
    keyword_match?: boolean;
    ssl_valid?: boolean;
    dns_valid?: boolean;
}

export interface ScoreBreakdown {
    total: number;
    category: 'HOT' | 'WARM' | 'COLD' | 'DEAD';
    components: {
        contact: number;
        data: number;
        website: number;
    };
}

export class LeadScorerV2 {
    /**
     * Calculate lead score (0-100)
     */
    static score(lead: LeadData): ScoreBreakdown {
        const contact = this.scoreContact(lead);
        const data = this.scoreData(lead);
        const website = this.scoreWebsite(lead);

        const total = Math.round(contact + data + website);
        const category = this.categorize(total);

        return {
            total,
            category,
            components: { contact, data, website },
        };
    }

    /**
     * Contact Quality Score (max 40 points)
     */
    private static scoreContact(lead: LeadData): number {
        let score = 0;

        // Personal email (not info@, not generic)
        if (lead.email) {
            const isPersonal = !lead.email.match(/^(info|contact|admin|support|hello|sales)@/i);
            score += isPersonal ? 15 : 5;
        }

        // Mobile phone (+39 3xx)
        if (lead.phone?.match(/^\+?39\s*3/)) {
            score += 15;
        } else if (lead.phone) {
            score += 5;
        }

        // CEO/Decision maker name
        if (lead.ceo_name) {
            score += 10;
        }

        return Math.min(40, score);
    }

    /**
     * Data Completeness Score (max 35 points)
     */
    private static scoreData(lead: LeadData): number {
        let score = 0;

        // Valid VAT
        if (lead.vat?.match(/^\d{11}$/)) {
            score += 15;
        }

        // PEC email
        if (lead.pec) {
            score += 10;
        }

        // Revenue data
        if (lead.revenue) {
            score += 5;
        }

        // Employee count
        if (lead.employees) {
            score += 5;
        }

        return Math.min(35, score);
    }

    /**
     * Website Quality Score (max 25 points)
     */
    private static scoreWebsite(lead: LeadData): number {
        let score = 0;

        // Has website
        if (lead.website) {
            score += 10;

            // SSL valid
            if (lead.ssl_valid !== false) {
                score += 5;
            }

            // DNS resolves
            if (lead.dns_valid !== false) {
                score += 5;
            }

            // Keyword relevance
            if (lead.keyword_match !== false) {
                score += 5;
            }
        }

        return Math.min(25, score);
    }

    /**
     * Categorize lead
     */
    private static categorize(score: number): 'HOT' | 'WARM' | 'COLD' | 'DEAD' {
        if (score >= 70) return 'HOT';
        if (score >= 45) return 'WARM';
        if (score >= 20) return 'COLD';
        return 'DEAD';
    }

    /**
     * Score a batch of leads
     */
    static scoreBatch(leads: LeadData[]): Array<LeadData & ScoreBreakdown> {
        return leads.map(lead => ({
            ...lead,
            ...this.score(lead),
        }));
    }

    /**
     * Filter and sort leads by score
     */
    static filterHot(leads: LeadData[], minScore: number = 50): LeadData[] {
        return leads
            .map(lead => ({ ...lead, score: this.score(lead) }))
            .filter(lead => lead.score.total >= minScore)
            .sort((a, b) => b.score.total - a.score.total);
    }
}
