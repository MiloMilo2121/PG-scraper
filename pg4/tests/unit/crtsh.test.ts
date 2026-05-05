import { describe, it, expect } from 'vitest';
import { CrtshProvider } from '../../src/providers/serp/crtsh';

describe('CrtshProvider.parseEntries', () => {
  it('extracts unique hosts from CT entries', () => {
    const p = new CrtshProvider();
    const entries = [
      { common_name: 'example.it', name_value: 'example.it\nwww.example.it', issuer_name: "Let's Encrypt" },
      { common_name: 'mail.example.it', name_value: 'mail.example.it', issuer_name: "Let's Encrypt" },
    ];
    const out = p.parseEntries(entries, 25);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.url)).toEqual([
      'https://example.it',
      'https://www.example.it',
      'https://mail.example.it',
    ]);
  });

  it('drops wildcard SAN entries', () => {
    const p = new CrtshProvider();
    const out = p.parseEntries(
      [{ common_name: '*.example.it', name_value: 'example.it\n*.example.it' }],
      25
    );
    expect(out.map((r) => r.url)).toEqual(['https://example.it']);
  });

  it('honors limit', () => {
    const p = new CrtshProvider();
    const entries = Array.from({ length: 50 }, (_, i) => ({ name_value: `host${i}.example.it` }));
    expect(p.parseEntries(entries, 5)).toHaveLength(5);
  });

  it('returns [] when entries are empty', () => {
    expect(new CrtshProvider().parseEntries([], 25)).toEqual([]);
  });
});
