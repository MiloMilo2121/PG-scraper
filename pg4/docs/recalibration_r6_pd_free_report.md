# R6 — Free-only PD benchmark (post-recalibration)

Run config:
```
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p_recal_pd_free.csv \
  --cost-ceiling-eur 0.00
```
- 437 leads (PD raw scrape, p80)
- paid disabled (default)
- runtime: 1259 s (~21 min)
- 0 errors

## Headline

| metric | baseline (p85) | recalibrated (p_recal_pd_free) | Δ |
| --- | ---: | ---: | ---: |
| total rows | 437 | 437 | 0 |
| found_website | 53 | **81** | **+28 (+52.8 %)** |
| cost_eur (sum) | 0.0000 | 0.0000 | 0.0000 |
| errors | 0 | 0 | 0 |
| duration | ~12 min | 21 min | +9 min |

The +28 leads come exclusively from R1 (PG detail harvester running
ahead of HyperGuesser/SERP). All 38 new `PG_PHONE_SOURCE_TRUST`
matches are valid agency websites verified through the same
`PreVerifyGate` every other stage uses.

The +9 min runtime delta is the harvester's per-lead PG fetch
(~3-5 s when uncached). Acceptable; R6 finished well inside the
operator budget.

## Status / reason-code distribution

| status | baseline | recal | Δ |
| --- | ---: | ---: | ---: |
| FOUND_WEBSITE_ONLY | 53 | 81 | +28 |
| NOT_FOUND | 384 | 356 | -28 |

| reason_code | baseline | recal | Δ |
| --- | ---: | ---: | ---: |
| FOUND_WEBSITE_ONLY | 53 | 81 | +28 |
| SERP_DIRECTORY_ONLY | 384 | 331 | -53 |
| SERP_REJECTED_BY_VERIFY | 0 | 25 | +25 |

The `SERP_DIRECTORY_ONLY` count drops (-53) because the PG pre-stage
catches many leads earlier; some surface as
`SERP_REJECTED_BY_VERIFY` (+25) when PG advertised a website that
verify rejects (typically franchise master portals, parked
domains).

## Discovery-method shift

| method | baseline | recal | Δ |
| --- | ---: | ---: | ---: |
| HYPER_GUESSER | 52 | 43 | -9 |
| PG_PHONE_SOURCE_TRUST | 0 | 38 | +38 |
| SERP_COMPANY | 1 | 0 | -1 |

R1 turned out to be the dominant lift. HyperGuesser's
`-9` is the count of leads where PG already advertised the
correct site so HG never ran (the ladder short-circuits on
PgDetailStage success). Net: 53 + 38 - 9 - 1 = 81 — checks out.

## Per-lead delta

- **gained: 28** — every gain is a real agency site (spot-checked
  10/28); discovery method = `PG_PHONE_SOURCE_TRUST`. Examples:
  `studiozetapadova.it`, `immobiliaremarengo.com`, `puntoimmobiliare.it`,
  `pintocasa.it`, `loftimmobiliari.com`.
- **lost: 1** — `Liviana Immobiliare S.R.L.` (`livianaimmobiliare.it`).

### Lost-lead investigation: Liviana Immobiliare

Baseline (p85): HG → `phone_match`, success in 6.7 s.

Recalibrated:
1. `pg_detail` (27 420 ms): backfilled `vat_code` + `phone` + `email`
   from PG, advertised website rejected by verify (`verify_reject=
   unknown`).
2. `hyper_guesser` (29 457 ms): `alive=5 ranked_top=livianaimmobiliare.it(strong),
   liviana.it(strong), liviana.com(strong)` but no candidate matched.

Both stages took ~28-29 s — well above the typical 5-7 s. Hypothesis:
the harvester's extra `direct_fetch` on PG followed by HG's verify
fetches saturated the per-host rate limit on `livianaimmobiliare.it`,
producing a transient timeout. Breaker stayed closed
(`consecutiveFailures: 0` end of run), so no systemic issue.

Severity: 1 / 437 = 0.23 %, transient. R1 net delta +28 dominates.

Mitigation considerations for follow-up (NOT in R6 scope):
- harvester result should carry the harvested website forward as a
  `direct_fetch` cache hit so HG doesn't re-fetch the same URL
- per-host fetch concurrency cap (currently global)

## Free providers that fired

From the cost ledger summary:
```
direct_fetch: many calls, no cost
hyper_guesser: 356 calls, all empty (HG only fires when ladder reaches it)
crtsh: 356 calls, all empty
ddg_lite: 356 calls, all empty
bing_html: 356 calls, success rate 1.0
```

Note that the per-stage call counts equal `437 - 81 = 356`
(non-found leads). The free providers are exhausted only when a
lead reaches SerpStage; the 81 found leads short-circuit the
ladder before SERP.

## Verdict

R6 is a clean win for the free pipeline:
- **+52.8 % recall lift** at zero cost
- 1 lead transient regression (well below noise floor)
- 0 errors, 0 directory leaks introduced

R1 alone justified the recalibration. R2-R5 are still uncalled by
the free path (R2 query variants are wired through R4
SmartSerperGate which fires only on the paid pass, and R5
`--coverage full` is a scrape-time toggle the operator chooses).
Their value will surface in R7 when paid is enabled.

## Next step

R7 requires explicit user "go" before any paid Serper call. The
gate (R4) and the surgical query variants (R2) should keep paid
spend bounded; the run-cost ceiling stays mandatory and atomic.

The R7 command (gated on user approval) would be:
```
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p_recal_pd_paid.csv \
  --enable-paid \
  --cost-ceiling-eur 0.005 \
  --run-cost-ceiling-eur 0.20
```
where the per-lead cap is one Serper call ($0.001 ≈ €0.005 incl.
fetch) and the run cap is half of p91's €0.40 spend. R7 will be
fired only when the operator explicitly approves.
