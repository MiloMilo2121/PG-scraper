# R15 — Expanded-Free A/B (decision record)

**Date:** 2026-06-01
**Type:** decision record (docs only — the routing code shipped in R14, commit `cb9e663`)
**Status:** CLOSED — expanded free SERP is not useful for `italian_real_estate`.

Raw evidence and method live in `docs/r14_free_serp_routing_audit.md` §9; this doc
is the standalone decision.

---

## Result (150-lead immobiliari sample, live, free, €0)

Two identical free enrich runs over the same 150 leads (every 10th row of the R12
PD raw, spread across all comuni), differing only in `SERP_EXPANDED_FREE_ENABLED`.

| Metric | DEFAULT (R14) | EXPANDED-FREE | Δ |
|--------|---------------|---------------|---|
| Websites found | **61** (40.7 %) | **61** (40.7 %) | **0** |
| `SERP_COMPANY` (free SERP conversions) | 0 | 0 | 0 |
| Discovery methods | INPUT_SEMANTIC 41 / HYPER_GUESSER 17 / PG_PHONE 3 | identical | — |
| Total provider calls | 289 | 556 | **+267** |
| Wall-clock | **111 s** | **337 s** | **+226 s (≈3×)** |

Expanded-free added 267 calls (`dns_mx`/`crtsh`/`ddg_lite`, 89 each) and 226 s for
**0** extra websites and **0** `SERP_COMPANY`. This corroborates the R12 ledger
analysis with fresh live data.

---

## Decision

1. **Keep `dns_mx`, `crtsh`, `ddg_lite` disabled by default for `italian_real_estate`.**
   Recall loss is **0 (measured)**, latency cost is ≈3× wall-clock. No further
   testing on these three — the question is settled for this vertical.
2. **`SERP_EXPANDED_FREE_ENABLED` is debug / regression only.** Not a production
   knob; exists to re-measure or to evaluate other verticals.
3. **`bing_html`: kept for now.** It also converted 0 here, but the cost is time,
   not money, and this is a single vertical/zone/moment. Dropping it deserves one
   last micro-test (or piggybacks on the paid A/B), not a blind switch-off. The
   bottleneck for this vertical is **not** free SERP.

### Effective production discovery ladder (italian_real_estate)

```
INPUT_WEBSITE  →  PG_DETAIL  →  HYPER_GUESSER  →  bing_html (free SERP, low yield)
                                               →  paid SERP (only if --enable-paid + gate)
debug/regression: full free SERP via SERP_EXPANDED_FREE_ENABLED=true
```

The three load-bearing converters are INPUT_SEMANTIC, HYPER_GUESSER and
PG_PHONE_SOURCE_TRUST — all verified by `direct_fetch`.

---

## What is NOT next

No more experiments on `dns_mx`/`crtsh`/`ddg_lite`. Free wide SERP is closed for
this vertical.

## What IS next (gated, not started)

1. **Paid sample on the misses** — Serper/Exa, small cost cap (~€0.05), on the
   `SERP_DIRECTORY_ONLY` tail, to test whether paid converts what free cannot
   (and, in the same run, whether free `bing_html` is worth keeping at all).
2. **FatturatoItalia (live) + VIES wiring** — commercial value (revenue, employees,
   VAT confirmation) beyond website discovery; needs the post-discovery stage ladder.
3. **Run orchestration + automated report** — for serious production cadence.
