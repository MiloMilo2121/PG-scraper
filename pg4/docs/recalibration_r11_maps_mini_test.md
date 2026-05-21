# R11 — Maps full-coverage mini-test (PD: Padova + Albignasego)

## Purpose

Validate whether `--coverage full` Maps materially improves raw lead
coverage on top of PG, now that the enrichment layer is validated
(PD/BL/VR/TV paid precision 91-97 %). The enrichment bottleneck is
closed; the next leverage point is raw input.

## Environment

- Date: 2026-05-21
- Branch: `pg4/phase-4.4-structure-cleanup`
- Base commit (pre-R11): `40bb32d`
- Paid providers: **disabled** (scrape only, no enrich)
- Headless: true
- Comuni: Padova, Albignasego (2)

## Commands

PG-only baseline:

  npm run scrape -- \
    --category "agenzie immobiliari" \
    --comuni "Padova,Albignasego" \
    --fresh \
    --out output/r11_pg_pd_2comuni.csv

PG + Maps full coverage (5 query variants × 2 comuni = 10 Maps sessions):

  npm run scrape -- \
    --category "agenzie immobiliari" \
    --comuni "Padova,Albignasego" \
    --maps \
    --coverage full \
    --fresh \
    --out output/r11_maps_pd_2comuni_full.csv

Variants used (from `maps_coverage.ts`):
agenzie immobiliari, agenzia immobiliare, consulenza immobiliare,
compravendita immobiliare, mediatore immobiliare.

## PG-only metrics (Step 1)

  | metric              | value |
  | ------------------- | ----: |
  | runtime             | ~2 m 12 s |
  | comuni              |     2 |
  | total_cards parsed  |   400 |
  | raw_pre_dedupe      |   400 |
  | raw_post_dedupe     |   253 |
  | collapsed_by_dedupe |   147 |
  | pg_overflow_count   |     2 |
  | dropped_at_parse    |     0 |

Both comuni hit PG overflow (~200 cards before cap). 36.7 % of raw
PG cards collapsed by dedupe (same agency listed across the two
adjacent comuni).

## PG+Maps full metrics (Step 2)

  | metric                | value |
  | --------------------- | ----: |
  | runtime               | ~6 m 02 s |
  | comuni                |     2 |
  | total_cards parsed    |  1061 |
  | raw_pre_dedupe        |  1061 |
  | raw_post_dedupe       |   520 |
  | collapsed_by_dedupe   |   541 |
  | pg_overflow_count     |     2 |
  | maps_cap_likely_count |     3 |
  | dropped_at_parse      |     0 |
  | Maps sessions         |    10 (2×5 variants) |
  | Maps feed_parsed      |     9 |
  | Maps no_feed (warn)   |     1 |

Maps sessions × outcome:
- 9 / 10 returned a feed (90 % session-success rate)
- 1 / 10 returned no feed (single-place result or rare block — not a
  captcha loop)
- 3 / 10 hit `cap_likely` (~120-card Google Maps cap reached)

Consent handler: pg accepted=0 not_present=2; maps accepted=1
not_present=9 failed=0. No captcha or block patterns.

### Source distribution

  | source primary | count |
  | -------------- | ----: |
  | MAPS           |   267 |
  | PG             |   253 |
  | **total**      |   520 |

  | sources[] union | count |
  | --------------- | ----: |
  | MAPS only       |   267 |
  | PG only         |   230 |
  | MAPS + PG       |    23 |

→ 23 leads were independently found by both sources and merged
(global Deduplicator working). 267 leads are uniquely Maps. 230
remain unique to PG.

### category_match distribution

  | category_match | count |  %    |
  | -------------- | ----: | ----: |
  | (none / blank) |   230 | 44.2  |
  | confirmed      |   183 | 35.2  |
  | mismatch       |   107 | 20.6  |

`mismatch` ≠ noise: the filter correctly flags adjacent businesses
that surface under real-estate Maps queries. Hand-sampled mismatches:

- **Kiron Padova Scrovegni** — Kiron is a financial-broker franchise
  (mediazione creditizia), not a real-estate agency.
- **Fox Group / gestionaleimmobiliare.it** — real-estate CRM
  software vendor (host already in our denylist).
