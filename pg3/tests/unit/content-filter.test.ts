import { describe, expect, it } from 'vitest';
import { ContentFilter } from '../../src/enricher/core/discovery/content_filter';

describe('ContentFilter', () => {
  it('blocks known directory/social domains and subdomains', () => {
    expect(ContentFilter.isDirectoryOrSocial('https://facebook.com/page')).toBe(true);
    expect(ContentFilter.isDirectoryOrSocial('https://it.linkedin.com/company/x')).toBe(true);
    expect(ContentFilter.isDirectoryOrSocial('https://shop.paginegialle.it/abc')).toBe(true);
  });

  it('does not block unrelated domains that only contain similar substrings', () => {
    expect(ContentFilter.isDirectoryOrSocial('https://facebookmania.it')).toBe(false);
    expect(ContentFilter.isDirectoryOrSocial('https://mylinkedincoach.it')).toBe(false);
  });

  it('detects directory-like titles', () => {
    expect(ContentFilter.isDirectoryLikeTitle('Elenco aziende idraulici Milano')).toBe(true);
    expect(ContentFilter.isDirectoryLikeTitle('Rossi Impianti - Home')).toBe(false);
  });

  it('does NOT block valid titles containing single key words', () => {
    // These used to be blocked by single-word filters ("aziende", "orari", "trova")
    // Now they should be allowed.
    expect(ContentFilter.isDirectoryLikeTitle('Le nostre Aziende Partner')).toBe(false);
    expect(ContentFilter.isDirectoryLikeTitle('Orari di Apertura')).toBe(false);
    expect(ContentFilter.isDirectoryLikeTitle('Trova la tua strada')).toBe(false);
  });
});
