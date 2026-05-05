# pg4 — Implementation Notes

> **Status:** Phases 0 + 1 + 2 + 3 complete. Multi-stage discovery ladder live: InputWebsite → HyperGuesser (NER + DNS sweep) → SerpStage (4 free providers + SerpDeduplicator) → RdapBoost. Typecheck green. 93 unit tests passing. Zero network in unit tests; smoke gated by `RUN_SMOKE=1`.
> **Branch:** `pg4/phase-3-discovery` (next push).

## Session results

| Phase | Result |
|---|---|
| 0 — Audit | ✅ This document |
| 1 — Scaffold (typecheck green) | ✅ `pg4/` compiles, deps installed |
| 2 — Vertical slice | ✅ 10/10 rows, 0 silent drops |
| 3 — Strong-piece port | ✅ HyperGuesser + 4 free SERP providers + SerpDeduplicator + RDAP validator wired into pipeline |
| 3.5 — Scraper parser fixtures (synthetic) | ✅ PG + Maps pure parsers + multi-key raw deduper + scrape dry-run |
| 3.6 — Real-fixture parser gate | ✅ Live HTML captured for PG Belluno (25 cards), PG Milano (overflow=true), Maps Feltre (10 cards). Parsers passed real DOM with 2 hardenings: PG blocklist extended for `wa.me`/`whatsapp.com`/`m.me`; Maps span classifier strips `·` bullets, dedupes spans, requires Italian street prefix (no bare `\d{5}` fallback). |
| 3.7 — Legacy failure mining | ✅ Audited pg3 CSVs (4795 rows) + logs. 11 failure modes documented in `docs/legacy_failure_taxonomy.md`. Code guardrails: dirty-host blocklist extended (franchise + portals), `Lead.{query_location, business_city, sources[], category_match, cap_likely}`, circuit breaker, Maps cap detector, category-match classifier, legacy CSV schema mapper. **181 unit tests, all green.** |
| 4 — Live scraper (PG + Maps) | ⏳ Next |
| 5 — Benchmark vs pg3 | ⏳ |

### Vertical slice fixture run (10 rows)

| Row | Status | Reason code |
|---|---|---|
| Mario Rossi SRL | NOT_FOUND | INPUT_WEBSITE_NOT_VERIFIED (DNS failure on example.com) |
| Beauty Center Verona | NOT_FOUND | INPUT_WEBSITE_NOT_VERIFIED |
| Solo Nome SpA | SKIPPED | INPUT_QUALITY_TOO_LOW |
| Bad URL Inc | NOT_FOUND | NOT_FOUND_NO_CANDIDATES |
| Whatsapp Only | NOT_FOUND | INPUT_WEBSITE_MESSAGING_OR_REDIRECT |
| Linkedin Lead | NOT_FOUND | INPUT_WEBSITE_DIRECTORY_OR_SOCIAL |
| Pippo Pluto SNC | NOT_FOUND | NOT_FOUND_NO_CANDIDATES |
| Empty Website Co | NOT_FOUND | NOT_FOUND_NO_CANDIDATES |
| Quality Threshold Test | SKIPPED | INPUT_QUALITY_TOO_LOW |
| Caino (BS) Coiffeur | NOT_FOUND | INPUT_WEBSITE_NOT_VERIFIED |

100% coverage of the canonical reason_code taxonomy at the URL classification boundary. Pipeline correctly routed every input.

### Tests (Phase 2)
- `tests/unit/normalizer.test.ts` — 13 cases
- `tests/unit/input_website_candidate.test.ts` — 8 cases
- `tests/unit/preverify_gate.test.ts` — 4 cases
- `tests/unit/deduper.test.ts` — 5 cases
- `tests/unit/csv_io.test.ts` — 4 cases
- `tests/unit/provider_router.test.ts` — 4 cases
- `tests/unit/pipeline.test.ts` — 6 cases
- `tests/unit/reason_codes.test.ts` — 5 cases
- `tests/smoke/dns_smoke.test.ts` — 2 cases gated by `RUN_SMOKE=1`

