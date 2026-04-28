import { describe, expect, it } from 'vitest';
import {
  emptyCostSummary,
  evaluateCostSummary,
} from '../../src/agent/agent_costs';

const zeroStats = {
  loaded: 0,
  discovered: 0,
  enriched: 0,
  failed: 0,
};

describe('agent_costs', () => {
  it('separates missing budgets from configured zero-cost budgets', () => {
    expect(emptyCostSummary()).toMatchObject({
      totalCostEur: 0,
      externalCalls: 0,
      budgetStatus: 'not_configured',
    });
    expect(emptyCostSummary({ maxCostPerRun: 0 })).toMatchObject({
      totalCostEur: 0,
      externalCalls: 0,
      budgetStatus: 'within_budget',
    });
  });

  it('reports warnings at 80 percent of a configured budget', () => {
    const summary = evaluateCostSummary({
      budget: { maxCostPerRun: 1 },
      stats: zeroStats,
      durationMs: 10,
      totalCostEur: 0.8,
      externalCalls: 0,
    });

    expect(summary.budgetStatus).toBe('warning');
    expect(summary.warnings).toEqual(['maxCostPerRun warning: 0.8 >= 80% of 1']);
  });

  it('reports exceeded budget with per-company cost', () => {
    const summary = evaluateCostSummary({
      budget: { maxCostPerCompany: 0.01, maxExternalCalls: 1 },
      stats: {
        loaded: 2,
        discovered: 0,
        enriched: 0,
        failed: 0,
      },
      durationMs: 10,
      totalCostEur: 0.04,
      externalCalls: 2,
    });

    expect(summary).toMatchObject({
      totalCostEur: 0.04,
      costPerCompanyEur: 0.02,
      externalCalls: 2,
      budgetStatus: 'exceeded',
    });
    expect(summary.warnings).toEqual([
      'maxCostPerCompany exceeded: 0.02 > 0.01',
      'maxExternalCalls exceeded: 2 > 1',
    ]);
  });
});
