import { describe, it, expect } from 'vitest';
import { verifyCandidates } from '../../src/enrichment/stages/verify_candidates';
import { normalizeLead } from '../../src/discovery/input_normalizer';
import type { Lead } from '../../src/types/lead';

/**
 * Phase D.2 — verify retry-on-transport behaviour.
 *
 * Real-world driver: `pianon.eu` returned `200 OK` on call 1 and
 * `ECONNREFUSED` on call 2 from the same client IP. We lost the TP for
 * a transport flap, not a logic problem. A single retry recovers it
 * without relaxing any semantic rule.
 *
 * Rules:
 *   1. Retry only on transport / timeout failure kinds.
 *   2. Never retry on 4xx, semantic rejection, parked pages, rate
 *      limits, captcha / block.
 *   3. Two consecutive transport failures → still NOT_FOUND (no
 *      runaway retry storm).
 */

function fakeRouter(plan: Array<{ status: number; html?: string; error?: string }>) {
  let i = 0;
  return {
    fetch: async (_url: string) => {
      const next = plan[Math.min(i, plan.length - 1)];
      i++;
      return { provider: 'direct_fetch', duration_ms: 5, cost_eur: 0, ...next };
    },
    fetchCalls: () => i,
  } as any;
}

const realEstateBody =
  'Compravendita e locazione di appartamenti. Immobili in vendita. ' +
  'Trovi monolocale, bilocale, trilocale, ville e immobili commerciali. ' +
  'Servizio di valutazione gratuita. Consulenza per mutuo. Selezioniamo ' +
  'accuratamente gli immobili in linea con le richieste della clientela. ' +
  'Pubblichiamo costantemente nuove proposte di immobili in vendita e in affitto. ' +
  'Servizi offerti: gestione contratti di locazione, consulenza fiscale sugli ' +
  'investimenti, verifica della regolarità urbanistica e catastale. ' +
  'Iscritta al ruolo agenti immobiliari. ' +
  'Contatti per richiedere informazioni o fissare un appuntamento. ' +
  'La nostra agenzia opera da oltre venti anni nel territorio bellunese, ' +
  'garantendo serieta e professionalita a chi cerca o vende casa nelle Dolomiti. ' +
  'Lavoriamo con appartamenti, case singole, ville, terreni edificabili, attivita commerciali. ' +
  'Visita la sede in centro a Belluno per scoprire tutte le proposte disponibili.';
const goodHtml = `<html><head><title>Pianon</title></head><body><h1>Pianon</h1><p>${realEstateBody}</p></body></html>`;

const lead: Lead = { company_name: 'Pianon Immobiliare', city: 'Belluno', category: 'agenzie immobiliari' };
const normalized = normalizeLead(lead);
const noOpRdap = async () => ({ confidence: 0, evidence: 'none' as const });

describe('verifyCandidates — Phase D.2 transport retry', () => {
  it('retries once on ECONNREFUSED and accepts on the second try (200)', async () => {
    const router = fakeRouter([
      { status: 0, error: 'ECONNREFUSED 167.235.73.251' }, // first attempt
      { status: 200, html: goodHtml }, // retry succeeds
    ]);
    const lead2: Lead = { ...lead };
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, lead2, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(true);
    expect(router.fetchCalls()).toBe(2);
    expect(lead2.official_website).toBe('https://pianon.eu');
  });

  it('retries once on ETIMEDOUT and accepts on the second try', async () => {
    const router = fakeRouter([
      { status: 0, error: 'request ETIMEDOUT after 5000ms' },
      { status: 200, html: goodHtml },
    ]);
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(true);
    expect(router.fetchCalls()).toBe(2);
  });

  it('does NOT retry on 404 (not transport-class)', async () => {
    const router = fakeRouter([
      { status: 404, error: 'not found' },
      { status: 200, html: goodHtml },
    ]);
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(false);
    expect(router.fetchCalls()).toBe(1); // no retry — 4xx is a per-target outcome
  });

  it('does NOT retry on 429 rate-limit (would just re-trigger the limit)', async () => {
    const router = fakeRouter([
      { status: 429, error: 'rate limit exceeded' },
      { status: 200, html: goodHtml },
    ]);
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(false);
    expect(router.fetchCalls()).toBe(1);
  });

  it('does NOT retry when the gate semantically rejects a fetched page', async () => {
    // First fetch is 200 + html, but the gate rejects (carpentry body
    // doesn't have the lead's brand). No transport failure → no retry.
    const conflictHtml =
      '<html><body>' +
      'Cartoleria e cancelleria, toner e cartucce per stampanti. '.repeat(15) +
      '</body></html>';
    const router = fakeRouter([{ status: 200, html: conflictHtml }]);
    const verdict = await verifyCandidates(router, ['https://ufficio.com'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(false);
    expect(router.fetchCalls()).toBe(1); // no retry on semantic reject
  });

  it('two consecutive transport failures → still NOT_FOUND (no third attempt)', async () => {
    const router = fakeRouter([
      { status: 0, error: 'ECONNREFUSED' },
      { status: 0, error: 'ECONNREFUSED' },
      { status: 200, html: goodHtml }, // would match if we kept retrying
    ]);
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(false);
    expect(router.fetchCalls()).toBe(2); // exactly 1 retry (= 2 attempts), no more
    expect(verdict.detail).toMatch(/retries=1/);
  });

  it('retry sets bypassBreakerRecord so a flapped target does not double-count toward breaker', async () => {
    const seen: Array<{ url: string; bypassBreakerRecord?: boolean }> = [];
    const router: any = {
      _i: 0,
      _plan: [
        { status: 0, error: 'ECONNREFUSED' },
        { status: 200, html: goodHtml },
      ],
      fetch: async function (url: string, opts: any) {
        seen.push({ url, bypassBreakerRecord: opts?.bypassBreakerRecord });
        const next = this._plan[Math.min(this._i, this._plan.length - 1)];
        this._i++;
        return { provider: 'direct_fetch', duration_ms: 5, cost_eur: 0, ...next };
      },
    };
    await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(seen.length).toBe(2);
    // First fetch counts toward breaker (default behaviour).
    expect(seen[0].bypassBreakerRecord).toBeFalsy();
    // Retry must NOT count again — keeps breaker stable on real flap.
    expect(seen[1].bypassBreakerRecord).toBe(true);
  });

  it('transportRetries=0 disables retry (legacy behaviour)', async () => {
    const router = fakeRouter([
      { status: 0, error: 'ECONNREFUSED' },
      { status: 200, html: goodHtml },
    ]);
    const verdict = await verifyCandidates(router, ['https://pianon.eu'], normalized, { ...lead }, {
      timeoutMs: 1000,
      rdapProbe: noOpRdap,
      transportRetries: 0,
      retryDelayMs: () => 0,
      sleep: async () => {},
    });
    expect(verdict.matched).toBe(false);
    expect(router.fetchCalls()).toBe(1);
  });
});
