# pg4

Clean lead-generation & enrichment pipeline for Italian SMBs.

Two-step pipeline:

1. **Scrape** — collect raw leads from PagineGialle + Google Maps
2. **Enrich** — discover official website + extract PEC/email/revenue/employees/decision-maker

pg4 is the third generation; pg1 (legacy resolver) and pg3 (current sprawling runtime) live alongside as references and are not removed.

---

## Requirements

- Node ≥ 22
- npm
- (Optional) Playwright Chromium for the scraper / enrichment fallback: `npx playwright install chromium`

## Install

```bash
cd pg4
npm install
cp .env.example .env
# fill in only the API keys you actually have — missing keys are silently dropped
```

## Commands

```bash
# 1. Discovery — scrape raw leads
npm run scrape -- --category "agenzie immobiliari" --province MI --out output/raw.csv

# 2. Enrichment — enrich the raw CSV
npm run enrich -- --input output/raw.csv --out output/enriched.csv

# 3. End-to-end (scrape + enrich)
npm run run -- --category "agenzie immobiliari" --province MI --out output/campaign

# Benchmark vs pg3 (best effort — falls back to baseline JSONL if pg3 unavailable)
npm run benchmark -- --input tests/fixtures/sample_companies.csv

# Quality gates
npm run typecheck
npm test                    # unit (zero network)
npm run test:smoke          # smoke (real network, gated by RUN_SMOKE=1)
```

## Directory layout

```
src/
  config/       env + defaults (zod-validated)
  types/        Lead, providers, output (canonical shapes)
  runtime/      logger, cost ledger, cache, backpressure, errors
  browser/      Playwright pool (enrichment) + factory (scraping)
  discovery/    sources/ (PG, Maps) + website/ (candidate, hyper_guesser, RDAP)
  enrichment/   pipeline + financial/contact/dm/employee enrichers
  providers/    serp/ http/ llm/ + cost-tiered router
  io/           CSV + JSONL readers & writers
  cli/          scrape, enrich, run, benchmark
tests/
  unit/         zero-network mock-based
  smoke/        real-network, RUN_SMOKE=1
  fixtures/     sample CSVs + saved HTML for parser tests
```

## Quality rules (enforced)

1. **Zero silent drops** — every input row produces an output row with `status` + `reason_code`
2. **Free-first routing** — DNS/crt.sh/DDG before paid Serper/Exa/Perplexity
3. **Browser as last resort** — direct HTTP first
4. **Cost control** — every provider declares cost; per-lead ceiling triggers degraded mode
5. **One logger, one Lead type, deterministic CSV columns**

See `IMPLEMENTATION_NOTES.md` for the full Phase 0 audit and architecture decisions.

## Status

| Phase | Description | Status |
|---|---|---|
| 0 | Audit + IMPLEMENTATION_NOTES | ✅ done |
| 1 | Scaffold (types, config, IO, CLI stubs, typecheck green) | ✅ done |
| 2 | Vertical slice (CSV → normalize → website-input check → enriched CSV) | ✅ done |
| 3 | Discovery ladder (free SERP providers, SerpDeduplicator, HyperGuesser, RDAP) | ✅ done |
| 3.5 | Scraper parser fixtures (PG + Maps pure parsers, raw deduper, dry-run) | ✅ done |
| 3.6 | Real-fixture parser gate (live HTML for PG + Maps) | ✅ done |
| 3.7 | Legacy failure mining → guardrails (`docs/legacy_failure_taxonomy.md`) | ✅ done |
| 4 | Live scraper: `BrowserFactory`, `consent_handler`, PG live nav with overflow split, Maps grid scroll with `cap_likely`, file-backed checkpoint, CLI fixture + live coexisting | ✅ done |

---

## Live scrape — Phase 4

**Two CLI modes coexist behind `npm run scrape`:**

```bash
# FIXTURE mode (offline, deterministic — used in CI and dev loops)
npm run scrape -- \
  --fixture pg=tests/fixtures/scraper/pg_belluno_normal.html,maps=tests/fixtures/scraper/maps_feltre_feed.html \
  --category "agenzie immobiliari" \
  --out output/raw.csv

# LIVE mode (Playwright headless Chromium)
npm run scrape -- --category "agenzie immobiliari" --province BL --out output/raw.csv
npm run scrape -- --category "agenzie immobiliari" --comuni "Belluno,Feltre,Sedico" --out output/raw.csv
npm run scrape -- --category "agenzie immobiliari" --province BL --maps --out output/raw.csv  # opt-in to Maps
```

**Live-mode flags:**
| Flag | Default | Purpose |
|---|---|---|
| `--province <CC>` | — | curated comuni list per province (`BL`, `MI`, `TO`, …) |
| `--comuni "C1,C2,..."` | — | explicit override list of comuni |
| `--maps` | off | also run Maps feed scrape per comune |
| `--max-pages <N>` | 30 | per-comune PG page cap |
| `--inter-delay-ms <N>` | 3000 | pause between PG pages (anti-WAF) |
| `--restart-every <N>` | 5 | proactive browser restart cadence |
| `--checkpoint <path>` | `output/.scrape-checkpoint-<cat>.json` | resumable checkpoint location |
| `--headless false` | true | run with a visible browser (debug) |

**Safety notes:**
- **Real network calls.** Live mode opens a Chromium session. Don't ship to CI without a network-access flag.
- **Cookie/state persistence.** Browser session lives under `pg4/.browser-state/<id>.json`. Delete the directory to reset consent state.
- **Checkpoint resumability.** Each `(provider, category, location, page)` outcome is JSON-persisted; re-runs skip done entries.
- **Overflow / cap signals are surfaced, not hidden.** PG `overflow=true` and Maps `cap_likely=true` are logged + counted in the run summary; the orchestrator currently lists overflow comuni for manual drill-down (auto-split per geo grid is a Phase 4.x follow-up).
- **Maps is OFF by default in live mode.** PG is more reliable; Maps requires further consent/captcha hardening before being on by default.
| 5 | Benchmark vs pg3 | ⏳ pending |

**Sanity check (vertical slice + scrape dry-run):**
```bash
cd pg4 && npm install
npm run typecheck          # green
npm test                   # 124/124 passing, zero network
npm run enrich -- --input tests/fixtures/sample_companies.csv --out output/enriched.csv
# → 10/10 rows produced; every row has status + reason_code

npm run scrape -- \
  --fixture pg=tests/fixtures/scraper/pg_belluno_normal.html,maps=tests/fixtures/scraper/maps_feltre_feed.html \
  --category "agenzie immobiliari" \
  --out output/raw.csv
# → 9 cards → 8 records (1 dropped at parse: empty name); deterministic CSV columns
```
