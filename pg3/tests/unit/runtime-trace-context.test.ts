import { describe, expect, it, vi } from 'vitest';
import { CostLedger } from '../../src/shared-runtime/budget/CostLedger';
import { withRuntimeTraceContext } from '../../src/shared-runtime/observability/run_context';
import { CostRouter } from '../../src/shared-runtime/routing/CostRouter';

describe('runtime trace context', () => {
  it('adds run/company/correlation ids to CostLedger entries', async () => {
    const ledger = new CostLedger({ persistToDisk: false });
    try {
      await withRuntimeTraceContext(
        {
          runId: 'agent-run-1',
          companyId: 'company-1',
          correlationId: 'agent-run-1:company-1',
        },
        () =>
          ledger.log({
            timestamp: new Date().toISOString(),
            module: 'TestModule',
            provider: 'test-provider',
            tier: 0,
            task_type: 'SERP',
            cost_eur: 0,
            cache_hit: false,
            cache_level: 'MISS',
            duration_ms: 1,
            success: true,
          })
      );

      const [entry] = await ledger.getRecentEntries(1);
      expect(entry).toMatchObject({
        run_id: 'agent-run-1',
        company_id: 'company-1',
        correlation_id: 'agent-run-1:company-1',
      });
    } finally {
      ledger.cleanup();
    }
  });

  it('threads explicit trace options through CostRouter ledger records', async () => {
    const ledger = new CostLedger({ persistToDisk: false });
    const cache = {
      get: vi.fn().mockResolvedValue({ level: 'MISS', value: null }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const provider = vi.fn().mockResolvedValue([{ url: 'https://example.test', title: 'Example' }]);
    const router = new CostRouter(
      cache as any,
      ledger,
      new Map([
        ['TEST-SERP-1', { family: 'SERP', tier: 1, costPerRequest: 0.002, execute: provider }],
      ]) as any,
      { SERP: ['TEST-SERP-1'] }
    );

    try {
      await router.route('SERP', { query: 'example' }, {
        skipCache: true,
        runId: 'agent-run-2',
        companyId: 'company-2',
        correlationId: 'agent-run-2:company-2',
      });

      const [entry] = await ledger.getRecentEntries(1);
      expect(entry).toMatchObject({
        run_id: 'agent-run-2',
        company_id: 'company-2',
        correlation_id: 'agent-run-2:company-2',
        cost_eur: 0.002,
      });
    } finally {
      ledger.cleanup();
      router.cleanup();
    }
  });
});
