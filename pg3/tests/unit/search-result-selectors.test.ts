import { describe, expect, it } from 'vitest';
import {
  pickFinancialSearchResult,
  pickLinkedInProfileResult,
  scoreFinancialSearchResult,
  scoreLinkedInProfileResult,
} from '../../src/shared-runtime/routing/search_result_selectors';

describe('search result selectors', () => {
  it('reranks linkedin profiles using company, location, and role hints', () => {
    const results = [
      {
        url: 'https://www.linkedin.com/in/mario-rossi',
        title: 'Mario Rossi - Founder - ACME SRL | LinkedIn',
        snippet: 'Founder presso ACME SRL a Milano',
      },
      {
        url: 'https://www.linkedin.com/in/luca-bianchi',
        title: 'Luca Bianchi - Recruiter | LinkedIn',
        snippet: 'Recruiter a Roma',
      },
    ];

    const best = pickLinkedInProfileResult(results, {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      roleTokens: ['founder', 'ceo', 'titolare'],
    });

    expect(best?.url).toBe('https://www.linkedin.com/in/mario-rossi');
    expect(scoreLinkedInProfileResult(results[0], {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      roleTokens: ['founder'],
    })).toBeGreaterThan(scoreLinkedInProfileResult(results[1], {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      roleTokens: ['founder'],
    }));
  });

  it('prefers strong financial sources and documents', () => {
    const results = [
      {
        url: 'https://www.example.com/doc.pdf',
        title: 'Bilancio ACME 2023',
        snippet: 'Bilancio 2023 ACME SRL Milano',
      },
      {
        url: 'https://www.fatturatoitalia.it/acme-srl-12345678901',
        title: 'ACME SRL fatturato e dipendenti',
        snippet: 'fatturato ACME SRL partita iva 12345678901',
      },
    ];

    const best = pickFinancialSearchResult(results, {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      vat: '12345678901',
    });

    expect(best?.url).toBe('https://www.fatturatoitalia.it/acme-srl-12345678901');
    expect(scoreFinancialSearchResult(results[1], {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      vat: '12345678901',
    })).toBeGreaterThan(scoreFinancialSearchResult(results[0], {
      companyTokens: ['acme'],
      locationTokens: ['milano'],
      vat: '12345678901',
    }));
  });
});
