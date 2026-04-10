import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('TLS policy', () => {
  it('requires both the emergency flag and an allowlist match', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      TLS_RELAX_ENABLED: 'true',
      TLS_RELAX_ALLOWLIST: 'allowed.example.com,*.insecure.test',
    };

    const { shouldRelaxTlsForUrl } = await import('../../src/shared-runtime/browser/tls_policy');

    expect(shouldRelaxTlsForUrl('https://allowed.example.com/path')).toBe(true);
    expect(shouldRelaxTlsForUrl('https://api.insecure.test/path')).toBe(true);
    expect(shouldRelaxTlsForUrl('https://blocked.example.com/path')).toBe(false);
  });

  it('stays strict when the emergency flag is disabled', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      TLS_RELAX_ALLOWLIST: 'allowed.example.com',
    };

    const { shouldRelaxTlsForUrl } = await import('../../src/shared-runtime/browser/tls_policy');

    expect(shouldRelaxTlsForUrl('https://allowed.example.com/path')).toBe(false);
  });
});

