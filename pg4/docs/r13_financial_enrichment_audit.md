# R13 — Financial Enrichment Audit & Port Plan

**Status:** preflight (parsers + types only, no live network, no paid providers)
**Date:** 2026-06-01
**Branch:** `pg4/phase-4.4-structure-cleanup`
**Scope rule:** new code lives only in `pg4/`. pg3 is read as reference; pg1/pg3 are not modified.

---

## 1. What the pg3 financial stack does

pg3 grew **three overlapping financial subsystems** plus a stage that fuses two of them:

### 1a. `enricher/core/financial/` (the "v2" service)
- `service.ts` — `FinancialService.enrich()` is a 5-phase ladder:
  1. **VAT discovery** — input field → website scrape → PagineGialle reverse-by-phone → Google search.
  2. **Revenue/employees** — if VAT found, scrape UfficioCamerale (via Tor/DDG), secondary registries, then FatturatoItalia.
  3. **Fallback** — ReportAziende scrape.
  4. **AI estimation** — OpenAI estimates headcount from the website (paid LLM).
  5. **PEC discovery.**
- `vies.ts` — `ViesService.validateVat()` calls the EU VIES REST API, with an Italian P.IVA Luhn checksum pre-check and a "provisional valid" fallback when VIES is 5xx/unreachable.
- `patterns.ts` — pre-compiled regexes for revenue / employees / VAT / PEC / phone.

### 1b. `enricher/core/directories/fatturato_italia.ts` (`FatturatoItaliaHarvester`)
- Resolves a company → `fatturatoitalia.it` page by **guessing slug URLs** from name+VAT (≈8 slug variants), then DDG/Serper `site:` search fallback.
- Parses the page with cheerio + the shared regexes. Returns `{url, revenue, revenueYear, employees, companyName, vat}` (all strings).
- In-process 30-min cache.

### 1c. `foundation/FatturatoItaliaProvider.ts` (the better, newer harvester)
- Deterministic lookup: **POST** `/cerca/risultato-di-ricerca` with the `piva` form field (requires a PHPSESSID cookie it fetches first), or `denominazione` for name search.
- Parses the **embedded JS chart vars** (`datiChartFatturato`, `datiChartUtile`, `labelChart`) for a clean 5-year numeric history — the most reliable extraction path — with a `.col-xs-5 / .col-xs-7` label/value grid fallback.
- Returns **numeric** EUR amounts, `bilancio_year`, `dipendenti`, `history[]`, `source_url`, and a `confidence` (0–1) driven by VAT-match / fuzzy name score.
- `parseEurAmount()` handles `Mld` / `Mln` / Italian `1.234.567,89` formats.

### 1d. `foundation/BilancioHunter.ts`
- SERP-driven: builds a 6-query plan (`site:fatturatoitalia.it`, `site:registroimprese.it`, `filetype:pdf`, name+location+financial-keywords), routes each through a `CostRouter` (tiered/paid), aggregates candidates, scores them (query-kind bonus, multi-hit, entity-match, snippet-parsed revenue), and returns one ranked `FinancialData` with `source_trust` + `confidence` + `entity_match_status`.
- Parses revenue/year out of **SERP snippets** only — never fetches the page.

### 1e. `enricher/runtime/stages/financial_enrichment_stage.ts`
- Runs `BilancioHunter.hunt()` and `FatturatoItaliaHarvester.harvest()` **in parallel**, both `.catch(()=>null)`-guarded.
- FatturatoItalia wins on revenue (trust `high`, conf ≥0.9); BilancioHunter fills the SERP-derived gaps.
- Emits a rich `RuntimeStageOutcome` (status / reason_code / confidence / provider / evidence_count / entity_match_status). This is the cleanest pg3 piece structurally.

---

## 2. Which pieces are valuable (port targets)