### Tests added in Phase 3
- `tests/unit/dns_mx.test.ts` — 6 cases (mocked DNS resolver)
- `tests/unit/crtsh.test.ts` — 4 cases (parseEntries pure-function tests, no network)
- `tests/unit/ddg_lite.test.ts` — 6 cases (saved HTML fixture parsing)
- `tests/unit/bing_html.test.ts` — 5 cases (saved HTML fixture parsing)
- `tests/unit/serp_deduplicator.test.ts` — 6 cases (registry vs directory routing, multi-provider corroboration, .it boost)
- `tests/unit/rdap_validator.test.ts` — 5 cases (PIVA in payload golden, vCard fn match, unrelated registrant, null payload)
- `tests/unit/hyper_guesser.test.ts` — 12 cases (NER, generator permutations, run with mocked DNS)
- `tests/smoke/serp_providers_smoke.test.ts` — 4 live cases gated by `RUN_SMOKE=1`

**93 unit tests, 0 network calls, all green in ~2s.**

### Phase 3 vertical slice on fixture (10 rows)

After Phase 3 the discovery ladder + tightened PreVerifyGate + parked-page filter produce:

| Row | Status | Reason code |
|---|---|---|
| Solo Nome SpA | SKIPPED | INPUT_QUALITY_TOO_LOW |
| Mario Rossi SRL | FOUND_WEBSITE_ONLY | (HYPER_GUESSER → mariorossi.eu) — known degenerate: name is the Italian "John Doe" and fixture PIVA is fake |
| Beauty Center Verona | NOT_FOUND | INPUT_WEBSITE_NOT_VERIFIED |
| Pippo Pluto SNC | NOT_FOUND | REJECTED_DIRECTORY |
| Bad URL Inc | NOT_FOUND | REJECTED_DIRECTORY |
| Quality Threshold Test | SKIPPED | INPUT_QUALITY_TOO_LOW |
| Linkedin Lead | NOT_FOUND | INPUT_WEBSITE_DIRECTORY_OR_SOCIAL |
| Whatsapp Only | NOT_FOUND | INPUT_WEBSITE_MESSAGING_OR_REDIRECT |
| Caino (BS) Coiffeur | NOT_FOUND | INPUT_WEBSITE_NOT_VERIFIED |
| Empty Website Co | NOT_FOUND | REJECTED_DIRECTORY |

Improvements vs Phase 2:
- Search-engine hosts (`bing.com`, `google.com`) added to DIRECTORIES — no more Bing redirect URLs sneaking through SerpStage
- PreVerifyGate now requires ≥2 distinct matched tokens (not just ≥50% ratio) — eliminates single-token coincidence matches
- Parked / under-construction pages skipped before PreVerifyGate — eliminates false positives like `pippopluto.com` or `wo.com`
- Reason-code policy: keep the FIRST informative reason from the ladder, fall back to generic `DISCOVERY_EXHAUSTED` only when nothing more specific was produced

The single remaining false positive (Mario Rossi SRL → mariorossi.eu) is structural: an Italian "John Doe" with a fake PIVA can't be reliably distinguished from a real owner. With a real PIVA, the digit-match check rejects this case deterministically.

---

## Phase 3.5 — Scraper parsers (fixture-driven, no network)

Goal: build PG + Maps parsers and the raw-lead deduper against saved HTML before any live navigation. When Phase 4 wires the live scraper, the only risks remaining will be browser stability, WAF/captcha, and consent — never parsing logic.

**Fixtures (synthetic, modeled on the canonical pg3 selectors):**
- `tests/fixtures/scraper/pg_belluno_normal.html` — 5 cards (1 dropped: empty name) covering: full record, multi-phone (must keep first), PG/IO/plug.it internal-link rejection, NBSP + extra whitespace in name, address in a different comune.
- `tests/fixtures/scraper/pg_milano_overflow.html` — renders the ">200 risultati" banner; the parser must surface `overflow=true` so the orchestrator (Phase 4) can drill down by comune.
- `tests/fixtures/scraper/maps_feltre_feed.html` — 4 cards covering: full record, phone-less card, "Loc." address prefix, website via `aria-label="…sito web…"` variant.
- `tests/fixtures/scraper/maps_incomplete.html` — 4 cards covering: empty-name drop, name from `a[aria-label]` only, name-only card with no other fields.
- `tests/fixtures/scraper/maps_belluno_overlap.html` — overlaps with the Belluno PG fixture so the dedupe exit is exercised end-to-end.

