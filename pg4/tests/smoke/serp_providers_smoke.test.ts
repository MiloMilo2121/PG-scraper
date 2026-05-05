import { describe, it, expect } from 'vitest';
import { DnsMxProvider } from '../../src/providers/serp/dns_mx';
import { CrtshProvider } from '../../src/providers/serp/crtsh';
import { DdgLiteProvider } from '../../src/providers/serp/ddg_lite';
import { BingHtmlProvider } from '../../src/providers/serp/bing_html';

const ENABLED = process.env.RUN_SMOKE === '1' || process.env.RUN_SMOKE === 'true';

describe.runIf(ENABLED)('smoke: SERP providers (live)', () => {
  it('DnsMxProvider resolves a known domain', async () => {
    const r = await new DnsMxProvider().search('example.com');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].url).toBe('https://example.com');
  });

  it('CrtshProvider returns SAN domains for example.com', async () => {
    const r = await new CrtshProvider().search('example.com', { limit: 5 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.url.startsWith('https://'))).toBe(true);
  }, 20000);

  it('DdgLiteProvider returns results for a generic query (best effort)', async () => {
    const r = await new DdgLiteProvider().search('"example.com"', { limit: 5 });
    // DDG occasionally serves blocks — we only assert the call did not throw.
    expect(Array.isArray(r)).toBe(true);
  }, 20000);

  it('BingHtmlProvider returns results for a generic query (best effort)', async () => {
    const r = await new BingHtmlProvider().search('"example.com"', { limit: 5 });
    expect(Array.isArray(r)).toBe(true);
  }, 20000);
});

describe.skipIf(ENABLED)('smoke: SERP providers (skipped, RUN_SMOKE not set)', () => {
  it('placeholder', () => expect(true).toBe(true));
});
