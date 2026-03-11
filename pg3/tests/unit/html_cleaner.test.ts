import { describe, expect, it } from 'vitest';
import { HTMLCleaner } from '../../src/enricher/utils/html_cleaner';

describe('HTMLCleaner', () => {
  const html = `
    <html>
      <head>
        <title>Officine Rossi</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "email": "amministrazione@officinerossi.it",
            "telephone": "+39 049 1234567",
            "vatID": "IT01114601006"
          }
        </script>
      </head>
      <body>
        <main>
          <h1>Officine Rossi</h1>
          <p>Produzione minuterie metalliche per il settore industriale.</p>
        </main>
        <footer>
          <a href="mailto:commerciale@officinerossi.it">Email</a>
          <a href="mailto:pec@officinerossi.pec.it">PEC</a>
          <a href="tel:+390491234567">Tel</a>
        </footer>
      </body>
    </html>
  `;

  it('extracts deterministic contact candidates from JSON-LD and links', () => {
    const candidates = HTMLCleaner.extractContactCandidates(html);
    const best = HTMLCleaner.selectBestContactCandidates(candidates);

    expect(candidates.some((candidate) => candidate.kind === 'vat' && candidate.value === '01114601006')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'pec' && candidate.value === 'pec@officinerossi.pec.it')).toBe(true);
    expect(best.email).toBe('amministrazione@officinerossi.it');
    expect(best.pec).toBe('pec@officinerossi.pec.it');
  });

  it('injects contact candidate summary into the contact section', () => {
    const cleaned = HTMLCleaner.extract(html, 2500, true);
    expect(cleaned.contactSection).toContain('VAT');
    expect(cleaned.contactSection).toContain('PEC');
  });
});
