# Phase C recon — free registry-as-universe: attempted, honest result + build-spec

*Operator chose "attempt a free directory scrape" (2026-06-13). Done, thoroughly.
Conclusion: a FREE ATECO+province census is not viable. The detail + the
ready-to-plug build-spec below. €0 spent.*

## What was tried, what happened (MEASURED)

| source | accessible? | lists companies? | exposes official VAT? | verdict |
|---|---|---|---|---|
| ufficiocamerale.it | ❌ Cloudflare "Just a moment…" | — | — | needs heavy anti-bot evasion (won't) |
| reportaziende.it | ❌ "Accesso bloccato" | — | — | blocked |
| companyreports.it | ⚠️ via Playwright, BURST-only | province page = top-50 by revenue | ✅ VAT in URL slug | blocks after a few reqs; no sector filter (/settori-economici times out); capital-companies only; no pagination |
| aziende.virgilio.it | ✅ DirectFetch | category+province listings | ❌ VAT only on per-company pages, not lists | = PagineGialle data pg4 already scrapes (redundant) |

Detail on the most promising (companyreports.it): the province page DOES render
via the Playwright `BrowserFactory` and yields clean `(name, official VAT)` pairs
— the VAT is the trailing 11 digits of each company URL
(`/sonepar-italia-spa-00825330285`). But: (a) it serves only ~50 companies, the
TOP by revenue, ACROSS ALL SECTORS — not "agenzie immobiliari"; (b)
`/settori-economici/` (the sector filter that would make it a real-estate census)
times out / is gated; (c) it rate-limits hard — `/provincia/padova` loaded twice,
then began timing out (same anti-bot pattern as fatturatoitalia, but stricter).

## The structural truth (why no FREE census exists)
1. **The quality directories block automated access** (Cloudflare / burst limits).
   Bypassing is an arms race + a ToS violation — out of scope by the project's rules.
2. **The accessible one (virgilio) is PagineGialle** — the same portal pg4 already
   discovers from. No net coverage gain, and its listings don't carry VATs.
3. **Ditte individuali / sole proprietors appear in NO directory** — they file no
   bilancio, so revenue-directories (companyreports/fatturatoitalia) structurally
   exclude them. A census of "all agencies" is impossible from these sources by
   construction, free OR paid-directory.
4. A true legal census needs **Registro Imprese** (the only authority that lists
   every VAT incl. ditte individuali) — which is PAID (visure or a licensed API).

## So the real options for coverage (re-decision, now informed)
- **A — Paid official source** (Registro Imprese API / openapi.com / Atoka): the
  only path to a TRUE ATECO+province census incl. ditte individuali. Costs money
  per company (~€0.1–0.3 API, or ~€3–7/visura). Highest precision (official VAT).
- **B — Accept current discovery** (PG + Maps by category+province) as the
  coverage method — it already answers "companies of type X in area Y" for the
  portal-listed majority. Pair it with the Phase-A VAT precision (VIES-confirm +
  footer-unconfirmed honesty). €0, no new build. The pragmatic default.
- **C — Paid directory via Playwright** (companyreports, rate-limited): a PARTIAL
  capital-company list per province/sector IF the sector filter is unlocked
  (likely paid). Narrow, ToS-grey, capital-companies-only. Not recommended.

## BUILD-SPEC (ready to plug whichever source is chosen) — C.1
The pipeline is source-agnostic by design; only the universe-lister changes.

```
interface RegistryUniverseSource {
  // ATECO + province → the company universe (name + OFFICIAL vat), paged.
  list(ateco: string, province: string, opts: { cap?: number }): AsyncIterable<{
    company_name: string;
    vat_code: string;        // OFFICIAL — provenance 'registry' (trusted, no VIES gate needed)
    ateco?: string;
    comune?: string;
  }>;
}
```
Flow: `list(68.31, 'PD')` → for each `{name, vat}` → write a Lead with
`vat_code_final = vat` (provenance 'registry') → feed the EXISTING enrich
pipeline. Because the VAT is official, `vatResolve` skips the footer-unconfirmed
problem (the #1 precision gap), and `fatturatoItaliaStep` keys on a trusted VAT
(confidence 0.95, no VIES gate). Net: registry leads are higher-precision than
scrape-discovered leads — the Phase-A gap fixed at the root for this set.

Adapters to implement when a source is chosen:
- `OpenapiRegistrySource` (REST, paid, per-company) — cleanest; honors the €ceiling.
- `RegistroImpreseSource` (visure, paid) — authoritative, dearer.
- (companyreports Playwright adapter — only if its sector filter is unlocked.)

Measurement to run on the slice (DoD): coverage vs PG/Maps (how many registry
companies scraping missed), and VAT/revenue/employees precision on registry leads
(expected higher — official VAT). All gated behind the €-ceiling + a flag, default off.

## Bottom line
The free-scrape attempt was real and thorough; it does not yield a census (sources
block, or are redundant, or structurally exclude ditte individuali). The honest
next step is a small decision: **A** (pay for a real census) or **B** (accept the
existing free discovery as coverage). The spec above makes **A** a ~1-adapter build
the moment a source/key is approved. €0 spent; nothing pushed.
