# Measurement evidence — free-gold thesis

The free-gold thesis (Phase 1): the website body pg4 already fetches for
verification contains contact intelligence extractable at **€0 marginal
cost**. This folder holds the MEASURED proof.

## Command (re-runnable)
```
pnpm exec tsx src/scripts/probe_free_gold.ts \
  --input output/r12_maps_pd_province_full_enriched_free.jsonl --n 120
```
Read-only, free (tier-0 `direct_fetch` only), writes nothing. Re-fetches a
sample of leads that already had an `official_website` and runs the pure
`extractFromBody` over each, tallying hit-rates.

## Result (2026-06-11, 120 PD sites sampled, 114 fetched, 6 fetch-failed)

| field | hit-rate | thesis bar | verdict |
|---|---:|---|---|
| **email** (same-domain) | **54.4%** | ≥40% | ✅ PASS |
| **any social** (ig/fb/li) | **60.5%** | ≥50% | ✅ PASS |
| **VAT-from-body** (checksum-valid) | **67.5%** | ≥30% | ✅ PASS |
| extra phone | 90.4% | — | (bonus) |
| instagram | 41.2% | — | |
| facebook | 53.5% | — | |
| linkedin | 27.2% | — | |
| PEC (on-site) | 5.3% | — | see note |
| **cost** | **€0** | €0 | ✅ |

Raw output: `probe_free_gold_output.txt`. Command: `probe_free_gold_cmd.txt`.

## Reading the numbers

- **The thesis holds, strongly.** On real Italian company sites already
  fetched in production, the extractor recovers a same-domain business email
  more than half the time, a social profile 60% of the time, and a
  checksum-valid P.IVA two-thirds of the time — all at zero added cost. This
  is the quantitative justification for the whole platform cost model:
  free-first, parse-what-we-already-have, pay only for the gaps.

- **PEC on-site is only 5.3% — and that VALIDATES the design, not refutes
  it.** Italian firms rarely print their PEC on the website; the PEC lives in
  the INI-PEC public registry, keyed by P.IVA. We now extract that P.IVA at
  **67.5%** for free — which is exactly the "VAT-as-master-key" input the
  Phase-3 official-data spine needs to look up PEC (near-100% registry
  coverage) and revenue/employees (fatturatoitalia) by P.IVA. The low on-site
  PEC number is the evidence that the moat (official data by VAT) is where
  PEC/firmographics come from, not the website.

- **6/120 fetch failures** are dead/parked/blocking hosts — expected on a
  6-week-old lead set; they cost nothing and don't enter the denominator
  (rates are over the 114 successfully fetched).

## Honesty note
These numbers were reported exactly as the probe produced them. The thesis
bars were set BEFORE the run (in the approved plan: email ≥40 / social ≥50 /
VAT ≥30). Had they come in below bar, the report would say so — the same
discipline the three prior passes enforced (measure, don't adjust).
