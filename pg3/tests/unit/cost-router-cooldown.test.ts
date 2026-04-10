import { describe, expect, it, vi } from 'vitest';
import { CostRouter } from '../../src/shared-runtime/routing/CostRouter';

const ORIGINAL_SERPER_API_KEY = process.env.SERPER_API_KEY;
const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function createRouter(
  providers: Map<string, any>,
  providerOrder: readonly string[],
  overrides?: {
    recentEntries?: Array<{ provider: string; success: boolean; punitive?: boolean; duration_ms: number }>;
  },
  family: 'SERP' | 'LLM' | 'PROXY_FETCH' = 'SERP',
) {
  const cache = {
    get: vi.fn().mockResolvedValue({ level: 'MISS', value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const ledger = {
    getProviderHealth: vi.fn().mockReturnValue({ error_rate: 0, avg_ms: 0 }),
    getRecentEntries: vi.fn().mockResolvedValue(overrides?.recentEntries || []),
    log: vi.fn().mockResolvedValue(undefined),
  };

  return new CostRouter(cache as any, ledger as any, providers as any, {
    [family]: providerOrder,
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

  it('uses provider ids for LLM budget buckets', () => {
    const router = createRouter(new Map(), []);
    const llmBudget = router.getBudgetStatus('OPENAI-1');
    const unknownBudget = router.getBudgetStatus('gpt-4o-mini');

    expect(llmBudget.requests_per_minute).toBe(15);
    expect(llmBudget.is_throttled).toBe(false);
    expect(unknownBudget.requests_per_minute).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('marks providers unhealthy from recent punitive failures without poisoning them with old auth noise', async () => {
    const providerExecute = vi.fn().mockResolvedValue([{ url: 'https://healthy-fallback.test', title: 'ok' }]);
    const fallbackExecute = vi.fn().mockResolvedValue([{ url: 'https://fallback.test', title: 'fallback' }]);
    const providers = new Map([
      ['SERPER-API-1', { family: 'SERP', tier: 1, costPerRequest: 0.001, execute: providerExecute }],
      ['BING-HTML-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: fallbackExecute }],
    ]);

    process.env.SERPER_API_KEY = 'test-key';

    try {
      const router = createRouter(providers, ['SERPER-API-1', 'BING-HTML-1'], {
        recentEntries: [
          { provider: 'SERPER-API-1', success: false, punitive: true, duration_ms: 9000 },
          { provider: 'SERPER-API-1', success: false, punitive: true, duration_ms: 9500 },
          { provider: 'SERPER-API-1', success: false, punitive: true, duration_ms: 10000 },
          { provider: 'SERPER-API-1', success: true, punitive: false, duration_ms: 400 },
          { provider: 'SERPER-API-1', success: false, punitive: true, duration_ms: 11000 },
        ],
      });

      const result = await router.route('SERP', 'query', { skipCache: true });
      expect(result.provider).toBe('BING-HTML-1');
      expect(providerExecute).not.toHaveBeenCalled();
      expect(fallbackExecute).toHaveBeenCalledTimes(1);
    } finally {
      if (ORIGINAL_SERPER_API_KEY === undefined) {
        delete process.env.SERPER_API_KEY;
      } else {
        process.env.SERPER_API_KEY = ORIGINAL_SERPER_API_KEY;
      }
    }
  });

  it('does not exhaust non-direct providers on 400 responses', async () => {
    const htmlProviderExecute = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Bad Request'), { response: { status: 400 } }))
      .mockResolvedValue([{ url: 'https://html-provider.test', title: 'html provider' }]);
    const fallbackExecute = vi.fn().mockResolvedValue([{ url: 'https://fallback.test', title: 'fallback' }]);
    const providers = new Map([
      ['BING-HTML-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: htmlProviderExecute }],
      ['DDG-LITE-1', { family: 'SERP', tier: 1, costPerRequest: 0, execute: fallbackExecute }],
    ]);

    const router = createRouter(providers, ['BING-HTML-1', 'DDG-LITE-1']);

    const first = await router.route('SERP', 'query one', { skipCache: true });
    const second = await router.route('SERP', 'query two', { skipCache: true });

    expect(first.provider).toBe('DDG-LITE-1');
    expect(second.provider).toBe('BING-HTML-1');
    expect(htmlProviderExecute).toHaveBeenCalledTimes(2);
  });

  it('treats bucket overload as a provider failure and waterfalls to the next LLM provider', async () => {
    const overloadedExecute = vi.fn().mockResolvedValue([{ url: 'https://should-not-run.test', title: 'blocked' }]);
    const fallbackExecute = vi.fn().mockResolvedValue([{ url: 'https://fallback.test', title: 'fallback' }]);
    const providers = new Map([
      ['OPENAI-1', { family: 'LLM', tier: 1, costPerRequest: 0.001, execute: overloadedExecute }],
      ['OPENROUTER-2', { family: 'LLM', tier: 1, costPerRequest: 0.002, execute: fallbackExecute }],
    ]);

    process.env.OPENAI_API_KEY = 'test-openai';
    process.env.OPENROUTER_API_KEY = 'test-openrouter';

    try {
      const router = createRouter(providers, ['OPENAI-1', 'OPENROUTER-2'], undefined, 'LLM');
      const llmBuckets = (router as any).llmBuckets as Map<string, any>;
      const bucket = llmBuckets.get('OPENAI-1');
      bucket.tokens = 0;
      bucket.queue = new Array(20).fill(() => undefined);

      const result = await router.route('LLM_CLASSIFY', 'classify this company', { skipCache: true });

      expect(result.provider).toBe('OPENROUTER-2');
      expect(overloadedExecute).not.toHaveBeenCalled();
      expect(fallbackExecute).toHaveBeenCalledTimes(1);
      expect((router as any).providerCooldowns.get('OPENAI-1')).toBeGreaterThan(Date.now());
    } finally {
      if (ORIGINAL_SERPER_API_KEY === undefined) {
        delete process.env.SERPER_API_KEY;
      } else {
        process.env.SERPER_API_KEY = ORIGINAL_SERPER_API_KEY;
      }
      if (ORIGINAL_OPENAI_API_KEY === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
      }
      if (ORIGINAL_OPENROUTER_API_KEY === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER_API_KEY;
      }
    }
  });
});
