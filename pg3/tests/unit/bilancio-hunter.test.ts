import { describe, expect, it, vi } from 'vitest';
import { BilancioHunter } from '../../src/foundation/BilancioHunter';

describe('BilancioHunter', () => {
  it('aggregates multi-query evidence and survives single-query failures', async () => {
    const route = vi.fn(async (_taskType: unknown, payload: { query: string }) => {
      if (payload.query.includes('"12345678901" filetype:pdf')) {
        throw new Error('temporary provider failure');
      }

      if (payload.query.includes('site:fatturatoitalia.it')) {
        return {
          provider: 'SERPER',
          data: [
            {
              url: 'https://www.fatturatoitalia.it/acme-srl-12345678901',
              title: 'ACME SRL fatturato e dipendenti',
              snippet: 'ACME SRL Milano partita iva 12345678901',
            },
          ],
        };
      }

      if (payload.query.includes('filetype:pdf')) {
        return {
          provider: 'BING',
          data: [
            {
              url: 'https://docs.example.com/acme-bilancio-2023.pdf',
              title: 'Bilancio ACME SRL 2023',
              snippet: 'ACME SRL Milano fatturato € 1.500.000 nel 2023',
            },
          ],
        };
      }

      return { provider: 'BING', data: [] };
    });

    const hunter = new BilancioHunter({ route } as any);
    const result = await hunter.hunt('company-1', {
      company_name: 'ACME SRL',
      company_name_variants: ['ACME SRL'],
      city: 'Milano',
      provincia: 'MI',
      vat_code: '12345678901',
    } as any);

    expect(route).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.fatturato_current).toBe(1500000);
    expect(result?.year).toBe(2023);
    expect(result?.source_url).toBe('https://docs.example.com/acme-bilancio-2023.pdf');
    expect(result?.source_trust).toBe('medium');
    expect(result?.entity_match_status).toBe('matched');
    expect(result?.attempted_queries).toBeGreaterThan(1);
    expect(result?.candidate_count).toBeGreaterThanOrEqual(2);
  });

  it('returns high-trust source-only evidence when directory match is strong', async () => {
    const route = vi.fn(async () => ({
      provider: 'SERPER',
      data: [
        {
          url: 'https://www.fatturatoitalia.it/acme-srl-12345678901',
          title: 'ACME SRL fatturato e dipendenti',
          snippet: 'ACME SRL Milano partita iva 12345678901',
        },
      ],
    }));

    const hunter = new BilancioHunter({ route } as any);
    const result = await hunter.hunt('company-2', {
      company_name: 'ACME SRL',
      company_name_variants: ['ACME SRL'],
      city: 'Milano',
      provincia: 'MI',
      vat_code: '12345678901',
    } as any);

    expect(result).not.toBeNull();
    expect(result?.fatturato_current).toBeUndefined();
    expect(result?.source_url).toContain('fatturatoitalia.it');
    expect(result?.source_trust).toBe('high');
    expect(result?.entity_match_status).toBe('matched');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
