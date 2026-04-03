import { DecisionMaker, LinkedInSniper } from '../../../foundation/LinkedInSniper';
import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { RuntimeStageOutcome } from './stage_types';

export interface DecisionMakerStageResult {
  decisionMaker: DecisionMaker | null;
  outcome: RuntimeStageOutcome;
}

export class DecisionMakerStage {
  constructor(private readonly linkedinSniper: LinkedInSniper) {}

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<DecisionMakerStageResult> {
    const startedAt = Date.now();
    const effectiveWebsite = discoveredUrl || input.website || null;

    if (!effectiveWebsite) {
      return {
        decisionMaker: null,
        outcome: {
          stage: 'decision_maker',
          status: 'skipped',
          duration_ms: Date.now() - startedAt,
          detail: 'website discovery or input website required before decision-maker search',
          reason_code: 'DM_SKIPPED_NO_WEBSITE',
        },
      };
    }

    try {
      const result = await this.linkedinSniper.snipeDetailed(companyId, input, effectiveWebsite);
      const decisionMaker = result.decisionMaker;
      return {
        decisionMaker,
        outcome: {
          stage: 'decision_maker',
          status: decisionMaker ? 'success' : 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: decisionMaker ? result.detail : result.detail,
          reason_code: decisionMaker
            ? (decisionMaker.source_kind === 'company_site' ? 'DM_WEBSITE_SOURCE_FOUND' : 'DM_SOURCE_FOUND')
            : 'DM_NOT_FOUND',
          confidence: decisionMaker?.confidence,
          provider: decisionMaker?.providers?.join(',') || decisionMaker?.source || result.providers.join(',') || undefined,
          source_url: decisionMaker?.linkedin_url,
          attempted_count: result.attempted_count,
          evidence_count: result.evidence_count,
          entity_match_status: decisionMaker?.entity_match_status || result.entity_match_status,
        },
      };
    } catch (error) {
      return {
        decisionMaker: null,
        outcome: {
          stage: 'decision_maker',
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: (error as Error).message,
          reason_code: 'DM_FAILED',
        },
      };
    }
  }
}
