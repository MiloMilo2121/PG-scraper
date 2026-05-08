# R0 — Lessons from pg3 SERP / PG harvest pipeline

Read pass over the canonical pg3 modules to extract what to port and
what to reject for the pg4 recalibration.

Files reviewed:
- `pg3/src/foundation/MasterPipeline.ts`
- `pg3/src/foundation/QuerySanitizer.ts`
- `pg3/src/foundation/SerpDeduplicator.ts`
- `pg3/src/enricher/core/directories/paginegialle.ts`
- `pg3/src/enricher/core/discovery/search_provider.ts`
- `pg3/src/shared-runtime/routing/provider_catalog.ts`

## What pg3 did better than pg4 today

### 1. Multi-vector SERP queries (`QuerySanitizer.buildQueryVariants`)

pg3 builds 8-12 ordered query variants per lead, each targeting a
different evidence vector:

1. **P.IVA exact** — `"01234567890" -site:facebook.com -site:paginegialle.it ...`
   "GOD-TIER override". When P.IVA exists, this query alone usually
   resolves the lead.
2. **Email-domain site search** — `site:<email_domain> "Nome" Padova`
3. **Exact name + city + exclusions** — `"Nome" "Padova" "PD" -site:paginegialle.it ...`
4. **Contact vector** — `intitle:"Nome" ("contatti" OR "chi siamo" OR "azienda") "Padova" -...`
5. **Legal vector** — `"Nome" "Padova" ("privacy policy" OR "note legali" OR "partita iva")`
6. **Phone vector** — `"Nome" "049..." -...` when phone exists
7. **Address vector** — `"Nome" "Via X" Padova -...`
8. **Official fallback** — `"Nome" Padova sito ufficiale`
9. **Contact fallback** — `"Nome" Padova ("contatti" OR "chi siamo")`

Each variant uses `exclusionDorks`: an aggressive `-site:` list that
keeps directories OUT of the SERP results entirely.

pg4 today emits ONE generic query: `${name} ${city} P.IVA ${vat} sito
ufficiale`. Result: the directory tail leaks through.

**Port:** the structure of `buildQueryVariants` for `target='company'`,
adapted to pg4's `NormalizedLead` shape. **Reject:** the messy stop-word
table and the linkedin/registry/bilancio targets (out of pg4 scope).

### 2. PG detail harvester with phone-pivot search

`paginegialle.ts` harvests:
- official website (via `data-tr="scheda_azienda__cta_sitoweb"` button)
- P.IVA from JSON-LD `vatID`/`taxID` keys
- email, phone, name, address from JSON-LD + visible-text fallback
- regex fallback for VAT/email/phone when JSON-LD missing

It also does **phone search**: when a phone number exists but `pg_url`
doesn't, it fires `paginegialle.it/ricerca/?phone=...` and picks the
top match by name-similarity score.

Caching by phone+name in-memory during the run avoids redundant
fetches.

The `isLikelyOfficialWebsiteUrl()` filter rejects `paginegialle.it`,
`mailto:`, `tel:`, `javascript:` BEFORE accepting anything as the
official site.

**Port:** the harvester (HTTP-only, no browser), the JSON-LD +
fallback regex extraction, the per-run cache. **Adapt:** filtering
the harvested website through pg4's stricter `PreVerifyGate` +
`isDirectoryOrSocial` before accepting it as `official_website`.

### 3. Directory results as evidence, not as official sites

pg3's `SerpDeduplicator` treats `EXTRACTABLE_REGISTRIES`
(paginegialle, fatturatoitalia, registroimprese, ufficiocamerale,
visura.pro, …) as "low-rank candidates" — keeps them around so a
later stage can extract structured data (P.IVA), but ranks them
LAST.

pg4 today copies this list but has no extraction stage downstream,
so registries that survive ranking get fetched by `verifyCandidates`
and the gate matches the company name visible on the directory page,
producing FPs.

**Port:** the registry classification AS A SEPARATE OUTPUT STATE
(`REGISTRY_VERIFIED`), not as a rejection. **Reject:** treating
registry results as official websites without a pivot.

### 4. PG phone source-trust & PG entity harvesting

pg3's `MasterPipeline` runs a "PG-Phone" pre-stage that:
- fetches the lead's `pg_url` if present
- harvests P.IVA / website / email / phone
- if the website is verified, returns success WITHOUT calling SERP
- if only P.IVA/email is found, ENRICHES the lead and continues
  the ladder

Net effect: many PD leads that have a `pg_url` never need SERP at
all because PG itself reveals the official website (or P.IVA, which
then drives the strongest SERP query).

pg4 today does NOT use `pg_url` for evidence harvest — it goes
straight to HyperGuesser and free SERP. This is leaving deterministic
evidence on the floor.

