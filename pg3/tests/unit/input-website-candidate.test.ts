import { describe, expect, it } from 'vitest';
import { InputWebsiteCandidate } from '../../src/foundation/InputWebsiteCandidate';

describe('InputWebsiteCandidate', () => {
  it('rejects messaging and directory URLs as official-site candidates', () => {
    expect(InputWebsiteCandidate.assess('https://wa.me/393331234567').reasonCode).toBe('INPUT_WEBSITE_MESSAGING_OR_REDIRECT');
    expect(InputWebsiteCandidate.assess('https://aziende.virgilio.it/acme').reasonCode).toBe('INPUT_WEBSITE_DIRECTORY_OR_SOCIAL');
  });

  it('builds canonical candidates from a valid company website input', () => {
    const assessment = InputWebsiteCandidate.assess('http://acme.it/contatti?utm_source=test');

    expect(assessment.classification).toBe('VALID');
    expect(assessment.candidates).toContain('http://acme.it/contatti');
    expect(assessment.candidates).toContain('http://acme.it');
    expect(assessment.candidates).toContain('https://acme.it/contatti');
    expect(assessment.candidates).toContain('https://www.acme.it');
  });

  it('falls back from service subdomains to the registrable company domain', () => {
    const assessment = InputWebsiteCandidate.assess('https://mail.acme.it/login');

    expect(assessment.classification).toBe('VALID');
    expect(assessment.candidates).toContain('https://mail.acme.it/login');
    expect(assessment.candidates).toContain('https://mail.acme.it');
    expect(assessment.candidates).toContain('https://acme.it');
    expect(assessment.candidates).toContain('https://www.acme.it');
  });

  it('rejects junk hostname fragments extracted from initials and legal suffixes', () => {
    expect(InputWebsiteCandidate.assess('https://s.r.l').classification).toBe('INVALID');
    expect(InputWebsiteCandidate.assess('https://i.t.m').classification).toBe('INVALID');
  });
});
