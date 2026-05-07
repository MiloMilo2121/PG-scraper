# Phase G — Serper provider (gated, paid SERP fallback)

**Status:** **LIVE PAID BENCHMARK EXECUTED. Serper remains
DISABLED by decision** — see G.5/G.6 below.

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

**Status: EXECUTED with critical findings — DISABLED for now.**

Three attempts; the first two surfaced load-bearing bugs that
required additional fixes shipped in this commit:

### G.5 — Attempt 1 (paidOnly bug)

p90 first attempt ran with `--enable-paid --cost-ceiling-eur 0.003
--run-cost-ceiling-eur 0.10`. After 15 minutes:
- 372 paid passes invoked
- **0 actual Serper calls**
- bing_html (free, tier 1, success_rate 1.0) satisfied router.search
  before Serper (tier 2) was reached because paid pass had no way
  to exclude free providers.

Killed manually. Fix: `RouteOptions.paidOnly` flag + SerpStage paid
pass uses it.

### G.5 — Attempt 2 (run-cap not enforced)

p90 second attempt with paidOnly fix. After 15:46 minutes:
- **229 Serper calls = €0.229 spent**
- Run-cap (€0.10) overshot by 229 % despite being passed via CLI
- Cause: `--run-cost-ceiling-eur` was threaded through context but
  never gated at the router. Followup #28 from the original report
  was the load-bearing missing piece.

Killed manually. **Real money committed: €0.229.** Fix:
`RouteOptions.runCostCeilingEur` + router filter:
`ledger.getTotal() + cost > runCostCeilingEur` drops paid providers.

Also discovered: many SERP_PAID matches were directory / registry
URLs (paginegialle.it, atoka.io, cercacasa.it, etc.) bypassing the
verify gate. The `SerpDeduplicator` "registry pivot" logic kept
these around — but pg4 has no pivot stage, so they ended up as
`official_website`. Fix: directory check at the START of
`verifyCandidates`, before fetch.

### G.5 — Attempt 3 (final, with all 3 fixes)

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p90_pd_enriched_serper_010.csv \
  --enable-paid --cost-ceiling-eur 0.003 --run-cost-ceiling-eur 0.10
```

| field | value |
| --- | --- |
| 437 in → 437 out | ✓ |
| total cost EUR | **€0.099** ≤ €0.10 ✓ run-cap held |
| Serper calls | 99 (100th would have exceeded €0.10 → blocked) |
| 1 ledger summary | ✓ |
| direct_fetch breaker | CLOSED ✓ |
| found | 113 (vs p85 53; +60 new, 0 lost) |
| SERP_PAID matches | 61 |

### G.5 — Precision audit on the 60 new finds

Manual surface scan of the 60 new finds in p90 vs p85:

**~30 likely TPs** (composite brand domains):
studiozetapadova.it, euganeacase.com, costruzionibordignon.it,
agenziaimmobiliare2000.it, trifoglioimmobiliare.com,
immobiliareberto.it, helioscasa.it, immobiliareumberto.it,
veleimmobiliare.it, pintonello.it, studiolacoccinella.it,
szaffari.it, coltroimmobiliare.it, finlucati.it,
immobiliaremarino.it, ilcubosi.it, antonianacase2.it,
arcuum.eu (×2), zabarella.it, giovannadoriguzzi.it,
immobiliare-forcellini-nazareth.it, puntoimmobiliare.it,
intercasaimmobiliare.it, studioimmobiliaresigma.it,
appartamentiapadova.it, immobiliareanna.padova.it.

**~30 FPs**:

Directory aggregators NOT in the current `DIRECTORIES` blocklist:
`cercacasa.it ×4`, `atoka.io ×3`, `agentiimmobiliariabilitati.it`,
`padovamls.it`, `portaleagenzieimmobiliari.it ×2`,
`infoisinfo.it ×2`, `oikia.it`, `companyreports.it`, `gowork.it`,
`ioaffitto.it`, `fiaipveneto.it`, `anacipadova.it`,
`immobiliweb.com`, `reportazienda.it`, `tellows.it`.

Wrong-sector / public-administration / random:
`treccani.it` (encyclopedia), `bonaldo.com` (furniture),
`helvetia.com` (insurance), `pickandroll.it` (basketball news),
`bed-and-breakfast.it` (B&B platform),
`beniculturali.unipd.it` (university),
`consorziopadovaovest.it` (public administration),
`aterpadova.it` (public housing authority),
`lucabottoniteam.wordpress.com` (random blog).

**SERP_PAID precision floor ≈ 50 %.**

The free pipeline (p85) had a precision floor of ~98 % after Phase
F.1+F.3 audits. Serper-fed results are MUCH noisier because Google
indexes a wider set of aggregator/directory pages, and the current
`DIRECTORIES` set is BL/TV/VR/PD-derived, not Serper-derived.

### G.6 — Decision: DISABLE for now, NEED-MORE-AUDIT

**Disable Serper as a default fallback** until the directory
blocklist is hardened with the 15+ Serper-specific aggregators
observed in p90. Free pipeline (p85) is more reliable as-is at
zero cost.

Total real spend across all attempts: **€0.328** (€0.229 attempt 2
+ €0.099 attempt 3). Money is committed; the lessons are recorded.

### G.7 — Followups

- **#27→#31** Expand `DIRECTORIES` blocklist with the 15+ Serper-
  specific aggregators observed in p90 (cercacasa.it, atoka.io,
  agentiimmobiliariabilitati.it, padovamls.it,
  portaleagenzieimmobiliari.it, infoisinfo.it, oikia.it,
  companyreports.it, gowork.it, ioaffitto.it, fiaipveneto.it,
  anacipadova.it, immobiliweb.com, reportazienda.it, tellows.it).
- **#32** Wrong-sector / public-admin filter — heterogeneous
  noise from Serper requires more than COMMON_BARE_STEMS. Maybe
  `BUSINESS_DIRECTORY_DOMAINS` or RDAP-mandatory for paid matches.
- **#33** Re-run paid bench p91 only after #31 + #32 ship; expect
  precision to climb from ~50 % to ~85 %+.
- **#34** Per-host scoping for direct_fetch breaker (carried over).

### G.8 — Next paid run contract

Do **not** run another Serper benchmark until #31 and #32 are shipped.
The p90 result proved that the paid integration is safe from a cost
perspective, but not yet reliable enough from a precision perspective.

Once the Serper-specific filters are in place, the next benchmark is:

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p91_pd_enriched_serper_filtered_010.csv \
  --enable-paid \
  --cost-ceiling-eur 0.003 \
  --run-cost-ceiling-eur 0.10
```

Hard acceptance for p91:
- 437 in → 437 out
- exactly one ledger summary
- total cost ≤ €0.10
- `serper.calls > 0`, but no Serper-specific aggregator domain is
  accepted as `official_website`
- breaker states reported (both direct_fetch and serper)
- Manual audit of every newly-found `SERP_PAID` website. If the paid
  set is too large, audit the riskiest first: single-token domains,
  `.com` generics, public/education/government-looking domains, and
  any site whose title does not clearly match the lead.

Decision target for p91:
- **KEEP** if new paid precision is ≥90 % and cost per accepted TP is
  acceptable.
- **KEEP-LONG-TAIL** if precision is good but cost per TP is high.
- **DISABLE** if paid precision stays below 85 %.
- **NEED-MORE-AUDIT** if PD alone is ambiguous and a second province
  is needed.
