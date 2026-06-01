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
