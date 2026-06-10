import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { extractFromBody, registrableDomain } from '../../src/enrichment/extract/extract_from_body';

/**
 * Phase 1 (free-gold) — the pure body extractor. Offline, deterministic,
 * fixture-driven. No network. Italian SMB page shapes.
 */

const FIX = path.join(__dirname, '..', 'fixtures', 'extract');
const load = (name: string): string => fs.readFileSync(path.join(FIX, name), 'utf8');

describe('registrableDomain', () => {
  it('reduces host/URL to last two labels, strips www/scheme/path', () => {
    expect(registrableDomain('https://www.studiorossi.it/contatti')).toBe('studiorossi.it');
    expect(registrableDomain('mail.studiorossi.it')).toBe('studiorossi.it');
    expect(registrableDomain('studiorossi.it')).toBe('studiorossi.it');
    expect(registrableDomain(undefined)).toBeUndefined();
    expect(registrableDomain('localhost')).toBeUndefined();
  });
});

describe('extractFromBody — email', () => {
  it('keeps the same-domain business email, rejects 3rd-party (gmail)', () => {
    const ex = extractFromBody(load('it_site_mailto_footer.html'), { official_website: 'https://studiorossi.it' });
    // info@ or amministrazione@ — both on studiorossi.it; gmail rejected.
    expect(ex.email).toBeDefined();
    expect(ex.email!.endsWith('@studiorossi.it')).toBe(true);
    expect(ex.email).not.toContain('gmail');
  });

  it('with unknown own-domain, accepts the first non-PEC email (weak)', () => {
    const ex = extractFromBody(load('it_site_mailto_footer.html'), {});
    expect(ex.email).toBeDefined();
  });
});

describe('extractFromBody — PEC + phone', () => {
  it('splits the PEC from the business email and captures the landline', () => {
    const ex = extractFromBody(load('it_site_pec_and_phone.html'), { official_website: 'https://neriservizi.it' });
    expect(ex.email).toBe('contatti@neriservizi.it');
    expect(ex.pec).toBe('neriservizi@pec.it');
    // phone normalised: +39 stripped, digits only
    expect(ex.phones).toContain('0422591177');
  });
});

describe('extractFromBody — socials', () => {
  it('captures profile/company URLs, rejects share-intent/post links', () => {
    const ex = extractFromBody(load('it_site_footer_socials.html'), { official_website: 'https://bianchicase.it' });
    expect(ex.instagram).toBe('https://instagram.com/agenziabianchi');
    expect(ex.facebook).toBe('https://facebook.com/agenziabianchicase');
    expect(ex.linkedin).toBe('https://linkedin.com/company/agenzia-bianchi');
    // none of them should be a share/post URL
    expect(ex.instagram).not.toContain('/p/');
    expect(ex.facebook).not.toContain('sharer');
    expect(ex.linkedin).not.toContain('shareArticle');
  });
});

describe('extractFromBody — VAT (checksum-gated)', () => {
  it('extracts the checksum-valid P.IVA, rejects the bad-checksum decoy', () => {
    const ex = extractFromBody(load('it_site_legal_footer_piva.html'), { official_website: 'https://verdicostruzioni.it' });
    expect(ex.vat_candidates).toContain('01234567897');
    expect(ex.vat_candidates).not.toContain('01234567890'); // decoy fails checksum
  });
});

describe('extractFromBody — no signal / robustness', () => {
  it('returns an empty extraction (no throw) on a blank page', () => {
    const ex = extractFromBody(load('no_signal.html'), { official_website: 'https://x.it' });
    expect(ex.email).toBeUndefined();
    expect(ex.pec).toBeUndefined();
    expect(ex.instagram).toBeUndefined();
    expect(ex.vat_candidates).toEqual([]);
    expect(ex.phones).toEqual([]);
  });

  it('never throws on empty/garbage input', () => {
    expect(() => extractFromBody(undefined, {})).not.toThrow();
    expect(() => extractFromBody('', {})).not.toThrow();
    expect(() => extractFromBody('<<<not html', {})).not.toThrow();
    expect(extractFromBody(undefined, {}).vat_candidates).toEqual([]);
  });
});
