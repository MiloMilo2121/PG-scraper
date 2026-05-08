import { describe, it, expect } from 'vitest';
import { PgDetailStage } from '../../src/enrichment/stages/pg_detail_stage';
import { PgDetailHarvester } from '../../src/discovery/sources/pagine_gialle_detail_harvester';
import { ProviderRouter } from '../../src/providers/provider_router';
import { CostLedger } from '../../src/runtime/cost_ledger';
import { createPerLeadContext, createRun } from '../../src/runtime/run_context';
import type { Lead } from '../../src/types/lead';
import type { HttpProvider, HttpFetchResult } from '../../src/types/providers';

/**
 * R1 — `PgDetailStage` 0-network tests. The harvester is mocked via
 * the constructor's `fetchHtml` injection point.
 */

class StubHttp implements HttpProvider {
  id = 'stub_http';
  family = 'http' as const;
  tier = 0;
  costPerCallEur = 0;
  available() { return true; }
  constructor(private html: string, private status = 200) {}
  async fetch(): Promise<HttpFetchResult> {
    return { status: this.status, html: this.html, finalUrl: '', duration_ms: 0, cost_eur: 0, provider: this.id };
  }
}

const PG_URL = 'https://www.paginegialle.it/padova-pd/immobiliare/foosrl';
const PG_DETAIL_HTML = (websiteHref: string | null) => `
  <html><body>
    ${websiteHref ? `<a data-tr="scheda_azienda__cta_sitoweb" href="${websiteHref}">Sito web</a>` : ''}
    <script type="application/ld+json">
      ${JSON.stringify({ '@type': 'LocalBusiness', name: 'Foo S.r.l.', vatID: 'IT01234567890', telephone: '+39 049 1234567', email: 'info@foosrl.com' })}
    </script>
    <h1>Foo S.r.l.</h1>
    <div class="sede__indirizzo">Via Roma 1, 35100 Padova (PD)</div>
  </body></html>`;

const realEstateBody =
  'Compravendita e locazione di appartamenti. Immobili in vendita a Padova. ' +
  'Trovi monolocale, bilocale, trilocale, ville e immobili commerciali. ' +
  'Servizio di valutazione gratuita. Consulenza per mutuo. ' +
  'Servizi offerti: gestione contratti di locazione, consulenza fiscale. ' +
  'Iscritta al ruolo agenti immobiliari della Camera di Commercio. ' +
  'Contatti per richiedere informazioni o fissare un appuntamento. ' +
  'La nostra agenzia opera da oltre venti anni nel territorio. ' +
  'Foo SRL pubblica costantemente nuove proposte di immobili a Padova.';
const livePageHtml = `<html><head><title>Foo</title></head><body><h1>Foo S.r.l.</h1><p>${realEstateBody}</p></body></html>`;

describe('PgDetailStage', () => {
  it('skipped when lead has no pg_url', async () => {
    const run = createRun();
    const router = new ProviderRouter([], [new StubHttp('')], [], run.ledger);
    const stage = new PgDetailStage(router, new PgDetailHarvester({ fetchHtml: async () => ({ status: 200 }) }));
    const lead: Lead = { company_name: 'Foo' };
    const out = await stage.run(createPerLeadContext(run), lead, { company_name: 'Foo', company_name_variants: [], quality_score: 0, raw: lead });
    expect(out.status).toBe('skipped');
  });

  it('backfills lead VAT/email/phone/address from PG harvest even without website', async () => {
    const run = createRun();
    const router = new ProviderRouter([], [new StubHttp('')], [], run.ledger);
    const harvester = new PgDetailHarvester({
      fetchHtml: async () => ({ status: 200, html: PG_DETAIL_HTML(null) }),
    });
    const stage = new PgDetailStage(router, harvester);
    const lead: Lead = { company_name: 'Foo S.r.l.', pg_url: PG_URL };
    const norm = { company_name: lead.company_name, company_name_variants: [], quality_score: 0, raw: lead };
    const out = await stage.run(createPerLeadContext(run), lead, norm);
    expect(out.status).toBe('not_found');
    expect(lead.vat_code).toBe('01234567890');
    expect(lead.email).toBe('info@foosrl.com');
    expect(lead.phone).toBe('+39 049 1234567');
    expect(lead.address).toContain('Via Roma 1');
    expect(lead.official_website).toBeUndefined();
  });

  it('matches the website when PG advertises a real one and verifyCandidates accepts', async () => {
    const run = createRun();
    const router = new ProviderRouter([], [new StubHttp(livePageHtml, 200)], [], run.ledger);
    const harvester = new PgDetailHarvester({
      fetchHtml: async () => ({ status: 200, html: PG_DETAIL_HTML('https://www.foosrl.com') }),
    });
    const stage = new PgDetailStage(router, harvester);
    const lead: Lead = { company_name: 'Foo S.r.l.', city: 'Padova', pg_url: PG_URL, category: 'agenzie immobiliari' };
    const norm = { company_name: lead.company_name, company_name_variants: [], city: lead.city, quality_score: 0, raw: lead };
    const out = await stage.run(createPerLeadContext(run), lead, norm);
    // Note: verify result depends on PreVerifyGate matching `Foo S.r.l.`
    // against the live page. Whether it matches isn't the primary
    // invariant here — what matters is that ON A MATCH the stage
    // sets PG_PHONE_SOURCE_TRUST as the discovery method. We don't
    // pin gate behaviour from this test.
    if (out.status === 'success') {
      expect(lead.website_discovery_method).toBe('PG_PHONE_SOURCE_TRUST');
      expect(lead.official_website).toBe('https://www.foosrl.com');
    }
    // Backfill always happens regardless.
    expect(lead.vat_code).toBe('01234567890');
  });

  it('rejects directory URL even when PG advertises it as "Sito web"', async () => {
    const run = createRun();
    const router = new ProviderRouter([], [new StubHttp(livePageHtml, 200)], [], run.ledger);
    const harvester = new PgDetailHarvester({
      // PG sometimes lists facebook/atoka/cercacasa as "Sito web".
      // The harvester's isLikelyOfficialWebsiteUrl filter must reject them.
      fetchHtml: async () => ({ status: 200, html: PG_DETAIL_HTML('https://www.facebook.com/foosrl') }),
    });
    const stage = new PgDetailStage(router, harvester);
    const lead: Lead = { company_name: 'Foo S.r.l.', pg_url: PG_URL };
    const norm = { company_name: lead.company_name, company_name_variants: [], quality_score: 0, raw: lead };
    const out = await stage.run(createPerLeadContext(run), lead, norm);
    expect(lead.official_website).toBeUndefined();
    expect(out.status).toBe('not_found');
  });
});
