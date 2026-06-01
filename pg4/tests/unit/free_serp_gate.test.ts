/**
 * R14 — free SERP provider pruning.
 *
 * Verifies the low-yield free providers (dns_mx, crtsh, ddg_lite) are OFF by
 * default and gated by env flags, while bing_html stays always-available and
 * the paid Serper gate is unchanged. Routing assertions use fakes (no network).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from '../../src/config/env';
import { DnsMxProvider } from '../../src/providers/serp/dns_mx';
import { CrtshProvider } from '../../src/providers/serp/crtsh';
import { DdgLiteProvider } from '../../src/providers/serp/ddg_lite';
import { BingHtmlProvider } from '../../src/providers/serp/bing_html';
import { SerperProvider } from '../../src/providers/serp/serper';
import { buildProviderCatalog } from '../../src/providers/provider_catalog';
import { ProviderRouter } from '../../src/providers/provider_router';
import { CostLedger } from '../../src/runtime/cost_ledger';
import { CircuitBreaker } from '../../src/runtime/circuit_breaker';
import type { SerpProvider, SerpResult } from '../../src/types/providers';

const GATED = [
  'SERP_DNS_MX_ENABLED',
  'SERP_CRTSH_ENABLED',
  'SERP_DDG_LITE_ENABLED',
  'SERPER_ENABLED',
  'SERPER_API_KEY',
] as const;

function clearEnv(): void {
  for (const k of GATED) delete process.env[k];
  resetEnvCache();
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe('R14 free SERP gate — defaults', () => {
  it('dns_mx / crtsh / ddg_lite are disabled by default', () => {
    expect(new DnsMxProvider().available()).toBe(false);
    expect(new CrtshProvider().available()).toBe(false);
    expect(new DdgLiteProvider().available()).toBe(false);
  });

  it('bing_html stays available by default (not gated)', () => {
    expect(new BingHtmlProvider().available()).toBe(true);
  });

  it('default env flags resolve to false', () => {
    const env = getEnv();
    expect(env.SERP_DNS_MX_ENABLED).toBe(false);
    expect(env.SERP_CRTSH_ENABLED).toBe(false);
    expect(env.SERP_DDG_LITE_ENABLED).toBe(false);
  });
});

describe('R14 free SERP gate — explicit enable', () => {
  it('each provider becomes available when its flag is true', () => {
    process.env.SERP_DNS_MX_ENABLED = 'true';
    process.env.SERP_CRTSH_ENABLED = 'true';
    process.env.SERP_DDG_LITE_ENABLED = 'true';
    resetEnvCache();
    expect(new DnsMxProvider().available()).toBe(true);
    expect(new CrtshProvider().available()).toBe(true);
    expect(new DdgLiteProvider().available()).toBe(true);
  });

  it('enabling one does not enable the others', () => {
    process.env.SERP_DDG_LITE_ENABLED = 'true';
    resetEnvCache();
    expect(new DdgLiteProvider().available()).toBe(true);
    expect(new DnsMxProvider().available()).toBe(false);
    expect(new CrtshProvider().available()).toBe(false);
  });
});

describe('R14 free SERP gate — paid Serper unchanged', () => {
  it('serper stays gated by SERPER_ENABLED + key, not by the new flags', () => {
    // new free flags on, serper off → serper still unavailable
    process.env.SERP_DNS_MX_ENABLED = 'true';
    resetEnvCache();
    expect(new SerperProvider().available()).toBe(false);

    process.env.SERPER_ENABLED = 'true';
    process.env.SERPER_API_KEY = 'k-test';
    resetEnvCache();
    expect(new SerperProvider().available()).toBe(true);
  });
});

describe('R14 free SERP gate — catalog capability surface', () => {
  it('default catalog marks the three free providers (disabled), keeps bing + serper', () => {
    const router = buildProviderCatalog(new CostLedger());
    const serp = router.describe().serp;
    expect(serp).toContain('dns_mx@T0(disabled)');
    expect(serp).toContain('crtsh@T0(disabled)');
    expect(serp).toContain('ddg_lite@T1(disabled)');
    expect(serp).toContain('bing_html@T1'); // available → no (disabled) suffix
    expect(serp).toContain('serper@T2(disabled)'); // paid, off by default
  });
});

// ---- routing (network-free fakes) ----

class FakeSerp implements SerpProvider {
  callCount = 0;
  constructor(
    readonly id: string,
    readonly tier: number,
    private readonly isAvailable: boolean,
    private readonly results: SerpResult[],
  ) {}
  readonly family = 'serp' as const;
  readonly costPerCallEur = 0;
  available(): boolean {
    return this.isAvailable;
  }
  async search(): Promise<SerpResult[]> {
    this.callCount++;
    return this.results;
  }
}

const RESULT: SerpResult[] = [
  { title: 'A', url: 'https://a.example', snippet: '', rank: 1, source_provider: 'fake' },
];

describe('R14 free SERP gate — routing', () => {
  it('router never calls a disabled provider, but runs an available one', async () => {
    const disabled = new FakeSerp('dns_mx_like', 0, false, RESULT);
    const bingLike = new FakeSerp('bing_like', 1, true, RESULT);
    const router = new ProviderRouter([disabled, bingLike], [], [], new CostLedger());

    const out = await router.search('agenzia immobiliare padova', { maxTier: 1 });

    expect(disabled.callCount).toBe(0);
    expect(bingLike.callCount).toBe(1);
    expect(out.provider).toBe('bing_like');
  });

  it('an empty SERP result does not trip the circuit breaker', async () => {
    const empty = new FakeSerp('bing_like', 1, true, []);
    const breaker = new CircuitBreaker();
    const router = new ProviderRouter([empty], [], [], new CostLedger(), breaker);

    for (let i = 0; i < 20; i++) {
      const out = await router.search(`q${i}`, { maxTier: 1 });
      expect(out.provider).toBe('none'); // empty → clean miss, not a failure
    }
    expect(breaker.allow('bing_like')).toBe(true); // 20 empties, breaker still closed
  });
});
