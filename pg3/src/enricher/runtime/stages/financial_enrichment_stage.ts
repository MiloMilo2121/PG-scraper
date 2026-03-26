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
      let provider = bilancioResult?.source_provider;
      let sourceUrl = bilancioResult?.source_url;
      let confidence = bilancioResult?.confidence;

      if (fatturatoItaliaResult) {
        if (fatturatoItaliaResult.revenue) {
          financial.fatturato_current = parseFloat(fatturatoItaliaResult.revenue.replace(/[^0-9]/g, ''));
          financial.year = parseInt(fatturatoItaliaResult.revenueYear || '2023', 10);
          financial.source_url = fatturatoItaliaResult.url;
          provider = 'fatturatoitalia';
          sourceUrl = fatturatoItaliaResult.url;
          confidence = Math.max(confidence || 0, 0.9);
        }

        if (fatturatoItaliaResult.employees) {
          employees = fatturatoItaliaResult.employees;
          isEstimatedEmployees = false;
          provider = provider || 'fatturatoitalia';
          sourceUrl = sourceUrl || fatturatoItaliaResult.url;
          confidence = Math.max(confidence || 0, 0.88);
        }

        if (fatturatoItaliaResult.vat) {
          vat = fatturatoItaliaResult.vat;
        }
      }

      const hasFinancialSignal = Boolean(financial.fatturato_current || employees);
      const hasVatOnlySignal = !hasFinancialSignal && Boolean(vat);
      const evidenceCount = [financial.fatturato_current, employees, vat].filter(Boolean).length;
      const status = hasFinancialSignal ? 'success' : hasVatOnlySignal ? 'partial' : 'not_found';
      const reasonCode = hasFinancialSignal
        ? 'FINANCIAL_SIGNALS_FOUND'
        : hasVatOnlySignal
          ? 'FINANCIAL_VAT_ONLY'
          : 'FINANCIAL_NOT_FOUND';

      return {
        financial: Object.keys(financial).length > 0 ? financial : null,
        employees,
        isEstimatedEmployees,
        vat,
        outcome: {
          stage: 'financial',
          status,
          duration_ms: Date.now() - startedAt,
          detail: hasFinancialSignal ? 'financial signals collected' : hasVatOnlySignal ? 'vat found without financial fields' : 'no financial signals found',
          reason_code: reasonCode,
          confidence,
          provider,
          source_url: sourceUrl,
          attempted_count: 2,
          evidence_count: evidenceCount,
          entity_match_status: hasFinancialSignal ? 'matched' : hasVatOnlySignal ? 'semantic' : 'unknown',
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
          reason_code: 'FINANCIAL_FAILED',
          attempted_count: 2,
        },
      };
    }
  }
}
