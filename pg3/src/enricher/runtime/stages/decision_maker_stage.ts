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

    if (!discoveredUrl) {
      return {
        decisionMaker: null,
        outcome: {
          stage: 'decision_maker',
          status: 'skipped',
          duration_ms: Date.now() - startedAt,
          detail: 'website discovery required before decision-maker search',
        },
      };
    }

    try {
      const decisionMaker = await this.linkedinSniper.snipe(companyId, input);
      return {
        decisionMaker,
        outcome: {
          stage: 'decision_maker',
          status: decisionMaker ? 'success' : 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: decisionMaker ? 'linkedin candidate found' : 'no linkedin candidate found',
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
        },
      };
    }
  }
}
