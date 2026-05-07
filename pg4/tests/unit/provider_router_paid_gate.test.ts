import { describe, it, expect } from 'vitest';
import { ProviderRouter } from '../../src/providers/provider_router';
import { CostLedger } from '../../src/runtime/cost_ledger';
import type { SerpProvider, SerpResult } from '../../src/types/providers';

/**
 * Phase G — paid-gate router tests. Default-deny is the load-bearing
 * safety: a run without `paidEnabled: true` MUST NOT reach any
 * provider with cost > 0, regardless of tier or budget hints.
 */

class FakeFreeSerp implements SerpProvider {
  id = 'fake_free';
  family = 'serp' as const;
  tier = 1;
  costPerCallEur = 0;
  callCount = 0;
  available() { return true; }
  async search(): Promise<SerpResult[]> {
    this.callCount++;
    return [{ title: 'free', url: 'https://free.example', snippet: '', rank: 1, source_provider: this.id }];
  }
}

class FakePaidSerp implements SerpProvider {
  id = 'fake_paid';
  family = 'serp' as const;
  tier = 2;
  costPerCallEur = 0.001;
  callCount = 0;
  available() { return true; }
  async search(): Promise<SerpResult[]> {
    this.callCount++;
    return [{ title: 'paid', url: 'https://paid.example', snippet: '', rank: 1, source_provider: this.id }];
  }
}

describe('ProviderRouter — Phase G paid gate', () => {
  it('paidEnabled default-false: paid providers are NEVER called', async () => {
    const ledger = new CostLedger();
    const free = new FakeFreeSerp();
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([free, paid], [], [], ledger);
    // No paidEnabled, no maxTier — a naive default would let tier 2 through.
    await router.search('q');
    expect(free.callCount).toBe(1);
    expect(paid.callCount).toBe(0);
  });

  it('paidEnabled=false explicit: paid providers are filtered out', async () => {
    const ledger = new CostLedger();
    const free = new FakeFreeSerp();
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([free, paid], [], [], ledger);
    await router.search('q', { paidEnabled: false });
    expect(paid.callCount).toBe(0);
  });

  it('paidEnabled=true with budget allows paid', async () => {
    // Free returns nothing, so router falls through to paid.
    const ledger = new CostLedger();
    const empty = new FakeFreeSerp();
    empty.search = async () => [];
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([empty, paid], [], [], ledger);
    const r = await router.search('q', { paidEnabled: true, remainingLeadBudgetEur: 0.01 });
    expect(paid.callCount).toBe(1);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('paidEnabled=true but remainingLeadBudgetEur < cost blocks the paid call', async () => {
    const ledger = new CostLedger();
    const empty = new FakeFreeSerp();
    empty.search = async () => [];
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([empty, paid], [], [], ledger);
    await router.search('q', { paidEnabled: true, remainingLeadBudgetEur: 0.0005 }); // < 0.001
    expect(paid.callCount).toBe(0);
  });

  it('paidEnabled=true with includeProviderIds limits to listed paid ids only', async () => {
    const ledger = new CostLedger();
    const free = new FakeFreeSerp();
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([free, paid], [], [], ledger);
    // Target the paid provider explicitly; the free provider gets
    // filtered by includeProviderIds even though it's free.
    await router.search('q', { paidEnabled: true, remainingLeadBudgetEur: 1, includeProviderIds: ['fake_paid'] });
    expect(free.callCount).toBe(0);
    expect(paid.callCount).toBe(1);
  });

  it('cost ceiling 0 + paidEnabled=false: ledger total cost is 0', async () => {
    const ledger = new CostLedger();
    const free = new FakeFreeSerp();
    const paid = new FakePaidSerp();
    const router = new ProviderRouter([free, paid], [], [], ledger);
    await router.search('q'); // paidEnabled default-false
    expect(ledger.getTotal()).toBe(0);
    expect(paid.callCount).toBe(0);
  });
});
