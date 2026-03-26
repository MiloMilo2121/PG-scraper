import { EnrichmentPostProcessor } from '../../../foundation/EnrichmentPostProcessor';
import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { RuntimeStageOutcome } from './stage_types';

export interface EmployeeStageResult {
  employees: string | null;
  isEstimatedEmployees: boolean;
  outcome: RuntimeStageOutcome;
}

export class EmployeeEnrichmentStage {
  constructor(private readonly postProcessor: EnrichmentPostProcessor) {}

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<EmployeeStageResult> {
    const startedAt = Date.now();

    if (!discoveredUrl) {
      return {
        employees: null,
        isEstimatedEmployees: false,
        outcome: {
          stage: 'employee_estimation',
          status: 'skipped',
          duration_ms: Date.now() - startedAt,
          detail: 'website discovery required before employee estimation',
          reason_code: 'EMPLOYEE_SKIPPED_NO_WEBSITE',
        },
      };
    }

    try {
      const employees = await this.postProcessor.estimateEmployees(companyId, input, discoveredUrl);
      return {
        employees,
        isEstimatedEmployees: Boolean(employees),
        outcome: {
          stage: 'employee_estimation',
          status: employees ? 'success' : 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: employees ? 'employee estimate produced' : 'employee estimate unavailable',
          reason_code: employees ? 'EMPLOYEE_ESTIMATE_FOUND' : 'EMPLOYEE_ESTIMATE_NOT_FOUND',
          confidence: employees ? 0.68 : 0,
          provider: employees ? 'post_processor' : undefined,
          source_url: discoveredUrl,
          attempted_count: 1,
          evidence_count: employees ? 1 : 0,
          entity_match_status: employees ? 'semantic' : 'unknown',
        },
      };
    } catch (error) {
      return {
        employees: null,
        isEstimatedEmployees: false,
        outcome: {
          stage: 'employee_estimation',
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: (error as Error).message,
          reason_code: 'EMPLOYEE_ESTIMATE_FAILED',
          source_url: discoveredUrl,
          attempted_count: 1,
        },
      };
    }
  }
}
