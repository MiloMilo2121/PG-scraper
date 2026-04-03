import { describe, expect, it, vi } from 'vitest';
import { LinkedInSniper } from '../../src/foundation/LinkedInSniper';

function buildRouteResult(provider: string, data: Array<{ url: string; title: string; snippet?: string }>) {
  return {
    provider,
    data,
    tier: 1,
    cost_eur: 0.001,
    duration_ms: 120,
    cache_hit: false,
    cache_level: 'MISS' as const,
  };
}

describe('LinkedInSniper', () => {
  it('uses multi-query evidence and prefers the best linkedin profile', async () => {
    const router = {
      route: vi.fn(async (_taskType: string, payload: { query: string }) => {
        if (payload.query.includes('site:linkedin.com/in')) {
          return buildRouteResult('SERPER-API-1', [
            {
              url: 'https://www.linkedin.com/in/luca-bianchi',
              title: 'Luca Bianchi - Recruiter | LinkedIn',
              snippet: 'Recruiter a Roma',
            },
            {
              url: 'https://www.linkedin.com/in/mario-rossi-123',
              title: 'Mario Rossi - Founder - ACME Immobiliare | LinkedIn',
              snippet: 'Founder presso ACME Immobiliare a Milano',
            },
          ]);
        }

        if (payload.query.includes('site:acmeimmobiliare.it')) {
          return buildRouteResult('SERPER-API-1', [
            {
              url: 'https://acmeimmobiliare.it/chi-siamo',
              title: 'Mario Rossi | ACME Immobiliare',
              snippet: 'Mario Rossi è il titolare di ACME Immobiliare a Milano.',
            },
          ]);
        }

        return buildRouteResult('EXA-API-2', [
          {
            url: 'https://acmeimmobiliare.it/news/mario-rossi-intervista',
            title: 'Mario Rossi racconta ACME Immobiliare',
            snippet: 'Il founder Mario Rossi guida ACME Immobiliare da Milano.',
          },
        ]);
      }),
    };

    const sniper = new LinkedInSniper(router as any);
    const result = await sniper.snipeDetailed('cmp-1', {
      company_name: 'ACME Immobiliare S.R.L.',
      company_name_variants: ['ACME Immobiliare', 'ACME'],
      city: 'Milano',
      provincia: 'MI',
      website: 'https://www.acmeimmobiliare.it',
      quality_score: 0.91,
    }, 'https://www.acmeimmobiliare.it');

    expect(result.decisionMaker?.name).toBe('Mario Rossi');
    expect(result.decisionMaker?.source_kind).toBe('linkedin_profile');
    expect(result.attempted_count).toBeGreaterThan(2);
    expect(result.evidence_count).toBeGreaterThanOrEqual(3);
    expect(result.entity_match_status).toBe('matched');
    expect(result.providers).toContain('SERPER-API-1');
  });

  it('falls back to company-site people pages when linkedin evidence is absent', async () => {
    const router = {
      route: vi.fn(async (_taskType: string, payload: { query: string }) => {
        if (payload.query.includes('site:linkedin.com/in')) {
          return buildRouteResult('SERPER-API-1', []);
        }

        return buildRouteResult('SERPER-API-1', [
          {
            url: 'https://www.casaverde.it/team',
            title: 'Luca Bianchi - Titolare | Casa Verde',
            snippet: 'Luca Bianchi è il titolare di Casa Verde a Bergamo.',
          },
        ]);
      }),
    };

    const sniper = new LinkedInSniper(router as any);
    const result = await sniper.snipeDetailed('cmp-2', {
      company_name: 'Casa Verde Immobiliare',
      company_name_variants: ['Casa Verde Immobiliare', 'Casa Verde'],
      city: 'Bergamo',
      provincia: 'BG',
      website: 'https://www.casaverde.it',
      quality_score: 0.88,
    }, 'https://www.casaverde.it');

    expect(result.decisionMaker?.name).toBe('Luca Bianchi');
    expect(result.decisionMaker?.source_kind).toBe('company_site');
    expect(result.decisionMaker?.linkedin_url).toBe('https://www.casaverde.it/team');
    expect(result.entity_match_status === 'matched' || result.entity_match_status === 'semantic').toBe(true);
    expect(result.detail).toContain('company-site');
  });
});
