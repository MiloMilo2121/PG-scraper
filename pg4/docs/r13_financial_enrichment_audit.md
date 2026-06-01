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

---

## R13.1 — Safe financial stage wiring (shipped)

R13.1 wires `FinancialStage` into the enrichment pipeline in **enabled but
no-network** mode, and adds the provenance columns to the enriched output.

### What changed

- **`FinancialStage` runs after the website discovery ladder, unconditionally.**
  It is *orthogonal* to website discovery: it runs whether or not a website
  was found (it is placed after the ladder loop, not inside the
  break-on-success ladder). See `enrichment_pipeline.ts`.
- **It does pure work only — no network, no paid provider, no VIES, no
  OpenAI.** The only signal it produces in R13.1 is promoting a
  checksum-valid input `vat_code` → `vat_code_final` (source `input`,
  confidence `0.6`). The fatturatoitalia / VIES paths remain deferred and
  gated (R13.2+).
- **It cannot change the website verdict.** The stage emits no `reason_code`
  and never sets the lead `status`; the lead status is derived solely from
  `official_website`. A financial `success` therefore never flips a
  `NOT_FOUND` lead to `FOUND`.
- **It can never break a lead.** The stage catches internally (degrading to
  `skipped`), and the pipeline wraps the call in a second try/catch. The
  worst case is a `skipped` financial outcome; the lead row is always
  produced.
- **Provenance does not pollute `providers_used`.** The financial source
  (`input`) is recorded on the stage outcome and on the lead
  (`financial_source`), but is deliberately NOT added to the network
  `providers_used` set.

### Schema (append-only)

`ENRICHED_CSV_COLUMNS` gains three columns **appended at the end** (after
`errors`) — existing columns keep their positions, so position-indexed
readers are unaffected:

| Column | Type | R13.1 value |
|---|---|---|
| `financial_source` | `FinancialSource` | `input` when a VAT was promoted, else empty |
| `financial_confidence` | `number` 0–1 | `0.6` for checksum-only |
| `financial_notes` | `string` | compact evidence trail, e.g. `vat_code:italian_piva_checksum_ok` |

The five financial value fields (`vat_code_final`, `revenue`,
`revenue_year`, `employees`, `employees_is_estimated`) already existed in
the enriched schema from Phase 1; R13.1 only adds the provenance trio.

### Control surface

`runEnrichmentPipeline` accepts an optional `financialStage?: FinancialStage`.
Default is `new FinancialStage({ enabled: true })` (pure path on). Inject
`new FinancialStage({ enabled: false })` to make it a strict no-op.

### Tests (`tests/unit/financial_wiring.test.ts`)

- valid input VAT → `vat_code_final` + provenance, `status` unchanged;
- invalid checksum → not promoted, financial outcome `not_found`;
- missing VAT → no error, row still produced;
- disabled stage → no-op `skipped`, website verdict unchanged;
- financial `success` never flips the lead to `FOUND`;
- `ENRICHED_CSV_COLUMNS` is append-only (last 3 = financial trio, prefix
  still equals `RAW_CSV_COLUMNS`, financials after `errors`);
- CSV writer emits the new columns in header + row.

Verified: `pnpm run typecheck` + `pnpm test` (585 pass / 1 skipped).

---

## R13.1 verification (post-wiring audit)

**Date:** 2026-06-01
**Performed by:** automated post-wiring audit (financial_stage_verify task)
**Branch:** `pg4/phase-4.4-structure-cleanup`

### Confirmed correct (no changes needed)

- **VAT normalization** (`normalizeVatCode`): strips `IT` prefix (case-insensitive), spaces, and non-digit separators. The stage calls `normalizeVatCode(lead.vat_code_final || lead.vat_code)` before checksum validation — correctly handles both raw and pre-normalized input.
- **Italian P.IVA checksum** (`validateItalianVatChecksum`): implements the standard Agenzia delle Entrate Luhn-like algorithm. Odd 1-indexed positions (= even 0-indexed) are summed directly; even 1-indexed positions (= odd 0-indexed) are doubled with the `>9 → -9` correction; sum % 10 === 0 is the pass condition. Verified against known public PIVAs (FIAT `00469580013`, Telecom `00488410010`) and against algorithmically derived fixtures.
- **Invalid PIVA ignored**: checksum-invalid `vat_code` leaves `vat_code_final` undefined; stage returns `not_found`, not `error`.
- **Missing PIVA no error**: when both `vat_code` and `vat_code_final` are absent, stage returns `not_found`; lead row is always produced.
- **Existing revenue/employees preserved**: `applyToLead` is guarded with `!lead.revenue` / `!lead.employees` — pre-populated values are never overwritten.
- **No status mutation**: `FinancialStage` writes no `reason_code` and never assigns `lead.status`; the website-discovery verdict computed in `finalize()` is unaffected.
- **No-op safety**: `enabled: false` → strict `skipped` outcome; no lead field is touched.
- **No network**: `FinancialStage` calls only `normalizeVatCode` + `validateItalianVatChecksum` (both pure). VIES, OpenAI, FatturatoItalia, and all paid providers are NOT called.
- **Pipeline wiring**: `financialStage` runs after the website-discovery ladder loop, unconditionally, wrapped in a `try/catch`; a throw degrades to `skipped` and never breaks the lead row.
- **`providers_used` not polluted**: the `input` financial source is recorded on `lead.financial_source` but NOT added to `perLead.providersUsed`.

### Gap found and fixed

**`financial_evidence_count` column was absent.**

The task required four financial CSV columns:
`financial_source`, `financial_confidence`, `financial_evidence_count`, `financial_notes`.

`ENRICHED_CSV_COLUMNS` and the `Lead` type contained only the first, second, and fourth. `financial_evidence_count` was missing from both the type definition and the column list.

Fix applied (append-only, no existing column reordered):

1. `src/types/lead.ts`: added `financial_evidence_count?: number` to the `Lead` interface and appended `'financial_evidence_count'` to `ENRICHED_CSV_COLUMNS` between `financial_confidence` and `financial_notes`.
2. `src/enrichment/stages/financial_stage.ts`: `applyToLead` now writes `lead.financial_evidence_count = result.evidence.length` when `evidence.length > 0`.
3. `tests/unit/financial_wiring.test.ts`: updated the pre-existing `slice(-3)` → `slice(-4)` column-order assertion and the CSV header endsWith check to include all four financial columns.

### Tests added

`tests/unit/financial_stage_verify.test.ts` — 17 tests covering:

- Fixture sanity (VALID_PIVA `01234567897` passes checksum; INVALID_PIVA `01234567898` fails; `normalizeVatCode` strips prefixes).
- Valid PIVA promoted to `vat_code_final` with `source=input`, `confidence=0.6`, `financial_evidence_count ≥ 1`, `financial_notes` present.
- IT-prefixed `vat_code` normalized before promotion.
- Pre-existing `vat_code_final` not overwritten.
- Invalid PIVA: `not_found`, `vat_code_final` undefined, no provenance fields set.
- Missing PIVA: `not_found` (not `error`), lead produced intact.
- No-op disabled stage: `skipped`, zero mutation of any lead field, snapshot equality.
- Pre-existing `revenue`/`employees` preserved when enabled but no VAT signal.
- CSV columns: all 4 financial cols present; all appear after `errors`; correct relative order; ENRICHED starts with all RAW columns; CSV writer emits all 4 in header and row.

### Verification result

```
pnpm exec vitest run tests/unit/financial_stage_verify.test.ts
  17 tests passed

pnpm run typecheck
  0 errors
```
