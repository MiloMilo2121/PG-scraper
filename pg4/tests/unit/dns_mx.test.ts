import { describe, it, expect } from 'vitest';
import { DnsMxProvider } from '../../src/providers/serp/dns_mx';

const okMx = async (host: string) => {
  if (host === 'noexist.invalid') throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  if (host === 'gmail-only.it') return [{ priority: 10, exchange: 'aspmx.l.google.com.' }];
  if (host === 'aruba-mail.it') return [{ priority: 10, exchange: 'mx.aruba.it' }];
  return [{ priority: 10, exchange: `mx.${host}` }];
};

describe('DnsMxProvider', () => {
  it('extracts domain from raw email and returns MX-verified result', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('foo@example.it');
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('https://example.it');
    expect(r[0].source_provider).toBe('dns_mx');
  });

  it('extracts domain from a bare domain literal', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('example.it');
    expect(r[0].url).toBe('https://example.it');
  });

  it('flags Google Workspace / Outlook MX in snippet', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('gmail-only.it');
    expect(r[0].snippet.toLowerCase()).toContain('business-grade');
  });

  it('flags Aruba (Italian provider) as enterprise mail', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('aruba-mail.it');
    expect(r[0].snippet.toLowerCase()).toContain('business-grade');
  });

  it('returns [] when MX lookup throws', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('noexist.invalid');
    expect(r).toEqual([]);
  });

  it('falls back to .it heuristic for free-form queries', async () => {
    const p = new DnsMxProvider(okMx as never);
    const r = await p.search('Mario Rossi SRL');
    expect(r[0].url).toBe('https://mariorossisrl.it');
  });
});
