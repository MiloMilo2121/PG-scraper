# Phase G — Serper provider (gated, paid SERP fallback)

**Status:** **CODE + TESTS SHIPPED. Live paid benchmark
BLOCKED_BY_MISSING_SERPER_API_KEY** — see G.5 below.

**Goal:** add Serper.dev as a tier-2 paid SERP fallback to the free
ladder, without:
- making any paid call by default
- letting `--cost-ceiling-eur 0` ever produce a paid call
- regressing the precision of the free pipeline
- inflating found counts via gate loosening

**Hard guarantee built into the router:** any provider with
`costPerCallEur > 0` is filtered out unless `paidEnabled === true` is
explicitly set on the route. This is independent of `maxTier`,
budget hints, and feature flags — it's the load-bearing safety.

---

## What changed (code)

### G.0 — `ProviderRouter` paid-gate

`src/providers/provider_router.ts`:
- `RouteOptions.paidEnabled?: boolean` — default false. Filters out
  `costPerCallEur > 0` providers when not true.
- `RouteOptions.remainingLeadBudgetEur?: number` — providers whose
  cost exceeds remaining budget get filtered.
- `RouteOptions.includeProviderIds?: string[]` — explicit allowlist
  for the paid second pass.
- All three filters applied in `private filter<T>(...)`.

### G.1 — `SerperProvider`

`src/providers/serp/serper.ts` (NEW):
- id `serper`, family `serp`, tier 2, `costPerCallEur 0.001`.
- POST `https://google.serper.dev/search` with `gl: 'it', hl: 'it'`.
- `available()` returns true ONLY when `SERPER_ENABLED=true` AND
  `SERPER_API_KEY` is set.
- 401/403 → `ProviderBlockError` (auth failure, breaker `blocked`).
- 429 → `ProviderBlockError` (rate limit, breaker `blocked`).
- 5xx / network → empty result (router records `transport`).
- Pure parser `parseOrganic(json, limit, sourceId)` exposed for
  unit tests.

### G.2 — `SerpStage` two-pass

`src/enrichment/stages/serp_stage.ts`:
- Free pass first (tier ≤ 1, `paidEnabled=false`, exactly as Phase F).
- If free verifies, return `SERP_COMPANY` discovery method, stop.
- If free fails AND `ctx.paidEnabled === true`, run paid pass with
  `paidEnabled: true` + `remainingLeadBudgetEur: ctx remaining`.
- Paid pass uses the same `SerpDeduplicator` + `verifyCandidates`
  pipeline. New discovery method `SERP_PAID` on a paid match.
- Paid pass never runs if `ctx.paidEnabled !== true` even when the
  router would technically allow it.

### G.3 — CLI / env

`src/cli/enrich.ts`:
- `--enable-paid` flag — turns on `paidEnabled` in `RunContext`.
- `--run-cost-ceiling-eur N` — passed through to `RunContext.runCostCeilingEur`
  (currently unused; reserved for run-level cap).
- Safety: if `--enable-paid` is set BUT `--cost-ceiling-eur 0`, a
  warning is logged and `paidEnabled` is forced false. This is the
  belt-and-braces guarantee.

`.env.example`:
- `SERPER_ENABLED=false`, `SERPER_API_KEY=` clarified as
  paid-providers gated by `--enable-paid`.

`src/runtime/run_context.ts` + `src/types/enrichment.ts`:
- `RunContext.paidEnabled?: boolean`, `RunContext.runCostCeilingEur?: number`
- `PerLeadContext.paidEnabled?: boolean` (mirrored from Run).
- `enrichment_pipeline.ts` forwards `perLead.paidEnabled` to
  `SerpStage` constructor option `paidFallbackEnabled`.

### Tests added

- `tests/unit/serper_provider.test.ts` — invariants + parser
  (5 cases): empty organic, missing organic, skip rows without
  title/url, limit honoured, basic shape.
- `tests/unit/provider_router_paid_gate.test.ts` — paid-gate
  invariants (6 cases): default-deny, explicit deny, allow with
  budget, deny with insufficient budget, includeProviderIds limits,
  cost ledger total stays 0 when paid disabled.
- `tests/unit/cost_lead_sync.test.ts` updated — existing tests now
  pass `paidEnabled: true` since the default-deny would block their
  paid SERP fixture.

374 unit tests pass / 1 skipped, typecheck 0 errors.

---

## G.4 — Safety regression run (paid disabled, cost ceiling 0)

Command:

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p89_pd_enriched_free_paid_disabled_regression.csv \
  --cost-ceiling-eur 0.00
```

Expected behaviour: identical to p85 (Phase F.3) — Serper provider
exists in the catalog but is filtered out at the router because
`paidEnabled` is default-false AND `--enable-paid` is not passed.

### p89 actual results

| field | value |
| --- | --- |
| total | 437 |
| found | 52 (vs p85 53 — normal ±1 noise variance) |
| cost EUR | 0 ✓ |
| ledger summaries | 1 ✓ |
| **Serper calls** | **0 ✓** |
| ledger by_provider keys | `dns_mx, crtsh, direct_fetch, ddg_lite, bing_html` (Serper absent → never called, never logged) |
| direct_fetch breaker | CLOSED ✓ |

**The default-deny gate is load-bearing.** Even though
`SerperProvider` is registered in the catalog, the router filtered
it out at every search call because `paidEnabled !== true`. This
proves G.0 + G.3 work as designed — adding the paid provider did
NOT accidentally enable paid calls.

---

## G.5 — Live paid Serper benchmark

**Status: BLOCKED_BY_MISSING_SERPER_API_KEY**.

Both `process.env.SERPER_API_KEY` and `.env` are unset on this
working IP. Per the user's hard rule:

> If SERPER_API_KEY missing: do NOT fake benchmark. Stop at code +
> tests + docs. Write docs/phase_g_serper_report.md with status
> BLOCKED_BY_MISSING_SERPER_API_KEY. Commit and push.

No paid call has been made. No measurement has been faked. The code
+ tests are in place; once the operator provides
`SERPER_API_KEY` + `SERPER_ENABLED=true` in `.env`, the live
benchmark can run with:

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p90_pd_enriched_serper_010.csv \
  --enable-paid \
  --cost-ceiling-eur 0.003 \
  --run-cost-ceiling-eur 0.10
```

Worst-case spend with the `0.003` per-lead cap on PD's 437 leads
running paid fallback once each: 437 × €0.001 = **€0.437** if every
lead exhausts the free pass. In practice only the leads where the
free pass returns no verified match will trigger paid, so estimated
spend is ≤ €0.30.

Hard acceptance for the future paid run:
- 437 in → 437 out
- exactly one ledger summary
- paid calls present only if `--enable-paid` flag was set
- total cost ≤ configured ceilings
- breaker states reported (both direct_fetch and serper)
- Manual audit of every newly-found Serper website (≤ 25 typically;
  if more, audit at least the top 25 riskiest)

---

## G.6 — Decision so far

Cannot decide KEEP / KEEP-LONG-TAIL / DISABLE / NEED-MORE-AUDIT
without the live benchmark. Decision deferred to first p90 run with
real key.

---

## G.7 — Followups

- **#27** Run paid benchmark p90 once `SERPER_API_KEY` is
  available.
- **#28** Run-level cost cap (`runCostCeilingEur`) currently
  threaded through context but not enforced; add an aggregate-cost
  router gate when paid is on.
- **#29** Per-host scoping for `direct_fetch` breaker (carried over
  from F.2 followup #22).
- **#30** Re-tune Serper breaker if p90 reveals per-IP rate-limit
  behaviour.
