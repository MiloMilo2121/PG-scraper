# R14 — Free SERP Provider Pruning

**Date:** 2026-06-01
**Change type:** conservative, reversible config gate (no deletion, no product change)
**Goal:** reduce free-enrich latency without reducing recall.

---

## 1. Evidence (R12 PD full free enrich)

Source: `output/r12_maps_pd_province_full_enriched_free.cost-ledger.jsonl`
(run `run-1780324061936-6b52`, 1,492 leads, category `agenzie immobiliari`, €0).

| Provider | Calls | Useful (success) | Success rate | Verdict |
|----------|-------|------------------|--------------|---------|
| `bing_html` | 955 | 955 | 100 % | **keep** — the meaningful free SERP |
| `direct_fetch` (HTTP) | 2,076 | 1,204 | 58.0 % | keep — input-website verification |
| `ddg_lite` | 956 | 1 | 0.1 % | **gate off** |
| `dns_mx` | 956 | 0 | 0 % | **gate off** |
| `crtsh` | 956 | 0 | 0 % | **gate off** |

The three gated providers fired **2,868 calls** and surfaced **at most 1** useful
result (the single `ddg_lite` hit may have been independently found by
`bing_html`, so true marginal recall is 0–1 of 536 discovered websites).

Why they fail on this vertical: `dns_mx` and `crtsh` only yield when the input
already hints at a registrable domain — Italian real-estate SMBs with no website
have none to discover. `ddg_lite` is rate-limited and frequently serves a block
page for sequential automated queries.

---

## 2. Change

Each provider's `available()` now reads an env flag, **defaulting to `false`**
(`src/config/env.ts`):

```
SERP_DNS_MX_ENABLED   (default false)
SERP_CRTSH_ENABLED    (default false)
SERP_DDG_LITE_ENABLED (default false)
```

- `bing_html` is **not** gated — always available.
- `serper` (paid) gate is **unchanged** — still `SERPER_ENABLED` + `SERPER_API_KEY` + `--enable-paid`.
- No provider class was deleted. `search()`/`parse()` logic is untouched; only
  the router-facing `available()` predicate changed. Re-enable per vertical with
  a one-line env flag.

Mechanism matches the existing `SERPER_ENABLED` pattern. The router
(`provider_router.ts`) already filters on `available()` first, so a gated-off
provider is simply never a candidate — no call, no ledger entry, no breaker churn.

---

## 3. Expected effect

- **Calls removed:** 2,868 of 5,899 (−48.6 %) on an R12-equivalent free run.
- **Latency:** removes two network-bound providers per SERP query (`crtsh`, which
  is prone to 5xx storms, and `ddg_lite`, which often runs to the request timeout
  on blocks) plus `dns_mx`. For the ~956 leads that reached the SERP stage, the
  free pass now tries `bing_html` directly instead of three near-always-empty
  providers first. Actual wall-clock win must be **measured on the next run** —
  no figure is asserted here.
- **Recall:** ≤ 1 lead of 1,492 (≤ 0.07 %), within run-to-run noise.
- **Cost:** unchanged (all five providers were €0).

---

## 4. Reversibility

Per-vertical re-enable without code change:

```
SERP_DNS_MX_ENABLED=true    # e.g. domain-rich B2B verticals
SERP_CRTSH_ENABLED=true
SERP_DDG_LITE_ENABLED=true
```

The evidence above is **category-specific** (`agenzie immobiliari`). A future
vertical with discoverable domains may benefit from `dns_mx`/`crtsh`; this gate
makes that a config decision, not a redeploy.

---

## 5. Verification

- `tests/unit/free_serp_gate.test.ts` (9 tests, network-free): default-disabled,
  per-flag enable, bing always-on, Serper gate unchanged, catalog capability
  surface, router never calls a disabled provider, empty result does not trip the
  breaker.
- Full suite: typecheck clean, 647 passed / 1 skipped.

---

## 6. Roadmap position

- **R14 (this):** prune low-yield free providers. Zero cost. ✅
- **R15:** cost-capped paid A/B on the 709 `SERP_DIRECTORY_ONLY` misses
  (Serper/Exa, small budget e.g. €0.05, sampled — not full batch).
- **R16:** FatturatoItalia live + VIES wiring (business value beyond websites;
  needs the post-discovery enrichment stage ladder first).
