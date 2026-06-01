# R12 PD-Province Full Maps Scrape — Recalibration Report

**Date:** 2026-06-01  
**Artifact baseline:** `output/r12_maps_pd_province_full.{csv,jsonl}`

---

## 1. Producing Command (Inferred)

```
pnpm run scrape -- \
  --category "agenzie immobiliari" \
  --province PD \
  --maps \
  --coverage full \
  --out output/r12_maps_pd_province_full.csv
```

Inferred from: output basename convention (`r12_maps_pd_province_full`), presence of dual-source records (PG + MAPS), `--maps` flag requirement for Maps to run in live mode, `--coverage full` inferred from the 12-comuni query_location spread across the PD province (Padova, Cittadella, Albignasego, Vigonza, Cadoneghe, Monselice, Selvazzano Dentro, Este, Rubano, Camposampiero, Abano Terme, Limena). No checkpoint file found in `output/`.

---

## 2. Raw Metrics

| Metric | Value |
|--------|-------|
| CSV lines total (incl. header) | 1,493 |
| CSV data rows | **1,492** |
| JSONL lines | **1,492** |
| Alignment (CSV data rows == JSONL lines) | **YES** |
| raw_pre_dedupe | not available from artifacts |
| raw_post_dedupe | not available from artifacts |
| collapsed_by_dedupe | not available from artifacts |

No checkpoint file exists at `output/r12_maps_pd_province_full*checkpoint*`. Dedupe counts are not derivable from the artifacts.

---

## 3. Source Distribution

### Primary `source` field

| Source | Count | % |
|--------|-------|---|
| MAPS | 785 | 52.6% |
| PG | 707 | 47.4% |
| **Total** | **1,492** | |

### `sources` array (multi-origin tracking)

| Combination | Count | % |
|-------------|-------|---|
| MAPS only | 785 | 52.6% |
| PG only | 651 | 43.6% |
| PG + MAPS (merged) | 56 | 3.8% |
| **Total** | **1,492** | |

**Merged records (56):** PG record matched and merged with a Maps counterpart. These carry 100% phone fill, 89% website fill, full address+province.

**Note:** The `source` field reflects the canonical source used for record key fields. `sources` array reflects all origins contributing to the record. 56 records appear in PG with PG as primary `source` but carry MAPS data in `sources` + `maps_url`.

---

## 4. Query Coverage (Comuni Scraped)

12 municipalities queried, per `query_location` distribution:

| Municipality | Records |
|-------------|---------|
| Padova | 322 |
| Cittadella | 279 |
| Albignasego | 200 |
| Vigonza | 161 |
| Cadoneghe | 130 |
| Monselice | 105 |
| Selvazzano Dentro | 63 |
| Este | 63 |
| Rubano | 50 |
| Camposampiero | 50 |
| Abano Terme | 40 |
| Limena | 29 |

---

## 5. Category Distribution

| Category | Count | Source |
|----------|-------|--------|
| agenzie immobiliari | 915 | PG: 707, MAPS: 208 |
| consulenza immobiliare | 233 | MAPS only |
| compravendita immobiliare | 156 | MAPS only |
| agenzia immobiliare | 102 | MAPS only |
| mediatore immobiliare | 86 | MAPS only |

PG produces a single canonical category (`agenzie immobiliari`). Maps returns 5 category variants for the same target vertical. Category normalization is not applied at scrape time.

---

## 6. `category_match` Distribution

Only MAPS records carry `category_match` (the field is `MISSING` for all 651 PG-only records, as PG uses a hardcoded category query).

| Source group | confirmed | mismatch | MISSING |
|-------------|-----------|----------|---------|
| MAPS-only (785) | 408 (52%) | 377 (48%) | 0 |
| PG-only (651) | 0 | 0 | 651 (100%) |
| PG+MAPS merged (56) | 52 (93%) | 4 (7%) | 0 |

