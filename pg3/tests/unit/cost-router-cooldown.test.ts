import { describe, expect, it, vi } from 'vitest';
import { CostRouter } from '../../src/shared-runtime/routing/CostRouter';

const ORIGINAL_SERPER_API_KEY = process.env.SERPER_API_KEY;

function createRouter(providers: Map<string, any>, providerOrder: readonly string[]) {
  const cache = {
    get: vi.fn().mockResolvedValue({ level: 'MISS', value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const ledger = {
    getProviderHealth: vi.fn().mockReturnValue({ error_rate: 0, avg_ms: 0 }),
    log: vi.fn().mockResolvedValue(undefined),
  };

  return new CostRouter(cache as any, ledger as any, providers as any, {
    SERP: providerOrder,
  });
}

describe('CostRouter provider cooldowns', () => {
  it('skips providers with missing credentials before attempting execution', async () => {
    const missingCredentialExecute = vi.fn().mockResolvedValue([{ url: 'https://blocked.test', title: 'blocked' }]);
    const fallbackExecute = vi.fn().mockResolvedValue([{ url: 'https://fallback.test', title: 'fallback' }]);
    const providers = new Map([
      ['SERPER-API-1', { family: 'SERP', tier: 1, costPerRequest: 0.001, execute: missingCredentialExecute }],
      ['BING-HTML-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: fallbackExecute }],
    ]);

    delete process.env.SERPER_API_KEY;

    try {
      const router = createRouter(providers, ['SERPER-API-1', 'BING-HTML-1']);
      const result = await router.route('SERP', 'agenzie immobiliari milano', { skipCache: true });

      expect(missingCredentialExecute).not.toHaveBeenCalled();
      expect(fallbackExecute).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('BING-HTML-1');
    } finally {
      if (ORIGINAL_SERPER_API_KEY === undefined) {
        delete process.env.SERPER_API_KEY;
      } else {
        process.env.SERPER_API_KEY = ORIGINAL_SERPER_API_KEY;
      }
    }
  });

  it('puts punitive failures on cooldown so later requests skip them', async () => {
    const blockedExecute = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Rate limit exceeded'), { response: { status: 429 } }))
      .mockResolvedValue([{ url: 'https://should-not-run.test', title: 'blocked' }]);
    const fallbackExecute = vi.fn().mockResolvedValue([{ url: 'https://fallback.test', title: 'fallback' }]);
    const providers = new Map([
      ['BING-HTML-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: blockedExecute }],
      ['DDG-LITE-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: fallbackExecute }],
    ]);

    const router = createRouter(providers, ['BING-HTML-1', 'DDG-LITE-1']);

    const first = await router.route('SERP', 'prima query', { skipCache: true });
    const second = await router.route('SERP', 'seconda query', { skipCache: true });

    expect(first.provider).toBe('DDG-LITE-1');
    expect(second.provider).toBe('DDG-LITE-1');
    expect(blockedExecute).toHaveBeenCalledTimes(1);
    expect(fallbackExecute).toHaveBeenCalledTimes(2);
  });
});
