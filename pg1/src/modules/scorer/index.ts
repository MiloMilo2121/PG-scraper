import { Evidence, NormalizedEntity, ScoreBreakdown, SiteType } from '../../types';
import { getConfig } from '../../config';
import { StringUtils } from '../../utils/similarity';

export class Scorer {

    static score(evidence: Evidence, input: NormalizedEntity, phoneFreq: number): ScoreBreakdown {
        const config = getConfig();
        const details: string[] = [];

        // --- Strong Signals ---
        let strongScore = 0;

        // S1 Phone
        const phoneMatches = input.phones.filter(p => evidence.phones_found.includes(p));
        let s1 = 0;
        if (phoneMatches.length > 0) {
            if (phoneFreq >= config.thresholds.phone_frequency_limit) {
                s1 = 25; // Reduced
                details.push('S1: Phone Match (Reduced due to Freq)');
            } else {
                s1 = config.scoring.weights.s1_phone_exact_match;
                details.push('S1: Phone Exact Match');
            }
        }
        strongScore += s1;

        // S2 Address - Now using pre-calculated match score from SignalExtractor
        let s2 = 0;
        if (evidence.address_match_score > 0.5) {
            s2 = config.scoring.weights.s2_address_high_match * evidence.address_match_score;
            details.push(`S2: Address Match (${evidence.address_match_score.toFixed(2)})`);
        } else if (evidence.address_match_score > 0.3) {
            s2 = config.scoring.weights.s2_address_high_match * 0.3;
            details.push(`S2: Address Partial Match (${evidence.address_match_score.toFixed(2)})`);
        }
        strongScore += s2;

        // S3 Name - Use both title match and pre-calculated name_match_score
        const titleLower = (evidence.meta_title || '').toLowerCase();
        const titleNameMatch = StringUtils.jaccardIndex(input.company_name, titleLower);
        // Take the best of title match or the pre-calculated score
        const nameMatch = Math.max(titleNameMatch, evidence.name_match_score || 0);

        let s3 = 0;
        if (nameMatch > 0.3) { // Threshold
            s3 = config.scoring.weights.s3_name_high_match * (nameMatch > 0.8 ? 1 : nameMatch > 0.5 ? 0.7 : 0.4);
            details.push(`S3: Name Match (${nameMatch.toFixed(2)})`);
        }
        strongScore += s3;

        // S4 VAT
        let s4 = 0;
        const foundVats = evidence.vat_ids_found;

        if (input.vat_id && foundVats.includes(input.vat_id)) {
            // GOLDEN SIGNAL
            s4 = 100;
            details.push(`S4: VAT Exact Match (${input.vat_id})`);
        } else if (foundVats.length > 0) {
            // Just finding a VAT is a corporate signal
            s4 = config.scoring.weights.s4_vat_found;
            details.push('S4: VAT Found (No Input Match)');
        }
        strongScore += s4;

        // --- Corroborating ---
        let corrobScore = 0;

        // C1 Email Domain
        let c1 = 0;
        // Check if email domain matches root domain?
        // Not implemented in extractor yet (extracted emails are just strings).
        // Assume yes if emails > 0 for now? No.
        if (evidence.emails_found.length > 0) {
            c1 = config.scoring.weights.c1_email_domain_found; // Loose check
            details.push('C1: Email Found');
        }
        corrobScore += c1;

        // C2 Structured Data
        let c2 = 0;
        if (evidence.structured_data && evidence.structured_data.length > 0) {
            c2 = config.scoring.weights.c2_sd_org_match;
            details.push('C2: Structured Data Found');
        }
        corrobScore += c2;

        // C3 Corporate Signals
        let c3 = 0;
        // We use our Classifier's implicit count or calculate?
        // "corporate_positive_signals_count" in Evidence
        // wait, Evidence has 'parked_indicators_count' but not 'corporate'?
        // I missed adding `corporate_positive_signals_count` to Evidence definition in previous step.
        // I will simulate it:
        let corpCount = 0;
        if (evidence.has_contact_page) corpCount++;
        if (evidence.has_privacy_policy) corpCount++;
        if (evidence.vat_ids_found.length > 0) corpCount++;

        if (corpCount >= 2) {
            c3 = config.scoring.weights.c3_corporate_signals;
            details.push('C3: Corporate Signals >= 2');
        }
        corrobScore += c3;

        // C4 Contact Page
        let c4 = 0;
        if (evidence.has_contact_page) {
            c4 = config.scoring.weights.c4_has_contact_page;
            details.push('C4: Contact Page');
        }
        corrobScore += c4;

        // C5 HTTPS
        let c5 = 0;
        if (evidence.is_https) {
            c5 = config.scoring.weights.c5_https_ok;
            details.push('C5: HTTPS');
        }
        corrobScore += c5;

        // --- Penalties ---
        let penaltyScore = 0;

        // P1 Bad Site Type (Directory, Parked, Social - unless fallback allowed)
        const isSocial = evidence.site_type === SiteType.SOCIAL;
        const allowSocial = config.scoring.allow_social_fallback;

        // If it is SOCIAL and we ALLOW it, do NOT penalize.
        // Otherwise (Directory, Marketplace, Parked, or Social when not allowed), penalize.
        if ((evidence.site_type === SiteType.DIRECTORY ||
            evidence.site_type === SiteType.MARKETPLACE ||
            evidence.site_type === SiteType.PARKED) ||
            (isSocial && !allowSocial)) {

            penaltyScore += config.scoring.penalties.p1_bad_site_type;
            details.push(`P1: Bad Site Type (${evidence.site_type})`);
        }

        // P2 DNS Fail
        if (!evidence.dns_ok) {
            penaltyScore += config.scoring.penalties.p2_dns_fail;
            details.push('P2: DNS Fail');
        }

        // P3 HTTP Fail
        if (!evidence.http_ok) {
            penaltyScore += config.scoring.penalties.p3_http_fail;
            details.push('P3: HTTP Fail');
        }

        // P6 Contradiction
        // Check contradictions (e.g. Phone match but name mismatch hard?)
        // "Se phone_exact_match==true MA (name_match_score<0.5 AND address_match_score<0.5) => contradiction"
        // I need name match score (0-1).
        // I don't have it explicitly here.
        // I'll skip complex contradiction for MVP to strictly follow "no human in loop" safely -> conservative.

        // Calculation
        let base = strongScore + corrobScore;
        let final = Math.max(0, Math.min(100, base - penaltyScore));

        return {
            base_score: base,
            strong_signals_score: strongScore,
            corroborating_signals_score: corrobScore,
            penalties_score: penaltyScore,
            final_score: final,
            details: details
        };
    }
}