## What pg3 did dangerously

### A. Counted directories as "found websites" in MASTER outputs

Looking at `MASTER_NO_WEBSITE_discovery_results.csv` patterns: pg3
sometimes set the agency's official_website to a paginegialle.it /
companyreports.it / atoka.io URL. Same class of FP we observed in
pg4 p90/p91 before adding the round-2 directory blocklist.

This inflated pg3's "found rate" but degraded downstream outreach
quality (the paginegialle URL doesn't carry the agency's contact
form).

**Reject:** any path that would set `lead.official_website` to a
known directory/registry host. pg4 has the right rule already in
`verifyCandidates`; the recalibration must KEEP that rule even when
pg3-style query variants surface more directory hits.

### B. Broad SERP queries on company-name-only

pg3 fires SERP variants even when the lead is "Camelot Sas" or
"Fusion S.a.s." — single-token brand with no city/phone/PIVA. The
result set is dominated by global homonyms.

pg4's smart-gate rule (R4) explicitly forbids this: SERP runs only
when there's enough deterministic signal to disambiguate.

**Reject:** firing paid SERP on company-name-only.

### C. No run-level cost cap, no atomic reservation

pg3 has per-call cost telemetry but no run-level cap. A misconfigured
batch could spend €100+ on Serper without hitting any limit.

pg4 G.1 already implements both per-lead and run-level caps with
atomic reservation. **Keep that strict.**

## Mapping pg3 wins onto pg4's discipline

| pg3 win | pg4 port | pg4 difference |
| --- | --- | --- |
| `buildQueryVariants` (target=company) | R2 `query_variants.ts` | drop linkedin/registry/bilancio targets |
| PG harvester `harvestByPhone` + `extractCompanyDetails` | R1 `pagine_gialle_detail_harvester.ts` | HTTP-only, no browser, run-scoped cache |
| `isLikelyOfficialWebsiteUrl` | merge into `isDirectoryOrSocial` | already covered |
| Registry-as-low-rank ranking | R3 `serp_evidence.ts` | NEW state `REGISTRY_VERIFIED`, never `official_website` |
| PG-Phone pre-stage | R1 `PgDetailStage` | first stage in the ladder, before HyperGuesser |
| Per-call cost telemetry | R4 (already in CostLedger) | + R4 budget reservation |

## SERP wins that were actually directory/registry evidence

Audit of typical pg3 high-recall SERP outcomes (sample patterns):

| pg3 "win" | What it actually was |
| --- | --- |
| pagineggialle URL with full PIVA | registry evidence — useful for P.IVA enrichment, NOT an official site |
| companyreports / atoka URL with company data | registry evidence — useful for revenue/PEC, NOT an official site |
| linkedin company page | identity evidence — could become the official URL only if the firm has no website |
| fiaipveneto / mls / portale | NOT an official site — just a listing portal |

In pg3 these all surfaced as "found websites" inflating the recall
metric. In pg4 they will surface as `REGISTRY_VERIFIED` /
`DIRECTORY_VERIFIED` separately from `OFFICIAL_SITE_VERIFIED`.

## Logic that MUST be ported

1. **Query variants** with P.IVA-first + email-domain + contact +
   legal + phone + address vectors.
2. **PG detail harvester** with phone-pivot search and JSON-LD
   extraction.
3. **PG-Phone pre-stage** that runs BEFORE HyperGuesser/SERP and
   fills `lead.vat_code`/`lead.email`/etc. when missing.
4. **Aggressive `-site:` exclusion list** in queries so paid Serper
   doesn't even see directory hits.
5. **Registry-as-evidence** classification (R3) instead of rejecting
   silently.

## Logic that MUST be rejected

1. Treating `paginegialle.it`/`atoka.io`/`companyreports.it` URLs
   as `official_website`.
2. Firing paid SERP on company-name-only leads.
3. Caching SERP results across runs (pg3 does this, pg4 should not
   until cost-equivalence with provider TOS is verified).
4. Brand-stem matches without locality / sector check (pg3 had
   weaker semantic gate; pg4's COMMON_BARE_STEMS + sector-aware
   gate is stricter and must stay).
5. LLM oracle / BestLoser rescue (out of recalibration scope; these
   are post-G futures, not part of R1-R7).

## Plan ahead

R1 unblocks PG-Phone evidence on every lead with a `pg_url`.
R2+R3 unblock surgical paid SERP queries.
R4 makes paid Serper a scalpel, not a net.
R5 closes Maps coverage so we stop missing 30 % of the input.
R6+R7 measure whether the recalibrated stack beats both p85 (free
baseline) and pg3 (paid recall, dirty precision).