**Parsers (`src/discovery/sources/`):**
- `pagine_gialle_parser.ts` — `parsePagineGialleResults(html, opts) → { results, total_cards, dropped, overflow }`. Selectors: `.search-itm`, `.search-itm__rag`, `.search-itm__adr`, `.search-itm__phone-item`, `a.remove_blank_for_app`, external `a[href^="http"]` with PG/IO/plug.it skip.
- `google_maps_parser.ts` — `parseGoogleMapsResults(html, opts) → { results, total_cards, dropped }`. Selectors: `div[role="feed"]`, `div.Nv2PK`, `.qBF1Pd` / `div.fontHeadlineSmall` / `a[aria-label]` for name, `.W4Efsd span` classified as address vs phone via regex, `a[data-value="Sito web"]` / `a[aria-label*="sito web"]` / `a[aria-label*="Website"]`.

**Raw deduper (`src/discovery/deduper.ts`):**
- Multi-key index: phone (digits, country-prefix-stripped) · name+city · name+address-tokens (fallback when city is missing) · pg_url · maps_url · website host (registrable, `www.` stripped).
- Conservative merge: existing fields always win; incoming fills only the gaps. Caller orders sources by authority (PG before Maps for Italian SMBs).
- Side-effect: post-merge re-indexes the surviving record so a second incoming record can match it via newly merged keys.

**Scrape CLI dry-run (`src/cli/scrape.ts`):**
```
npm run scrape -- \
  --fixture pg=tests/fixtures/scraper/pg_belluno_normal.html,maps=tests/fixtures/scraper/maps_feltre_feed.html \
  --category "agenzie immobiliari" \
  --out output/raw.csv
```
- Emits the deterministic raw CSV columns + a JSONL with the same records.
- Logs at completion: `total_cards`, `dropped_at_parse`, `raw_pre_dedupe`, `raw_post_dedupe`, `collapsed_by_dedupe`, `overflow`. No silent drops.

**Tests added:**
- `tests/unit/pg_parser.test.ts` — 12 cases (Belluno normal: 8, Milano overflow: 2, empty/malformed: 2)
- `tests/unit/maps_parser.test.ts` — 13 cases (Feltre full: 9, incomplete: 3, empty: 2)
- `tests/unit/deduper.test.ts` — extended with 3 new cases (name+address fallback, source-authority merge, maps_url indexing)

**Dry-run results:**
- `pg_belluno_normal + maps_feltre_feed`: 9 cards parsed → 8 records → 0 dedup collapses (no overlap) — scrape produces a stable, well-formed `raw.csv`.
- `pg_belluno_normal + maps_belluno_overlap`: 7 cards parsed → 6 records → 1 dedup collapse (Studio Dolomiti merged from Maps into the PG record, preserving `source: "PG"` because PG is added first and existing wins).

**Total tests now: 124 unit, 0 network. Smoke gated by `RUN_SMOKE=1`.**

---

## Phase 3.6 — Real-fixture gate (parser regression on live HTML)

Goal: prove the synthetic parsers also work on real PG/Maps DOM before any live scraping. The live scraper (Phase 4) should never have to debug parsing logic — only browser stability, WAF/captcha, and consent.

**Capture script:** `scripts/capture_fixtures.ts`
- Headless Chromium via Playwright with realistic Italian UA + locale.
- Best-effort cookie consent click (OneTrust for PG, "Accetta tutto" for Google).
- Saves ONLY the inner HTML of `.search-results` (PG) or `div[role="feed"]` (Maps), wrapped in a minimal HTML shell. No scripts, no profile sidebars, no ads.
- Targets:
  - `pg_belluno` — small comune, normal page
  - `pg_milano` — dense city to validate the overflow banner detection
  - `maps_feltre` — small Maps feed
