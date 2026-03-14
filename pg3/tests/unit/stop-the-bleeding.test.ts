import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const RESET_KEYS = ['MAX_COST_PER_COMPANY_EUR'];

async function loadRuntime(overrides: Record<string, string>) {
  vi.resetModules();

  const nextEnv = { ...ORIGINAL_ENV };
  for (const key of RESET_KEYS) {
    delete nextEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    nextEnv[key] = value;
  }

  process.env = nextEnv;

  const [{ CostLedger }, { BackpressureValve }, { StopTheBleedingController }] = await Promise.all([
    import('../../src/foundation/CostLedger'),
    import('../../src/foundation/BackpressureValve'),
    import('../../src/foundation/StopTheBleedingController'),
  ]);

  return { CostLedger, BackpressureValve, StopTheBleedingController };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('StopTheBleedingController', () => {
  it('activates bleeding mode when average cost exceeds configured budget', async () => {
    const { CostLedger, BackpressureValve, StopTheBleedingController } = await loadRuntime({
      MAX_COST_PER_COMPANY_EUR: '0.002',
    });

    const ledger = new CostLedger({ persistToDisk: false });
    const valve = new BackpressureValve({ ledger, healthPollInterval: 60000 });
    const pool = { getPoolStatus: () => ({ total: 0, available: 0, busy: 0, recycled_total: 0, errors_total: 0 }) } as any;
    const controller = new StopTheBleedingController(ledger, valve, pool);

    try {
      await ledger.log({
        timestamp: new Date().toISOString(),
        module: 'CostRouter',
        provider: 'HTTP-SCRAPEDO-3',
        tier: 3,
        task_type: 'PROXY_FETCH',
        cost_eur: 0.003,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 1000,
        success: true,
      });

      expect(await controller.evaluateStatus(1)).toBe(true);
      expect(controller.isBleedingModeActive).toBe(true);
    } finally {
      valve.cleanup();
      ledger.cleanup();
    }
  });

  it('stays clean when average cost remains under the configured budget', async () => {
    const { CostLedger, BackpressureValve, StopTheBleedingController } = await loadRuntime({
      MAX_COST_PER_COMPANY_EUR: '0.005',
    });

    const ledger = new CostLedger({ persistToDisk: false });
    const valve = new BackpressureValve({ ledger, healthPollInterval: 60000 });
    const pool = { getPoolStatus: () => ({ total: 0, available: 0, busy: 0, recycled_total: 0, errors_total: 0 }) } as any;
    const controller = new StopTheBleedingController(ledger, valve, pool);

    try {
      await ledger.log({
        timestamp: new Date().toISOString(),
        module: 'CostRouter',
        provider: 'HTTP-SCRAPEDO-3',
        tier: 3,
        task_type: 'PROXY_FETCH',
        cost_eur: 0.003,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 1000,
        success: true,
      });

      expect(await controller.evaluateStatus(1)).toBe(false);
      expect(controller.isBleedingModeActive).toBe(false);
    } finally {
      valve.cleanup();
      ledger.cleanup();
    }
  });
});
