
import { CompanyInput } from '../types';

export class LeadScorer {

    /**
     * Calculates a 0-100 score for a lead based on data completeness and quality.
     */
    static score(company: CompanyInput): number {
        let score = 0;

        // 1. PHONE (Essential) - 30 pts
        if (company.phone && company.phone.length > 5) {
            score += 30;
        }

        // 2. WEBSITE (High Value) - 30 pts
        if (company.website && company.website.includes('.')) {
            score += 30;
        }

        // 3. VAT/PIVA (Validation) - 20 pts
        if (company.piva || company.vat_code) {
            score += 20;
        }

        // 4. ADDRESS (Postal) - 10 pts
        if (company.address && company.address.length > 5) {
            score += 10;
        }

        // 5. EMAIL (Golden) - Bonus 10 pts (if we had it, usually comes from deep scrape)
        // Since we don't strictly scrape emails in Phase 1/2, we rely on other signals.
        // Let's use the 'discovery_confidence' if present.
        const confidence = (company as any).discovery_confidence || 0;
        if (confidence > 0.8) {
            score += 10;
        }

        return Math.min(score, 100);
    }
}