| pg3 piece | Value | pg4 disposition |
|---|---|---|
| **Italian P.IVA Luhn checksum** (`vies.ts`) | High — pure, deterministic, zero-cost gate against false VATs | **Port → `vat.ts`** |
| **`parseEurAmount()`** (`FatturatoItaliaProvider.ts`) | High — handles all IT/EN/Mln/Mld formats | **Port → `revenue_parser.ts`** |
| **Chart-var extraction** `datiChartFatturato` etc. | High — cleanest, machine-readable, no fuzzy guessing | **Port → `fatturato_italia_parser.ts`** (parse only) |
| **`.col-xs-5/7` grid fallback parse** | Medium — DOM-fragile but useful as fallback | **Port → parser fallback** |
| **VIES input/output types + checksum pre-check** | Medium — types are clean; the live call is deferred | **Port types + format only; live call gated** |
| **VAT extraction regexes** (`patterns.ts`) | Medium — useful for pulling P.IVA out of free text | **Port → `vat.ts::extractVatCodesFromText`** |
| **Revenue/employees regexes** | Medium | **Port → `revenue_parser.ts`** (re-expressed, capturing suffix) |
| **Stage outcome shape** (`financial_enrichment_stage.ts`) | High structurally | **Adapt → `financial_stage.ts` skeleton** mapped onto pg4 `StageOutcome` |

## 3. Which pieces are too messy / risky to port (now)

| pg3 piece | Why excluded |
|---|---|
| **Slug-guessing URL builder** (`fatturato_italia.ts`, ~8 variants × live GET each) | Noisy live fan-out, brittle, easy to get IP-blocked. Replaced later by the deterministic POST lookup if/when live fetch is enabled. |
| **Tor + CAPTCHA solver UfficioCamerale path** (`service.ts`) | Heavy, fragile, ToS-hostile, depends on Tor browser + paid CAPTCHA solver. **Not porting.** |
| **OpenAI headcount estimation** | Paid LLM call. Out of preflight scope; only as an explicitly-gated future estimate (`employees_is_estimated=true`). |
| **`BilancioHunter` SERP fan-out** | Depends on paid `CostRouter` tiers + multi-query SERP spend. Valuable later but **not** in a no-paid preflight. Its scoring logic can be revisited once pg4 has a free-tier SERP budget story. |
| **Module-level mutable session cookie / global cache** | Hidden state; pg4 prefers run-scoped/injected state. Re-implement cleanly if live fetch lands. |
| **`FinancialService` god-class** | 5 responsibilities in one class. pg4 splits into pure parsers + a thin stage. |

## 4. External services involved

| Service | Type | Cost | Used by pg3 | pg4 preflight |
|---|---|---|---|---|
| **VIES** (`ec.europa.eu/.../vies/rest-api`) | EU VAT validation REST | Free, rate-limited, frequently 5xx | `vies.ts` | **Pure format + checksum only**; live call deferred & `RUN_SMOKE`-gated |
| **fatturatoitalia.it** | HTML scrape (GET slug / POST search) | Free, daily per-IP view cap, ToS-sensitive | both harvesters | **Parser only**, fed local fixtures. No live fetch. |
| **registroimprese.it / ufficiocamerale.it** | Registry scrape | Free but CAPTCHA/Tor | `service.ts` | **Not ported** |
| **Serper / DDG / Bing (SERP)** | Search | Serper paid; DDG/Bing free-ish | `BilancioHunter` | **Not ported** in preflight |
| **OpenAI** | LLM headcount estimate | Paid | `service.ts` | **Not ported** |

## 5. Expected pg4 financial fields

Already present on `Lead` (`src/types/lead.ts`): `vat_code_final`, `revenue`, `revenue_year`, `employees`, `employees_is_estimated`. R13 adds the **provenance contract** — every financial field must carry a source + confidence — via `FinancialResult`:

| Field | Type | Meaning |
|---|---|---|
| `vat_code_final` | `string` | Normalized 11-digit P.IVA that passed checksum (and, later, VIES) |
| `revenue` | `string` | Display form, e.g. `"€ 1.500.000"` |
| `revenue_amount` | `number?` | Numeric EUR when parseable (internal, not yet a CSV column) |
| `revenue_year` | `string` | Bilancio year, e.g. `"2023"` |
| `employees` | `string` | Headcount or band (`"10-20"`) |
| `employees_is_estimated` | `boolean` | True only for AI/heuristic estimates |
| `financial_source` | `FinancialSource` | `input \| website \| fatturatoitalia \| registroimprese \| serp \| vies \| estimate \| unknown` |
| `financial_confidence` | `number` | 0–1 confidence of the chosen result |
| `financial_errors` | `string[]?` | Non-fatal notes (e.g. `"vies_unreachable"`) — never breaks lead output |
| `evidence` | `FinancialEvidence[]` | Per-field provenance trail (source, url, confidence, raw match) |

**Invariant:** missing financial data is *not* an error. A lead with no financial signal is `not_found`/`skipped`, never `error`.

## 6. Cost & rate-limit risk