**MAPS mismatch rate is 48%.** Mismatch categories: `compravendita immobiliare` (144), `consulenza immobiliare` (126), `mediatore immobiliare` (53), `agenzia immobiliare` (37), `agenzie immobiliari` (17). These are not semantic mismatches — they are all real-estate verticals. The mismatch flag fires when the Maps category label does not exactly match the PG query term, not when the business is out-of-vertical. This means the mismatch filter, if used as a hard exclusion, would drop ~377 valid records.

---

## 7. Cap / No_feed / Captcha Markers

| Marker | Count |
|--------|-------|
| cap / cap_hit | 0 |
| no_feed | 0 |
| captcha | 0 |
| discovery_notes populated | 0 |

No cap, no_feed, or captcha events recorded in any JSONL record. The `discovery_notes` field is empty across all 1,492 records.

---

## 8. Data Quality

### Alignment
CSV header row: `company_name,category,city,province,region,address,phone,website,source,source_url,pg_url,maps_url,vat_code,confidence,discovery_notes,query_location,business_city,category_match`  
JSONL has 16 fields (superset): adds `sources` (array), `zip_code`; the CSV maps these to columns. Aligned at 1,492 rows.

### Mojibake
0 records with mojibake sequences (chr(195) scan across `company_name`, `address`, `city`, `category`). Encoding is clean UTF-8.

### Field Fill Rates

| Field | MAPS-only | PG-only | PG+MAPS merged | Total |
|-------|-----------|---------|----------------|-------|
| company_name | 100% | 100% | 100% | 100% |
| category | 100% | 100% | 100% | 100% |
| city | 100% | 100% | 100% | 100% |
| address | 91% | 100% | 100% | 95% |
| phone | 85% | 7% | 100% | 51% |
| website | 70% | 0% | 89% | 40% |
| maps_url | 100% | 0% | 100% | 56% |
| pg_url | 0% | 100% | 100% | 47% |
| zip_code | 1% | 100% | 100% | 48% |
| province | 0% | 100% | 100% | 47% |
| vat_code | 0% | 0% | 0% | **0%** |
| category_match | 100% | 0% | 100% | 56% |

PG-only records have 0% website and 7% phone — expected, PG scrape does not follow through to profile pages. MAPS-only records lack zip_code (1%) and province (0%) — Maps returns city name but not structured postcode/province.

### Province Coverage
707 PG records carry province field; MAPS-only records have none. Non-PD provinces present in the dataset: VI (112), TV (52), RO (49), VE (48), VR (1) — these come from PG results for the 12 comuni query covering some inter-provincial border municipalities.

### Duplicate Names
38 company names appear more than once (81 records total):
- **PG-PG collisions (31 name pairs):** Same company found in multiple comuni query sweeps — legitimate multi-branch agencies (e.g. "Agenzia Immobiliare Florida" has offices in Padova and Camposampiero). These are not errors; they are real branch records at different addresses.
- **MAPS-MAPS collisions (3 name pairs):** Possible genuine duplicates from overlapping geo queries.
- **PG-MAPS not merged (4 pairs):** Name match but not deduplicated — likely address/normalization mismatch prevented merge.

Raw dedupe counts (raw_pre_dedupe / raw_post_dedupe / collapsed_by_dedupe) are **not available from artifacts** — no checkpoint or dedupe log file found.

---

## 9. Metrics Not Available from Artifacts

| Metric | Reason |
|--------|--------|
| raw_pre_dedupe | No checkpoint file at output/ |
| raw_post_dedupe | No checkpoint file |
| collapsed_by_dedupe | No checkpoint file |
| Maps pages scraped per municipality | Not stored in JSONL |
| PG pages scraped per municipality | Not stored in JSONL |
| Scrape wall-clock duration | Not stored |
| Maps query terms used (sector-keyword variants) | Not stored |
| confidence field values | Field present in CSV header but absent in JSONL (0/1492 filled) |

---

## 10. Recommendation

**The 48% MAPS `category_match: mismatch` rate is not a signal problem** — all mismatch categories are real-estate verticals (compravendita, consulenza, mediatore). Do not use `category_match == 'confirmed'` as a hard exclusion gate; it would discard ~377 valid records. Treat it as a soft quality signal or normalize the 5 Maps category variants into a single canonical label (`agenzie immobiliari`) before any downstream filter.

