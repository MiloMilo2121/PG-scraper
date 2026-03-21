import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProxyTier } from '../../src/foundation/network/proxy_tier_v9';

const originalEnv = { ...process.env };

describe('ProxyTier V9 shared contract', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exposes the shared tier enum for network cloak and browser managers', async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.DISABLE_PROXY = 'false';
    process.env.PROXY_DATACENTER_URL = 'http://dc1.local:8000';

    const { ProxyManagerV9 } = await import('../../src/scraper/core/browser/proxy_manager_v9');
    const manager = ProxyManagerV9.getInstance();
    const proxy = manager.getProxyForTier(ProxyTier.DATACENTER);

    expect(ProxyTier.MOBILE).toBe('MOBILE');
    expect(proxy.server).toBe('http://dc1.local:8000');
  });
});
