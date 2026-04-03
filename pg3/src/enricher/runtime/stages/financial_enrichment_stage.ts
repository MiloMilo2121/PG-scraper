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
      let entityMatchStatus: RuntimeStageOutcome['entity_match_status'] = bilancioResult?.entity_match_status || 'unknown';
      const providerParts = new Set<string>(provider ? [provider] : []);
      let attemptedCount = bilancioResult?.attempted_queries || 0;

      if (fatturatoItaliaResult) {
        attemptedCount += 1;
        if (fatturatoItaliaResult.revenue) {
          financial.fatturato_current = parseFloat(fatturatoItaliaResult.revenue.replace(/[^0-9]/g, ''));
          financial.year = parseInt(fatturatoItaliaResult.revenueYear || '2023', 10);
          financial.source_url = fatturatoItaliaResult.url;
          financial.source_provider = 'fatturatoitalia';
          financial.source_trust = 'high';
          financial.entity_match_status = fatturatoItaliaResult.vat
            ? 'matched'
            : bilancioResult?.entity_match_status || 'semantic';
          provider = 'fatturatoitalia';
          sourceUrl = fatturatoItaliaResult.url;
          confidence = Math.max(confidence || 0, 0.9);
          entityMatchStatus = fatturatoItaliaResult.vat ? 'matched' : entityMatchStatus;
          providerParts.add('fatturatoitalia');
        }

        if (fatturatoItaliaResult.employees) {
          employees = fatturatoItaliaResult.employees;
          isEstimatedEmployees = false;
          provider = provider || 'fatturatoitalia';
          sourceUrl = sourceUrl || fatturatoItaliaResult.url;
          confidence = Math.max(confidence || 0, 0.88);
          providerParts.add('fatturatoitalia');
        }

        if (fatturatoItaliaResult.vat) {
          vat = fatturatoItaliaResult.vat;
          entityMatchStatus = 'matched';
        }
      }

      const hasRevenue = Boolean(financial.fatturato_current);
      const hasEmployees = Boolean(employees);
      const hasVat = Boolean(vat);
      const hasSource = Boolean(financial.source_url);
      const evidenceCount = [
        financial.fatturato_current,
        financial.fatturato_previous,
        financial.utile_netto,
        employees,
        vat,
        financial.source_url,
      ].filter(Boolean).length;

      let status: RuntimeStageOutcome['status'] = 'not_found';
      let reasonCode = 'FINANCIAL_NOT_FOUND';
      let detail = 'no financial signals found';

      if (hasRevenue && hasEmployees) {
        status = 'success';
        reasonCode = 'FINANCIAL_REVENUE_AND_EMPLOYEES';
        detail = 'revenue and employees collected';
      } else if (hasRevenue) {
        status = 'success';
        reasonCode = 'FINANCIAL_REVENUE_FOUND';
        detail = 'revenue collected';
      } else if (hasEmployees) {
        status = 'partial';
        reasonCode = 'FINANCIAL_EMPLOYEES_ONLY';
        detail = 'employees found without revenue';
      } else if (hasSource) {
        status = 'partial';
        reasonCode = 'FINANCIAL_SOURCE_IDENTIFIED';
        detail = 'financial source found without numeric fields';
      } else if (hasVat) {
        status = 'partial';
        reasonCode = 'FINANCIAL_VAT_ONLY';
        detail = 'vat found without financial fields';
      }

      return {
        financial: Object.keys(financial).length > 0 ? financial : null,
        employees,
        isEstimatedEmployees,
        vat,
        outcome: {
          stage: 'financial',
          status,
          duration_ms: Date.now() - startedAt,
          detail,
          reason_code: reasonCode,
          confidence,
          provider: providerParts.size > 0 ? [...providerParts].join('+') : provider,
          source_url: sourceUrl,
          attempted_count: Math.max(attemptedCount, 1 + (fatturatoItaliaResult ? 1 : 0)),
          evidence_count: evidenceCount,
          entity_match_status: hasRevenue || hasEmployees || hasVat ? entityMatchStatus : hasSource ? bilancioResult?.entity_match_status || 'semantic' : 'unknown',
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