**Province gap on MAPS-only records** (785 records with no province field) should be resolved via post-processing: since all records are within the PD province scrape, a default `province = 'PD'` fill is safe for PD-scoped comuni, with the exception of 262 records from non-PD border municipalities (VI/TV/RO/VE/VR) which require lookup from the `city` field.

---

## 11. Free Enrich Completion + Validation (post-monitor, R13.1)

The free-only enrich (`--cost-ceiling-eur 0`, run_id `run-1780324061936-6b52`) ran on the full 1,492-lead raw batch and **completed cleanly** — monitored to process exit, lock released cleanly (no fatal/stale). Validated with `validate_output.ts`: **PASS**.

> Operating rule applied this run: **never regenerate a raw output while a live enrich is consuming it as input.** The raw R12 artifact was left untouched throughout; no `--fresh`, no re-scrape.

### Validator result (`--max-cost 0`)
| Check | Result |
|-------|--------|
| ok | `true` |
| csv_rows == jsonl_rows | 1492 == 1492 ✓ |
| ledger summaries | 1 ✓ |
| run_ids | 1 (`run-1780324061936-6b52`) ✓ |
| total_cost_eur ≤ 0 | 0 ✓ |
| mojibake | none ✓ |
| status / reason_code present | yes ✓ |
| errors | 0 |

### Enrich outcome
| Metric | Value |
|--------|-------|
| Leads processed | 1,492 |
| Leads with website | 536 (35.9 %) |
| Leads errored | 0 |
| Total provider calls | 5,899 |
| Total cost | €0.00 (free-only) |
| Cost per lead | €0.00 |

### Website discovery method (536 found)
| Method | Count |
|--------|-------|
| INPUT_SEMANTIC | 352 |
| HYPER_GUESSER | 154 |
| PG_PHONE_SOURCE_TRUST | 30 |

### Provider efficiency (free tier)
| Provider | Calls | Success | Note |
|----------|-------|---------|------|
| bing_html | 955 | 100 % | SERP workhorse |
| direct_fetch | 2,076 | 58.0 % | input-website verification |
| ddg_lite | 956 | 0.1 % (1) | near-zero yield on this batch |
| dns_mx | 956 | 0 % | all empty — pure overhead here |
| crtsh | 956 | 0 % | all empty — pure overhead here |

### Reason-code distribution (no-website tail)
- `SERP_DIRECTORY_ONLY`: 709 — bulk of misses (SERP returned only aggregators / PagineGialle)
- `INPUT_WEBSITE_NOT_VERIFIED`: 171
- `INPUT_WEBSITE_DIRECTORY_OR_SOCIAL`: 40
- `SERP_REJECTED_BY_VERIFY`: 34
- `INPUT_WEBSITE_TIMEOUT`: 2

### Final recommendation
- **R12 free enrich is production-valid**: aligned outputs, €0, zero errors, 35.9 % website yield from Maps+PG raw with no paid tier. This is the canonical R12 free artifact — do not re-run.
- **Prune dead free providers for this vertical**: `dns_mx` and `crtsh` returned 0/956 each (1,912 wasted calls); `ddg_lite` 1/956. On Italian real-estate they add latency without yield — gate off or demote below `bing_html`.
- **709 `SERP_DIRECTORY_ONLY`** is the conversion target for a capped paid SERP tier (Exa/Serper) — candidate for a sampled, cost-capped A/B, but only after the output-lock pid-reuse fix lands.

---

## 12. Appendix — live-log ground truth + lift framing + next step

Sections 1-11 were authored from the artifacts (and the free-enrich
ledger). This appendix adds the scrape-time metrics from the live
log that the artifacts don't carry, plus the lift framing in the
R11 shape and the suggested next concrete step.

### 12.1 Actual command (not inferred)

  npm run scrape -- \
    --category "agenzie immobiliari" \
    --province PD \
    --maps \
    --coverage full \
    --fresh \
    --out output/r12_maps_pd_province_full.csv

