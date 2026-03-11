import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('ProxyManagerV9', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.DISABLE_PROXY = 'false';
    process.env.PROXY_DATACENTER_URL = 'http://dc1.local:8000,http://dc2.local:8000';
    process.env.PROXY_RESIDENTIAL_URL = 'http://res1.local:9000';
    process.env.PROXY_MOBILE_URL = 'http://mob1.local:10000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rotates proxies within the same tier', async () => {
    const { ProxyManagerV9, ProxyTier } = await import('../../src/scraper/core/browser/proxy_manager_v9');
    const manager = ProxyManagerV9.getInstance();

    const first = manager.getProxyForTier(ProxyTier.DATACENTER);
    const second = manager.getProxyForTier(ProxyTier.DATACENTER);

    expect(first.server).toBe('http://dc1.local:8000');
    expect(second.server).toBe('http://dc2.local:8000');
  });

  it('skips failed nodes and falls back to the next healthy proxy', async () => {
    const { ProxyManagerV9, ProxyTier } = await import('../../src/scraper/core/browser/proxy_manager_v9');
    const manager = ProxyManagerV9.getInstance();

    manager.markFailed('http://dc1.local:8000');

    const proxy = manager.getProxyForTier(ProxyTier.DATACENTER);
    expect(proxy.server).toBe('http://dc2.local:8000');
  });
});
