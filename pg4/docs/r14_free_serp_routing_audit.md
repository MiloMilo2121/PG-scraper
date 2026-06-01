# R14 — Free SERP Routing Audit & Category Pruning

**Date:** 2026-06-01
**Change type:** category-aware routing policy (conservative, reversible, no deletion)
**Goal:** cut free-enrich latency and provider noise without reducing recall.

---

## 1. Problem

The R12 PD free enrich issued thousands of free SERP calls that produced almost
no usable output. A provider returning HTTP "success" (results retrieved) is not
the same as a *conversion* (a verified final `official_website`). The first-pass
R14 (commit `f64116e`) gated three providers off by call-count alone; this audit
re-derives the decision from **conversion attribution** and replaces the global
gate with a category-scoped routing policy.

---

## 2. Evidence

### 2.1 Retrieval (cost ledger — `output/r12_..._enriched_free.cost-ledger.jsonl`)

Run `run-1780324061936-6b52`, 1,492 leads, category `agenzie immobiliari`, €0.

| Provider | Calls | Ledger kinds | "Success" (retrieval) |
|----------|-------|--------------|-----------------------|
| `direct_fetch` (HTTP) | 2,076 | success 1204 / transport 632 / timeout 165 / other 75 | verification fetcher |
| `bing_html` | 955 | success 955 | 100 % retrieval |
| `dns_mx` | 956 | empty 956 | 0 % |
| `crtsh` | 956 | empty 956 | 0 % |
| `ddg_lite` | 956 | success 1 / empty 955 | 0.1 % |

### 2.2 Conversion (enriched JSONL — `website_discovery_method` of the 536 found)

| Discovery method | Count | providers_used |
|------------------|-------|----------------|
| `INPUT_SEMANTIC` | 352 | `direct_fetch` |
| `HYPER_GUESSER` | 154 | `direct_fetch` |
| `PG_PHONE_SOURCE_TRUST` | 30 | `direct_fetch` |
| **`SERP_COMPANY` (free SERP)** | **0** | — |
| `SERP_PAID` | 0 (paid off) | — |

**Headline finding: the free SERP tier converted ZERO of the 536 websites.**
Not dns_mx, not crtsh, not ddg_lite — and not `bing_html` either. `bing_html`'s
955 "successes" were SERP result pages that every one got rejected at verify
(709 `SERP_DIRECTORY_ONLY` + 34 `SERP_REJECTED_BY_VERIFY`, all on no-website
leads). The authoritative conversion signal is `website_discovery_method ===
SERP_COMPANY`, which is 0.

### 2.3 Answers to the attribution questions

- Did dns_mx / crtsh / ddg_lite ever produce a final website? **No (0 each).**
- Did bing_html produce a final website? **No (0).** It only fed
  `SerpDeduplicator`; all candidates were rejected at verify.
- Useful as corroboration? **No evidence.** The free path doesn't even record the
  SERP provider in `providers_used`, and no lead carries `SERP_COMPANY`.
- Strong enough to prune for this category? **Yes — stronger than expected.** The
  three zero-empties (dns_mx/crtsh/ddg_lite) are unambiguous dead weight; the
  open question is whether `bing_html` free SERP is worth keeping at all for this
  vertical (see §7).

Why they fail here: `dns_mx`/`crtsh` only yield when the input already hints at a
registrable domain — IT real-estate SMBs without a website have none. `ddg_lite`
is rate-limited and serves block pages. `bing_html` retrieves directory/aggregator
pages (PagineGialle et al.) that the verify gate correctly rejects.

---

## 3. Decision

