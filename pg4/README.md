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
| 3 | Port strong pieces (HyperGuesser, RDAP, SERP, CostRouter) | ⏳ pending |
| 3.5 | Scraper parser fixtures | ⏳ pending |
| 4 | Live scraper (PG + Maps) | ⏳ pending |
| 5 | Benchmark vs pg3 | ⏳ pending |

**Sanity check (vertical slice):**
```bash
cd pg4 && npm install
npm run typecheck          # green
npm test                   # 49/49 passing
npm run enrich -- --input tests/fixtures/sample_companies.csv --out output/x.csv
# → 10/10 rows produced; every row has status + reason_code; zero silent drops.
```
