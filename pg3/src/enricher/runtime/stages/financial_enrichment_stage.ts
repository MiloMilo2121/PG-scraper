import { BilancioHunter, FinancialData } from '../../../foundation/BilancioHunter';
import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { FatturatoItaliaHarvester } from '../../core/directories/fatturato_italia';
import { RuntimeStageOutcome } from './stage_types';

export interface FinancialStageResult {
  financial: FinancialData | null;
  employees: string | null;
  isEstimatedEmployees: boolean;
  vat: string | null;
  outcome: RuntimeStageOutcome;
}

export class FinancialEnrichmentStage {
  constructor(private readonly bilancioHunter: BilancioHunter) {}

  public async run(companyId: string, input: NormalizedInput): Promise<FinancialStageResult> {
    const startedAt = Date.now();

    try {
      const [bilancioResult, fatturatoItaliaResult] = await Promise.all([
        this.bilancioHunter.hunt(companyId, input).catch(() => null),
        FatturatoItaliaHarvester.harvest(input as any).catch(() => null),
      ]);

      const financial: FinancialData = bilancioResult ? { ...bilancioResult } : {};
      let employees: string | null = null;
      let isEstimatedEmployees = false;
      let vat = input.vat_code || null;

      if (fatturatoItaliaResult) {
        if (fatturatoItaliaResult.revenue) {
          financial.fatturato_current = parseFloat(fatturatoItaliaResult.revenue.replace(/[^0-9]/g, ''));
          financial.year = parseInt(fatturatoItaliaResult.revenueYear || '2023', 10);
          financial.source_url = fatturatoItaliaResult.url;
        }

        if (fatturatoItaliaResult.employees) {
          employees = fatturatoItaliaResult.employees;
          isEstimatedEmployees = false;
        }

        if (fatturatoItaliaResult.vat) {
          vat = fatturatoItaliaResult.vat;
        }
      }

      const hasSignal = Boolean(Object.keys(financial).length > 0 || employees || vat);

      return {
        financial: Object.keys(financial).length > 0 ? financial : null,
        employees,
        isEstimatedEmployees,
        vat,
        outcome: {
          stage: 'financial',
          status: hasSignal ? 'success' : 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: hasSignal ? 'financial signals collected' : 'no financial signals found',
        },
      };
    } catch (error) {
      return {
        financial: null,
        employees: null,
        isEstimatedEmployees: false,
        vat: input.vat_code || null,
        outcome: {
          stage: 'financial',
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: (error as Error).message,
        },
      };
    }
  }
}
