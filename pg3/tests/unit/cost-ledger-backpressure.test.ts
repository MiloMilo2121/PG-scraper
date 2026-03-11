import { describe, expect, it } from 'vitest';
import { CostLedger } from '../../src/foundation/CostLedger';

describe('CostLedger punitive snapshots', () => {
  it('excludes browser-pool and semantic-empty failures from punitive health', async () => {
    const ledger = new CostLedger({ persistToDisk: false });
    try {
      await ledger.log({
        timestamp: new Date().toISOString(),
        module: 'BrowserPool',
        provider: 'playwright',
        tier: 2,
        task_type: 'PROXY_FETCH',
        cost_eur: 0,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 1200,
        success: false,
        error: 'TIMEOUT',
        error_class: 'browser_pool',
        punitive: false,
      });

      await ledger.log({
        timestamp: new Date().toISOString(),
        module: 'CostRouter',
        provider: 'SERPER-1',
        tier: 0,
        task_type: 'SERP',
        cost_eur: 0.001,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 450,
        success: false,
        error: 'SERP_EMPTY_RESULT',
        error_class: 'semantic_empty',
        punitive: false,
      });

      await ledger.log({
        timestamp: new Date().toISOString(),
        module: 'CostRouter',
        provider: 'HTTP-DIRECT-1',
        tier: 1,
        task_type: 'PROXY_FETCH',
        cost_eur: 0,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 2500,
        success: false,
        error: 'TimeoutError',
        error_class: 'transport',
        punitive: true,
      });

      const raw = ledger.getHealthSnapshot(30);
      const punitive = ledger.getHealthSnapshot(30, { punitiveOnly: true });

      expect(raw.total_calls).toBe(3);
      expect(raw.error_rate).toBe(1);
      expect(punitive.total_calls).toBe(1);
      expect(punitive.error_rate).toBe(1);
      expect(punitive.providers_unhealthy).toEqual([]);
    } finally {
      ledger.cleanup();
    }
  });

  it('still counts non-punitive failures in provider health', async () => {
    const ledger = new CostLedger({ persistToDisk: false });
    try {
      for (let i = 0; i < 5; i++) {
        await ledger.log({
          timestamp: new Date().toISOString(),
          module: 'CostRouter',
          provider: 'SERPER-1',
          tier: 0,
          task_type: 'SERP',
          cost_eur: 0.001,
          cache_hit: false,
          cache_level: 'MISS',
          duration_ms: 300,
          success: false,
          error: 'SERP_EMPTY_RESULT',
          error_class: 'semantic_empty',
          punitive: false,
        });
      }

      const provider = ledger.getProviderHealth('SERPER-1');
      const punitive = ledger.getHealthSnapshot(30, { punitiveOnly: true });

      expect(provider.error_rate).toBe(1);
      expect(punitive.total_calls).toBe(0);
    } finally {
      ledger.cleanup();
    }
  });
});
