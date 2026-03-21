import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const RESET_KEYS = [
  'OPENAI_API_KEY',
  'Z_AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'KIMI_API_KEY',
  'PERPLEXITY_API_KEY',
  'LOCAL_ORACLE_FETCH_COST_EUR',
  'LOCAL_BROWSER_NAV_COST_EUR',
];
const NUMERIC_RESET_KEYS = new Set([
  'LOCAL_ORACLE_FETCH_COST_EUR',
  'LOCAL_BROWSER_NAV_COST_EUR',
]);

async function loadCatalog(overrides: Record<string, string>) {
  vi.resetModules();

  const nextEnv = { ...ORIGINAL_ENV };
  for (const key of RESET_KEYS) {
    if (NUMERIC_RESET_KEYS.has(key)) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = '';
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    nextEnv[key] = value;
  }

  process.env = nextEnv;

  return await import('../../src/foundation/provider_catalog');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('provider catalog', () => {
  it('keeps the HTTP fallback ladder aligned with the shared escalation order', async () => {
    const { buildProviderMap, HTTP_PROVIDER_ORDER } = await loadCatalog({});
    const providers = buildProviderMap();

    expect([...HTTP_PROVIDER_ORDER]).toEqual([
      'HTTP-DIRECT-1',
      'HTTP-BRIGHTDATA-4',
      'ORACLE-CRAWL4AI-5',
    ]);

    const direct = providers.get('HTTP-DIRECT-1');
    const brightData = providers.get('HTTP-BRIGHTDATA-4');
    const oracle = providers.get('ORACLE-CRAWL4AI-5');

    expect(direct?.costPerRequest).toBe(0);
    expect(brightData?.costPerRequest).toBeLessThan(0.01);
    expect(oracle).toBeDefined();
  }, 120000);

  it('threads configurable local Oracle cost into the provider map', async () => {
    const { buildProviderMap } = await loadCatalog({
      LOCAL_ORACLE_FETCH_COST_EUR: '0.0035',
    });
    const providers = buildProviderMap();

    expect(providers.get('ORACLE-CRAWL4AI-5')?.costPerRequest).toBe(0.0035);
  }, 120000);
});