Runtime: ~31 minutes (13:55 → 14:26 on the run host).
Note: pg4 uses `npm`, not `pnpm`. Playwright auto-bumped to
`chrome-headless-shell` v1223 between R11 and R12; binary wasn't
pre-downloaded — fix was `npx playwright install chromium`. Worth
pinning the Playwright version in `package.json`.

### 12.2 Scrape-time metrics not visible in the artifacts

  | metric                | value |
  | --------------------- | ----: |
  | total_cards parsed    |  5283 |
  | raw_pre_dedupe        |  5283 |
  | raw_post_dedupe       |  1492 |
  | collapsed_by_dedupe   |  3791 |
  | dedupe collapse rate  | 71.8 %|
  | pg_overflow_count     | 12 / 12 |
  | maps_cap_likely_count | 11 / 60 |
  | maps_no_feed warn     |  1 / 60 (Limena) |
  | dropped_at_parse      |     0 |
  | consent failures      |     0 |
  | captcha / block loops |     0 |
  | checkpoint_done       |   179 |

Section 7's "0 cap / 0 no_feed / 0 captcha" reading was correct
*for the JSONL records* — JSONL doesn't carry those run-level
markers. The actual run did hit cap_likely on 11 of 60 Maps
sessions and one no_feed warn on Limena. They were surfaced
honestly in the run summary, not silent.

12 / 12 PG queries hit overflow → PG alone undercounts on every
PD comune, including satellites. The 71.8 % collapse rate confirms
the deduper is the load-bearing component across the PG + 60-Maps
sweep.

### 12.3 Lift framing in R11 shape

- Implicit PG-only baseline = leads where `sources[]` includes PG
  = 651 (PG only) + 56 (PG+MAPS merged) = **707 PG-touched leads**
- Maps-only additions = **785 net new leads**
- **lift_percent = 785 / 707 = 111.0 %**

Sits right at R11's mini-test (105.5 %) — the lift holds at
province scale.

### 12.4 R11 → R12 comparison

  | metric                       | R11 (2 comuni) | R12 (PD prov, 12 comuni) |
  | ---------------------------- | -------------: | -----------------------: |
  | unique leads                 |            520 |                     1492 |
  | net-new from Maps            |           +267 |                     +785 |
  | lift over PG-only            |        105.5 % |                   111.0 %|
  | with_website (free enrich)   |     229 (44.0%)|              536 (35.9%) |
  | INPUT_SEMANTIC               |            166 |                      352 |
  | HYPER_GUESSER                |             46 |                      154 |
  | PG_PHONE_SOURCE_TRUST        |             17 |                       30 |
  | maps_cap_likely              |         3 / 10 |                  11 / 60 |
  | maps_no_feed                 |         1 / 10 |                   1 / 60 |
  | consent failures             |              0 |                        0 |
  | captcha / block              |              0 |                        0 |

Per-lead website rate dropped 44.0 % → 35.9 % at province scale —
satellite comuni include more rural agencies with weaker web
presence. Absolute count up 2.34× for +10 comuni at €0.

### 12.5 Suggested next step (operator approval required)

Scale the methodology to TV next under the same no-paid free-enrich-
pair protocol. R10.b TV paid validation (commit `1718ce4`, 96.5 %
precision) means the enrichment-side gates are already validated
for TV.

  npm run scrape -- \
    --category "agenzie immobiliari" \
    --province TV \
    --maps \
    --coverage full \
    --fresh \
    --out output/r13_maps_tv_province_full.csv

After R12: not committed (output/ gitignored):
- output/r12_maps_pd_province_full.csv (1 493 lines)
- output/r12_maps_pd_province_full.jsonl (1 492 rows)
- output/r12_maps_pd_province_full_enriched_free.csv (1 493 lines)
- output/r12_maps_pd_province_full_enriched_free.jsonl (1 492 rows)
- output/r12_maps_pd_province_full_enriched_free.cost-ledger.jsonl
  (5 900 events, 1 summary, 1 run_id, total_cost_eur = 0)