- Run: `npx tsx scripts/capture_fixtures.ts all` (or one of `pg_belluno`/`pg_milano`/`maps_feltre`).

**Real fixtures captured & committed:**
- `tests/fixtures/scraper/real/pg_belluno.html` — 25 cards
- `tests/fixtures/scraper/real/pg_milano.html` — 25 cards + ">200 risultati" banner
- `tests/fixtures/scraper/real/maps_feltre.html` — 10 cards

**Parser hardenings driven by real DOM:**
1. PG: extended `INTERNAL_HOST_BLOCKLIST` to skip `wa.me`, `whatsapp.com`, `m.me`, `messenger.com` — PG renders these as PG-generated "click to chat" buttons inside cards (URL contains `?text=Da+PagineGialle…`). Without the fix the parser would set the WhatsApp URL as the company website.
2. Maps: span classifier rewrite. The real `.W4Efsd` block contains:
   - Many duplicate spans (Maps uses ARIA-redundant copies for accessibility).
   - `·` bullet-prefixed spans (Maps' visual separator).
   - Status text mixed with phone in the same blocks.
   The new classifier dedupes by text, strips leading bullets, requires an Italian street prefix (`Via`/`Viale`/`Piazza`/`Corso`/`Largo`/`Vicolo`/`Strada`/`Loc.`/`Località`/`Borgo`/`Contrada`/`Frazione`/`Piazzale`/`V.le`/`C.so`/`P.za`/`Pza`) for address, and a tightened phone regex (`(?:\+39\s?)?(?:0\d{1,4}|3\d{2})…`) for phone. The previous bare `\d{5}` fallback was removed because Italian phone numbers also match it (e.g., `0439 80699` was getting classified as a ZIP code).

**Tests added:** `tests/unit/parsers_real_fixtures.test.ts` — 20 cases that gate against DOM drift:
- PG Belluno: card count, drop count = 0, overflow=false, ≥80% pg_url coverage, ≥60% province=BL, ≥20% phone (PG hides most behind click-to-reveal), zero `wa.me`/`whatsapp` website leaks, zero PG-internal website leaks.
- PG Milano: overflow=true detected, province=MI on most cards.
- Maps Feltre: every card has `maps_url`, ≥50% phone coverage, ≥1 website, no phone-as-ZIP confusion, every parsed address starts with a valid Italian street prefix, `cityHint` applied where address has no parsable city.

If the real DOM evolves, re-run the capture script and adjust regex/selectors only — synthetic edge-case tests stay authoritative.

**Total tests: 144 unit + 1 placeholder, 0 network in unit suite. Smoke gated by `RUN_SMOKE=1`.**



## Prime Directive

> pg4 must first be a working vertical slice, not a complete replica of pg3. Every module ported from pg3 must have: a clean interface, a minimum test, an explicit reason recorded here, and no implicit dependency on pg3 code paths.

---

## 1. Useful pg3 modules — port these (selectively, rewritten)

### 1.1 Input handling
- `pg3/src/foundation/InputNormalizer.ts` — Italian-aware normalization (NFC, dash/quote cleaning, province codes via `PROVINCE_CODES` set, VAT 11-digit check, legal-suffix stripping for SRL/SPA/SNC/SAS/SCARL/SRLS, +39 phone prefixing, quality_score 0-1). **Port wholesale into `pg4/src/discovery/input_normalizer.ts`** — this is one of the cleanest things in pg3.
- `pg3/src/foundation/InputWebsiteCandidate.ts` — URL classification (VALID/INVALID/DIRECTORY_OR_SOCIAL/MESSAGING_OR_REDIRECT) + variant generation (https/http × www/no-www × path/no-path × registrable host). **Port wholesale into `pg4/src/discovery/website/input_website_candidate.ts`**. Drop the `ContentFilter` direct dependency — inject it.
- `pg3/src/enricher/core/discovery/content_filter.ts` — directory/social blocklist, parking/construction patterns, Italian stop-words. **Port the lists, drop the class wrapper**: expose pure functions `isDirectoryOrSocial`, `isParked`, `isUnderConstruction`, `isItalianContent`.

### 1.2 Discovery ladder (the crown jewel)
- `pg3/src/foundation/MasterPipeline.ts` — multi-stage discovery with BestLoser tracker, RDAP corroboration, Oracle seed-confidence map. **Re-architect into `pg4/src/enrichment/enrichment_pipeline.ts`** as a list of stage objects with a unified `Stage` interface — same logic, less monolithic. The 950-line single class is the single biggest readability problem in pg3.
- `pg3/src/foundation/PreVerifyGate.ts` — VERIFIED / VERIFIED_SEMANTIC / NEEDS_BROWSER tri-state via PIVA digit-match in HTML body and semantic name match.
- `pg3/src/foundation/SerpDeduplicator.ts` — multi-provider tier-cascade with cross-provider dedup.
- `pg3/src/enricher/core/discovery/hyperguesser_vx/` (728 lines, 7 files: fetcher, generator, hyper_guesser_vx, italian_ner_parser, resolver, semantic_matcher, validator). **Port the whole folder structurally** to `pg4/src/discovery/website/hyper_guesser/`. Do NOT flatten — every strategy has empirical value. Simplification (if any) only after Phase 5 benchmark proves which strategies under-perform.
- `pg3/src/enricher/core/discovery/rdap_validator.ts` — RDAP/WHOIS check via `rdap.nic.it` for `.it` domains and `rdap.org` redirector for others. P.IVA in JSON payload → 0.9 confidence; vCard `fn`/`org` name match → 0.4. **Port wholesale**.

### 1.3 Cost & control infrastructure
- `pg3/src/shared-runtime/budget/CostLedger.ts` — file-backed ledger of provider call cost.
- `pg3/src/shared-runtime/routing/CostRouter.ts` — tiered provider selection (Tier 0=free → Tier 4=expensive paid LLM).
- `pg3/src/shared-runtime/control/BackpressureValve.ts` — concurrency throttle responding to error rate.
- `pg3/src/shared-runtime/cache/MemoryFirstCache.ts` — L1 in-memory + optional Redis. **Port L1-only in v1, Redis behind interface for later.**

### 1.4 Browser
- `pg3/src/shared-runtime/browser/BrowserPool.ts` — Playwright multi-context pool with session-state persistence. **Port for enrichment** (concurrent short-lived URL checks).
- `pg3/src/scraper/core/browser/factory_v2.ts` — single-page long-lived session (cookies persist). **Port for scraping** (PG/Maps navigation across many pages).
- Keep both. Distinct roles. **Do not collapse them.**

### 1.5 Scraper sources
- `pg3/src/scraper/runner.ts` — checkpoint-driven PG + Maps scraper, overflow detection (>200 results triggers comune-level split), browser refresh every N nav.
- `pg3/src/scraper/providers/maps_grid_provider.ts` — Google Maps `div[role="feed"]` scroll-loop with stall detection.
- `pg3/src/scraper/ai/municipality_splitter.ts` — LLM-driven province → 5 comuni (file cached, normalized province keys). **Optional — falls back to province-only if no LLM key.**
- `pg3/src/scraper/data/pg_categories.ts` — `PROVINCE_CODES` + `PROVINCE_NAME_TO_CODE` reference data.

### 1.6 Directory harvesters
- `pg3/src/enricher/core/directories/fatturato_italia.ts` — fatturatoitalia.it harvester for revenue + employees.
- `pg3/src/enricher/core/directories/paginegialle.ts` — PG harvester used inside enrichment pipeline (phone-based entity match).

### 1.7 Financial validation
- `pg3/src/enricher/core/financial/vies.ts` + `patterns.ts` — VAT VIES check + Italian financial regex patterns.

### 1.8 Provider clients
- `pg3/src/enricher/utils/hunter_client.ts` — Hunter.io email finder.
- `pg3/src/enricher/utils/oracle_client.ts` — Crawl4AI fallback for Google stealth.
- `pg3/src/enricher/utils/scraper_client.ts` — Bright Data Web Unlocker fallback.

---

## 2. Useful pg1 modules — borrow ideas

- `pg1/src/modules/normalizer/index.ts` — phone parsing is more thoughtful than pg3 (split on `;` and ` / `, keep raw + formatted vectors, +39 prefix logic for landline/mobile). **Borrow this phone logic** into `pg4/src/discovery/input_normalizer.ts` (otherwise port pg3's normalizer).
- `pg1/src/modules/decider/index.ts` — explicit `DecisionStatus` enum + `reason_code` mapping (`OK_LIKELY_NAME_CITY_MATCH`, `REJECTED_DIRECTORY_OR_SOCIAL`, `ERROR_TIMEOUT_FETCH`, `ERROR_BLOCKED_403`, etc.). **Borrow the reason_code taxonomy** — far more disciplined than pg3's ad-hoc strings.
- `pg1/src/modules/scorer/index.ts` — evidence-based scoring (PIVA found, name match, phone match, etc. each contribute weighted points). **Borrow the evidence-summing pattern** for `lead_score` in pg4 output.
- `pg1/src/types/index.ts` — `DecisionStatus` enum approach. **Borrow the enum-as-status pattern** for pg4's `LeadStatus`.

---

## 3. What NOT to port

| Pattern | Why |
|---|---|
| `pg3/foundation/{BackpressureValve,BrowserPool,CostLedger,CostRouter,MemoryFirstCache,runtime_factory,provider_adapter,search_result_selectors}.ts` | Re-export shims left from a past migration. pg4 imports directly from runtime layer. |
| `rate_limiter.ts` + `rate_limiter_v9.ts` | One canonical rate limiter in `pg4/src/runtime/rate_limiter.ts`. |
| `lead_scorer.ts` + `lead_scorer_v2.ts` | One canonical scorer. |
| `hyper_guesser_v2.ts` (alongside `hyperguesser_vx/`) | Drop v2; keep only the vx folder. |
| `llm_service.ts` + `service.ts` (in enricher/core/ai) | One LLM service. |
| Three loggers (`enricher/utils/logger`, `scraper/utils/logger`, `shared-runtime/logging/Logger`) | One canonical pino-style logger. |
| `pg3/src/scripts/v6_benchmark_100.ts`, `v7_benchmark_100.ts`, `v8_benchmark.ts`, `v8_benchmark_wave.ts`, `test_*.ts` (≈15 files) | Test/benchmark scripts mixed with production code. pg4 puts these under `tests/` properly. |
| `LinkedInSniper`/`PecHunter`/`BilancioHunter` as separate classes | Collapse into stage modules under `enrichment/{decision_maker,contact,financial}_enricher.ts`. The class names smell of feature-driven splitting; the actual logic is small. |
| `pg3/src/foundation/StopTheBleedingController.ts` + `OpportunisticExtractor.ts` + `LLMOracleGuard.ts` + `ShadowRegistry.ts` (as separate top-level classes) | Useful logic, but should live inside the enrichment pipeline as private helpers, not as a constellation of dependency-injected singletons. |
| BullMQ + Neo4j + Express + MCP server + worker/scheduler split (`pg3/src/server.ts`, `mcp_server.ts`, `enricher/worker.ts`, `enricher/scheduler.ts`, `enricher/queue/index.ts`) | Out of scope for pg4 v1. Re-introduce only if the CLI hits scaling limits. |
| Browser code triplicated (scraper/core/browser, enricher/core/browser, shared-runtime/browser) | One implementation per role (factory single-page + pool multi-context). |
| Names with `v6/v7/v8/v9/nuclear/omega` | Banned in pg4 module names. |

---

## 4. pg4 architecture decisions

### 4.1 Module shape
- **No "Hunter", "Sniper" classes.** Stage modules: `financial_enricher`, `contact_enricher`, `decision_maker_enricher`, `employee_enricher`, `post_processor`. Pure functions where possible.
- **`Stage` interface** (`pg4/src/enrichment/enrichment_pipeline.ts`): `{ name, run(context, lead): Promise<StageOutcome> }`. Pipeline = `Stage[]`.
- **`Provider` interface** (`pg4/src/types/providers.ts`): `{ id, family: 'serp'|'http'|'llm', tier, costEur, available(): boolean, execute(payload): Promise<T> }`. Catalog = `Provider[]`.
- **`Lead` is one shape** in `pg4/src/types/lead.ts`. Raw fields + enriched fields, every enriched field optional. No `RawLead` vs `EnrichedLead` parallel types.

### 4.2 Reason codes (canonical taxonomy, locked Phase 1)
Borrowed from pg1's decider, extended with pg3's stage-specific codes:
- **Success:** `FOUND_COMPLETE`, `FOUND_WEBSITE_ONLY`, `ENRICHMENT_ONLY_NO_WEBSITE`, `OK_LIKELY_NAME_CITY_MATCH`
- **Input quality:** `INPUT_QUALITY_TOO_LOW`, `ERROR_INVALID_INPUT_ROW`
- **Discovery exhausted:** `DISCOVERY_EXHAUSTED`, `DISCOVERY_EXHAUSTED_BLEEDING_MODE`, `NOT_FOUND_NO_CANDIDATES`
- **URL rejection:** `INPUT_WEBSITE_INVALID`, `INPUT_WEBSITE_DIRECTORY_OR_SOCIAL`, `INPUT_WEBSITE_MESSAGING_OR_REDIRECT`, `REJECTED_DIRECTORY`
- **Network/blocking:** `ERROR_TIMEOUT_FETCH`, `ERROR_BLOCKED_403`, `ERROR_DNS`, `ERROR_PROVIDER_RATE_LIMIT`, `ERROR_FETCH`
- **Verification:** `INPUT_WEBSITE_TIMEOUT`, `INPUT_WEBSITE_NOT_VERIFIED`, `PHONE_ENTITY_TIMEOUT`, `PHONE_ENTITY_NOT_VERIFIED`, `PHONE_ENTITY_DIRECTORY_ONLY`
- **Internal:** `ERROR_INTERNAL`

Each code is a `const` in `pg4/src/types/output.ts` so the compiler catches typos.

### 4.3 Discovery method labels (for `website_discovery_method`)
- `INPUT_VERIFIED` — input website was correct
- `INPUT_PIVA_MATCH` — input website + P.IVA found
- `INPUT_SEMANTIC` — input website + semantic name match
- `PG_PHONE_SOURCE_TRUST` — PagineGialle phone-based entity
- `EMAIL_DOMAIN` — email domain pivot
- `HYPER_GUESSER` — domain generated + DNS pinged + AI triaged
- `SERP_PIVA_SNIPPET` — P.IVA found in SERP snippet
- `SERP_COMPANY` — top SERP candidate verified
- `SERP_REGISTRY` — registry SERP extracted candidate
- `RDAP_BINGO` — WHOIS PIVA exact match
- `RDAP_NAME_MATCH` — WHOIS name vCard match
- `BEST_LOSER_RESCUE` — weak match rescued by domain similarity + location signal
- `LLM_ORACLE_SEMANTIC` — LLM-corroborated candidate

### 4.4 Cost ladder (provider tiers)
- **Tier 0 (free, deterministic):** dns_mx, crtsh, direct_fetch
- **Tier 1 (free or sub-cent):** ddg_lite, bing_html, serper@$0.001
- **Tier 2 (cheap):** tavily, exa
- **Tier 3 (local browser):** playwright, oracle_crawl4ai
- **Tier 4 (paid premium):** brightdata, firecrawl, perplexity@$0.010, openai/openrouter

`CostRouter` always tries ascending. `BackpressureValve` blocks Tier 3+ calls when the per-lead cost passes ceiling.

### 4.5 Stack lock-in (final)
| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node ≥ 22 | Native `fetch`, AsyncLocalStorage, TLS modern |
| Lang | TypeScript strict | Same as pg3 |
| HTTP | undici | Faster than axios, built-in timeouts; pg3 already uses it for RDAP |
| HTML parse | cheerio | Stable; pg3 uses it |
| Browser | playwright | Patchright optional behind env flag |
| CSV | csv-parse + csv-stringify | Single library family. pg3 mixes csv-writer + fast-csv = bug surface. |
| JSONL | hand-rolled (one append per line) | No dep needed |
| Validation | zod | Same as pg3, lock the env schema |
| Cache | in-memory Map for v1 | Redis adapter behind interface; ShadowRegistry on `better-sqlite3` Phase 3 |
| LLM | openai sdk | Behind `LLMService` interface; OpenRouter via OpenAI-compatible base URL |
| Logger | pino | Structured JSON in prod, pretty in dev |
| Test | vitest | Same as pg3 |

### 4.6 Test boundary (strict)
- `tests/unit/` — ZERO network. Everything mocked. Run on every typecheck.
- `tests/smoke/` — gated by `RUN_SMOKE=1`. Real DNS, real crt.sh, real DDG. Skipped in CI default.
- `tests/fixtures/` — saved HTML for parsers, CSVs for end-to-end.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| PG WAF blocks our IP after N requests | Browser session persistence + 2-3s inter-page delay + proactive restart every N nav (port from pg3 runner.ts) |
| Maps consent walls vary by region | `cookie_consent.ts` with multiple selectors + iframe-handling (port from pg3) |
| LLM cost runaway in municipality_splitter | File cache + LLM-OFF fallback to province-only |
| Playwright instability on long runs | `singleton browser` profile + restart-every-N + `unhandledRejection` swallow for "Target closed" (port the pattern from pg3 RunnerV6) |
| Provider key missing breaks startup | Provider feature flags + silent drop from registry + boot capability log |
| 8s checkUrl timeout cascade kills batch | Per-stage budget + AbortController + reason_code `INPUT_WEBSITE_TIMEOUT` (port from MasterPipeline) |

---

## 6. Vertical slice scope (Phase 2)

**In scope:**
- Read CSV → normalize (Italian-aware) → dedupe by phone+name+address+website
- For each lead with a `website` input: assess via `InputWebsiteCandidate` + try `direct_fetch` (undici) on top 3 variants
- Match success: PIVA digit-match in body OR semantic name match (>=50% tokens, with location anchor)
- Write CSV + JSONL with `status`, `reason_code`, `official_website`, `website_confidence`, `website_discovery_method`, `cost_eur` (=0 always in this slice), `duration_ms`, `errors`

**Out of scope (Phase 3+):**
- DNS/MX/crt.sh providers (wired but feature-flagged off)
- HyperGuesser
- SERP providers
- RDAP
- Browser fallback
- LLM
- Financial / DM / employee / contact enrichment

**Acceptance:**
- `npm run typecheck` green
- `npm test` (unit) green offline
- `npm run enrich -- --input tests/fixtures/sample_companies.csv --out /tmp/out.csv` runs end-to-end, every input row produces an output row, every row has `status` + `reason_code`.

---

## 7. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-05-05 | Use `pino` over hand-rolled logger | Structured JSON for production observability |
| 2026-05-05 | Use `csv-parse` + `csv-stringify` only (drop csv-writer/fast-csv) | Single library family eliminates pg3's IO bugs |
| 2026-05-05 | Defer Redis to Phase 3+ | Phase 2 works with in-memory Map only |
| 2026-05-05 | Borrow pg1 phone parser, pg3 everything-else for normalizer | pg1 phone logic handles `;`/` / ` separators; pg3 lacks this |
| 2026-05-05 | Reason codes are TS const objects, not plain strings | Compiler-checked |
| 2026-05-05 | No `LinkedInSniper`/`PecHunter`/`BilancioHunter` classes | Collapse into stage functions; class proliferation in pg3 was anti-pattern |
| 2026-05-05 | HyperGuesser ported as-is, simplified only post-benchmark | Empirical value of each strategy unknown; do not flatten pre-emptively |
| 2026-05-05 | Two browser modules kept (factory + pool) | Distinct roles: long-lived scraping session vs concurrent enrichment checks |