- **VIES:** free but heavily rate-limited and flaky (5xx common). Live calls must be checksum-gated first (free), batched, and never on the hot unit-test path. The pg3 "provisional valid on 5xx" heuristic is reasonable but must be marked `provisional=true` so confidence stays below a hard-validated VAT.
- **fatturatoitalia.it:** free but enforces a **daily per-IP page-view cap** (pg3 documents a `<pre>` counter). Live harvesting at lead-batch scale will get the IP throttled/blocked. Requires per-IP daily budget + random delay if ever enabled. **Preflight does zero live fetches.**
- **No paid provider is touched** in R13. Serper / OpenAI stay behind the existing `paidEnabled` + per-call cost gates and are not wired here.

## 7. Legal / operational risk

- Scraping `fatturatoitalia.it` and registries is **ToS-sensitive**; bilancio data is public (Registro Imprese) but redistribution terms vary. Keep the scraper **opt-in, rate-limited, attributed** (store `source_url`), and prefer official registry data where a paid/authorized channel exists.
- VAT codes are **business** identifiers (not personal data under GDPR for companies), but decision-maker enrichment downstream *is* PII — out of R13 scope.
- Tor + CAPTCHA-solving (pg3) is explicitly **not** carried over — both the operational fragility and the evasion posture are off-policy for pg4.

## 8. Proposed pg4 module structure

```
pg4/src/enrichment/financial/
  financial_types.ts          # FinancialEvidence, FinancialResult, FinancialSource
  vat.ts                      # normalize / isItalianVatCode / checksum / extractVatCodesFromText  (PURE)
  revenue_parser.ts           # parseItalianRevenueText / parseRevenueYear / normalizeRevenueAmount (PURE)
  fatturato_italia_parser.ts  # parseFatturatoItaliaPage(html)  (PURE — no fetch)
  vies.ts                     # types + formatVatForVies + preValidateVat (PURE);
                              #   checkVatViaVies() live, caller-gated, never in unit tests
pg4/src/enrichment/stages/
  financial_stage.ts          # Stage skeleton — DISABLED by default, no-op safe, no network
pg4/tests/unit/
  vat.test.ts
  revenue_parser.test.ts
  fatturato_italia_parser.test.ts
pg4/tests/fixtures/financial/
  fatturato_company_chart.html   # synthetic, models the JS-chart page
  fatturato_company_grid.html    # synthetic, models the label/value grid page
  fatturato_no_data.html         # synthetic, models a no-bilancio page
pg4/tests/smoke/
  vies_smoke.test.ts          # RUN_SMOKE=1 gated, real VIES call (optional)
```

All new code is dependency-light: only `cheerio` (already a pg4 dep) for the HTML parser and `undici` (already a dep) for the gated VIES smoke call. The pure utilities import nothing external.

## 9. Exact phase plan

- **R13.0 (this PR) — preflight, no live network:**
  1. `financial_types.ts` — provenance contract.
  2. `vat.ts` + `revenue_parser.ts` — pure utilities + unit tests (0 network).
  3. `fatturato_italia_parser.ts` + synthetic fixtures + unit test (0 network).
  4. `vies.ts` — types + pure format/checksum; live `checkVatViaVies` present but **not** called by default; `vies_smoke.test.ts` gated by `RUN_SMOKE=1`.
  5. `financial_stage.ts` — disabled-by-default, no-op-safe skeleton, **not wired** into the ladder.
  6. Verify: `pnpm run typecheck` + `pnpm test` green.
- **R13.1 — enable pure path in pipeline (later):** wire `financial_stage` after the website ladder, enabled, doing *pure* work only: validate the input `vat_code` (checksum) → `vat_code_final`, parse any already-fetched page text for revenue. Still 0 new network. Add lead-output + CSV columns for `financial_source` / `financial_confidence`.
- **R13.2 — VIES live (gated):** turn on `checkVatViaVies` behind a feature flag + rate limiter; confidence bump on validated VAT; `provisional` handling on 5xx.
- **R13.3 — FatturatoItalia live fetch (gated, rate-limited):** deterministic POST lookup (port from `FatturatoItaliaProvider`) feeding the existing parser, with per-IP daily budget + random delay. Opt-in only.
- **R13.4 — registry / SERP / estimate (paid-gated):** only if a free or authorized channel proves stable; otherwise stays excluded.

Each phase gated on: typecheck + unit tests green, no-op-safe behavior preserved, and provenance written for every field.