For the **`italian_real_estate`** category profile, the free SERP pass **skips**
`dns_mx`, `crtsh`, `ddg_lite`. `bing_html` is **kept** as the single legitimate
free SERP — a deliberately conservative choice (smaller behavior change; bing may
convert on leads outside this 1,492-sample; removing it entirely is deferred to
R15's paid A/B which will quantify the free-SERP floor). All other categories are
**unchanged** (full free SERP set). Paid Serper behavior is **untouched**.

### 3.1 Mechanism (chosen design)

A pure policy module + a symmetric router primitive — no hidden behavior:

- `src/providers/provider_policy.ts` — `resolveSerpProfile(category)` (`/immobil/i`
  → `italian_real_estate`) and `resolveFreeSerpRoute(category, expandedFree)` →
  `{ profile, excludeProviderIds }`.
- `ProviderRouter` gains `excludeProviderIds` (denylist, symmetric to the existing
  `includeProviderIds` allowlist). "Skip these, keep the rest" — so future free
  providers are kept by default; only the three proven-dead ids are dropped.
- `SerpStage` free pass reads `lead.category` + `SERP_EXPANDED_FREE_ENABLED` and
  passes `excludeProviderIds` to `router.search`. A `debug`-level log records the
  profile and skipped ids.

### 3.2 Why not delete the providers

They cost nothing to keep registered, their `search()`/`parse()` logic and unit
tests are intact, and they may convert on **other** verticals (domain-rich B2B,
where MX/CT signals exist). Pruning is a per-category routing decision, not a
capability removal.

### 3.3 Supersedes the first-pass gate

The earlier global env gate (`SERP_DNS_MX_ENABLED` / `SERP_CRTSH_ENABLED` /
`SERP_DDG_LITE_ENABLED`, default off) is removed: it would have disabled the
providers for *every* category, contradicting "unknown category preserves default
free providers." Provider `available()` is restored to `true`.

---

## 4. How to re-enable (expanded free)

```
SERP_EXPANDED_FREE_ENABLED=true
```

With this set, the `italian_real_estate` profile uses the full free SERP set
again (debug / other-vertical evaluation). Default is `false`.

---

## 5. Expected impact

- **Calls:** −2,868 of 5,899 (−48.6 %) on an R12-equivalent real-estate run
  (dns_mx 956 + crtsh 956 + ddg_lite 956). Hard number from the ledger.
- **Latency:** removes the two timeout/5xx-prone providers (`crtsh`, `ddg_lite`)
  plus `dns_mx` from every real-estate SERP query. Wall-clock win must be
  **measured** on the next run — no figure asserted here.
- **Recall:** 0 expected loss — the skipped providers converted 0 websites.
- **Cost:** unchanged (all free).

---

## 6. Risks & mitigation

- **Rare lead** where `crtsh`/`ddg_lite` would have helped on this vertical:
  bounded by R12 evidence at ≤ 0 conversions; mitigation is `SERP_EXPANDED_FREE_ENABLED`
  or a targeted rerun.
- **Other verticals**: policy is category-scoped; only `/immobil/` categories are
  pruned. Everything else keeps the full set.
- **bing_html may also be dead weight here** (0 conversions) — not acted on in
  R14; flagged for R15.

---

## 7. Next validation

- **R14 verification (recommended, small):** a sampled free enrich (e.g. 100–200
  leads) comparing wall-clock and website count default vs `SERP_EXPANDED_FREE_ENABLED=true`.
  Confirms the latency win and the zero-recall-loss claim with live data.
- **R15:** cost-capped paid A/B (Serper/Exa, ~€0.05, sampled) on the 709
  `SERP_DIRECTORY_ONLY` misses — and, given §2.2, also measure whether dropping
  free `bing_html` for this vertical loses anything.

---

## 8. Verification (this change)

- Typecheck clean.
- New tests: `tests/unit/provider_policy.test.ts` (profile resolution, exclusions,
  router denylist), `tests/unit/serp_stage_category_routing.test.ts` (real-estate
  skips the three, calls bing; generic calls all; expanded-free restores all;
  empty result is a clean not-found, not a breaker failure).
- Provider unit tests (`dns_mx`, `crtsh`, `ddg_lite`) and paid tests
  (`serp_stage_paid_semantic_veto`, `provider_router_paid_gate`,
  `serp_stage_smart_gate`) unchanged and passing.