- **Aste Agency SRL** — auction agency (adjacent vertical).
- **Costruzioni Garbo** — construction firm.
- **Negozio in affitto** — a listing, not an agency.

The (none) bucket is the Maps records the PG-tuned category
classifier does not score — not a quality defect, just a coverage
gap of the classifier on Maps payloads.

### Raw website coverage at scrape time

  | source | rows with website | total | rate  |
  | ------ | ----------------: | ----: | ----: |
  | MAPS   |               216 |   267 |  81 % |
  | PG     |                22 |   253 |   9 % |

This is the most consequential finding of R11: Maps cards expose
the agency's own website inline, so we get 216 websites essentially
for free at scrape time, vs PG's 22. Most of the work the enrich
layer normally does to discover websites is short-circuited for
Maps-sourced leads.

## Delta (PG-only vs PG+Maps full)

  | metric                  | PG-only | PG+Maps | delta |
  | ----------------------- | ------: | ------: | ----: |
  | unique leads            |     253 |     520 |  +267 |
  | raw cards               |     400 |    1061 |  +661 |
  | with website at scrape  |      22 |    ~238 | +~216 |

- net_new_leads = 267
- **lift_percent = 267 / 253 = 105.5 %**
- duplicate_collapse_rate = 541 / 1061 = 51.0 %
- maps_only_percent = 267 / 520 = 51.3 %
- category_mismatch_percent = 107 / 520 = 20.6 % (flagged, not silent noise)
- cap_likely_count = 3 / 10 Maps sessions

## Decision

**R11 mini-test — PASSED.**

Maps full coverage more than doubles the raw lead population
(+105.5 %) on the densest PD area with no captcha, no block loop,
clean output integrity (CSV/JSONL row parity, no mojibake, no stale
locks). The category_match classifier correctly flags 20.6 % of
Maps-surfaced records as adjacent-but-non-agency, which is
filtering, not noise contamination.

Bonus signal: Maps surfaces the agency's website 81 % of the time
at scrape time, vs PG's 9 %. This reduces enrich workload and cost
on Maps-sourced leads.

## Recommendation

1. **Keep Maps opt-in.** Do NOT make `--coverage full` default —
   per Marco's mandate, and because it costs ~3× the runtime of
   PG-only (consent + 5 scroll sessions per comune).
2. **Scale next test to PD province (full Maps).** Same category,
   same coverage mode, full provincial comuni list. Expected:
   higher cap_likely rate on the dense urban comuni; need to
   confirm Maps stays stable for ~30+ comuni × 5 variants = 150+
   sessions.
3. **Do not auto-split on cap_likely yet.** Current cap_likely
   surfacing is honest (3/10 here). Auto-split is Phase 4.x and
   needs its own design — not blocking this scale-up.
4. **Mismatch routing.** Consider in a later phase: route
   `category_match=mismatch` leads to a separate review bucket
   instead of mixing them with confirmed. Not needed for raw
   coverage validation.

### Safe next command (operator approval required before running)

  npm run scrape -- \
    --category "agenzie immobiliari" \
    --province PD \
    --maps \
    --coverage full \
    --fresh \
    --out output/r12_maps_pd_province_full.csv

Expected runtime: 30-50 minutes. Expected lift ratio: similar magnitude
to R11 if the area-vs-density relationship holds; may compress on
smaller comuni where PG overflow is not hit.

## Hygiene

- Output lock from commit `6d404ec` held across both Steps; no
  concurrent-writer corruption.
- Step 1's PG-only outputs survived Step 2's `--fresh` (different
  basename; only the shared checkpoint
  `output/.scrape-checkpoint-agenzie-immobiliari.json` is overwritten,
  which is correct behaviour because the checkpoint key includes
  `provider:category:location` — PG and Maps slots don't collide).
- Outputs of record (not committed; `output/` is gitignored):
  - output/r11_pg_pd_2comuni.csv (254 lines = 1 header + 253)
  - output/r11_pg_pd_2comuni.jsonl (253 rows)
  - output/r11_maps_pd_2comuni_full.csv (521 lines = 1 header + 520)
  - output/r11_maps_pd_2comuni_full.jsonl (520 rows)
