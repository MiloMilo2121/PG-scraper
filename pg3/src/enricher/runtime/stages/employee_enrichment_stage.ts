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
        },
      };
    }
  }
}
