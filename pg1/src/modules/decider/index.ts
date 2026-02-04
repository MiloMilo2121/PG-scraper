import { ScoreBreakdown, DecisionStatus, OutputResult, Candidate, Evidence, NormalizedEntity } from '../../types';
import { getConfig } from '../../config';
import { OpenAIVerifier } from '../verifier/openai-verifier';
import { logger } from '../observability';

export class Decider {

    static async decide(
        candidates: { candidate: Candidate, score: ScoreBreakdown, evidence: Evidence }[],
        input: NormalizedEntity,
        phoneFreq: number
    ): Promise<Partial<OutputResult>> {
        const config = getConfig();

        // Sort by final score desc
        candidates.sort((a, b) => b.score.final_score - a.score.final_score);

        const top = candidates[0];
        if (!top) {
            return {
                status: DecisionStatus.NO_DOMAIN_FOUND,
                score: 0,
                confidence: 0,
                decision_reason: 'No candidates found'
            };
        }

        const secondScore = candidates[1] ? candidates[1].score.final_score : 0;
        const margin = top.score.final_score - secondScore;

        // Rules
        let isOk = false;
        let reason = '';

        // 8.2 High Risk Rule
        const isHighRisk = phoneFreq >= config.thresholds.phone_frequency_limit || input.company_name.length <= 4;

        if (isHighRisk) {
            if (top.score.final_score >= config.thresholds.high_risk_score && margin >= config.thresholds.high_risk_margin) {
                isOk = true;
                reason = 'Passed High Risk Threshold';
            } else {
                reason = `High Risk: Score ${top.score.final_score} < ${config.thresholds.high_risk_score} or Margin ${margin} < ${config.thresholds.high_risk_margin}`;
            }
        } else {
            // 8.1 Standard Rule
            if (top.score.final_score >= config.thresholds.ok_score && margin >= config.thresholds.ok_margin) {
                isOk = true;
                reason = 'Passed Standard Threshold';
            } else {
                reason = `Standard: Score ${top.score.final_score} < ${config.thresholds.ok_score} or Margin ${margin} < ${config.thresholds.ok_margin}`;
            }
        }

        // OpenAI Fallback for uncertain results
        if (!isOk && config.openai?.enabled && OpenAIVerifier.isConfigured()) {
            const fallbackThreshold = config.openai.fallback_threshold || 50;
            const minAiConfidence = config.openai.min_ai_confidence || 70;

            if (top.score.final_score >= fallbackThreshold) {
                logger.log('info', `[OpenAI Fallback] Score ${top.score.final_score} in uncertain range, verifying with AI...`);

                const verification = await OpenAIVerifier.verify(
                    {
                        company_name: input.company_name,
                        city: input.city,
                        address: input.address_tokens.join(' '),
                        industry: (input as any).industry || '',
                        phone: input.phones[0] || ''
                    },
                    {
                        url: top.candidate.source_url,
                        page_title: top.evidence.meta_title || '',
                        content_snippet: top.evidence.meta_description || ''
                    }
                );

                if (verification.is_match && verification.confidence >= minAiConfidence) {
                    isOk = true;
                    reason = `AI Verified: ${verification.reason} (AI confidence: ${verification.confidence}%)`;
                    logger.log('info', `[OpenAI] Promoted ${top.candidate.source_url} to OK`);
                } else {
                    reason = `AI Rejected: ${verification.reason} (AI confidence: ${verification.confidence}%)`;
                    logger.log('info', `[OpenAI] Rejected ${top.candidate.source_url}: ${verification.reason}`);
                }
            }
        }

        if (isOk) {
            // 8.7 Confidence
            const confidence = Math.min(100, top.score.final_score + Math.min(10, margin / 5));

            return {
                domain_official: top.candidate.root_domain,
                site_url_official: top.candidate.source_url,
                status: DecisionStatus.OK,
                score: top.score.final_score,
                confidence: Math.round(confidence),
                decision_reason: reason,
                evidence_json: JSON.stringify(top.evidence),
                candidates_json: JSON.stringify(candidates.map(c => ({ url: c.candidate.source_url, score: c.score.final_score })))
            };
        } else {
            // NO DOMAIN FOUND
            const confidence = Math.min(80, top.score.final_score);
            return {
                domain_official: null,
                site_url_official: null,
                status: DecisionStatus.NO_DOMAIN_FOUND,
                score: top.score.final_score, // Best attempt
                confidence: Math.round(confidence),
                decision_reason: reason,
                evidence_json: JSON.stringify(top.evidence), // Return evidence of top candidate even if failed? Useful for debugging.
                candidates_json: JSON.stringify(candidates.map(c => ({ url: c.candidate.source_url, score: c.score.final_score })))
            };
        }
    }
}
