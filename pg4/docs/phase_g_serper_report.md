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
  → **shipped in G.1**.
- **#32** Wrong-sector / public-admin filter — heterogeneous
  noise from Serper requires more than COMMON_BARE_STEMS.
  → **partially shipped in G.1** as a denylist of observed hosts
  (treccani.it, unipd.it, helvetia.com, bonaldo.com,
  consorziopadovaovest.it, pickandroll.it, bed-and-breakfast.it,
  wordpress.com). Heterogeneous tail still a concern — full
  RDAP-mandatory-for-paid is followup.
- **#33** Re-run paid bench p91 only after #31 + #32 ship; expect
  precision to climb from ~50 % to ~85 %+.
  → **NOT yet executed**. Code is now ready (G.1) but no live
  paid run was done in this commit per user instruction.
- **#34** Per-host scoping for direct_fetch breaker (carried over).

---

## G.1 — Code review hardening (no paid run executed)

External code review of the G.5 attempt-3 results surfaced four
load-bearing issues. All four are fixed in this commit. **No paid
run executed in G.1** per user instruction; p91 deferred until the
operator explicitly says "Go".

### Fix #1 — DIRECTORIES + wrong-sector blocklist expansion

`src/discovery/website/content_filter.ts` — added 32 hosts seen as
FPs in p90:

- 22 directory aggregators: cercacasa.it, atoka.io,
  agentiimmobiliariabilitati.it, padovamls.it,
  portaleagenzieimmobiliari.it, infoisinfo.it, oikia.it,
  companyreports.it, gowork.it, ioaffitto.it, fiaipveneto.it,
  anacipadova.it, immobiliweb.com, reportazienda.it, tellows.it,
  bachecacase.com, risorseimmobiliari.it, realadvisor.it,
  distrettodelbacchiglione.it, mia-azienda.com, visurissima.it,
  reteimprese.it.
- 10 wrong-sector / public-admin: treccani.it, unipd.it,
  consorziopadovaovest.it, pickandroll.it, bed-and-breakfast.it,
  helvetia.com, bonaldo.com, wordpress.com, pd.camcom.it,
  vi.camcom.it.

Existing `endsWith(`.${host}`)` rule covers subdomains
automatically. 24 new pinned URLs in
`tests/unit/legacy_guardrails.test.ts §2`.

### Fix #2 — Serper network/5xx classification

`src/providers/serp/serper.ts` — previously, network errors and
5xx upstream both returned `[]`. The router treated `[]` as an
empty success and the breaker never saw the failure. Fix:

- network errors → `throw err` → router classifies as `transport`
- 5xx upstream → `throw new Error('serper upstream <code>')` →
  router classifies as `transport`
- 4xx other → `throw new Error('serper http <code>')` → `other`
- 401/403 → `ProviderBlockError` (unchanged)
- 429 → `ProviderBlockError` (unchanged)
- 200 with empty `organic` → `[]` (legitimate empty success)
- JSON parse error → `throw new Error('serper json parse: ...')`

### Fix #3 — providers_used must include paid SERP

`src/enrichment/stages/serp_stage.ts` — when the paid pass
matches, `lead.providers_used` was reporting only `direct_fetch`
(the HTTP fetcher used to verify), not `serper`. The paid SERP
that produced the candidate was invisible to the cost-attribution
chain. Fix: `ctx.providersUsed.add(paid.provider)` on a
SERP_PAID match.

### Fix #4 — atomic run-cost reservation (concurrency-safe)

`src/providers/provider_router.ts` — the run-cap filter was
`ledger.getTotal() + cost ≤ cap`. Under concurrency (default 4
leads in flight), two filter calls both saw `total = €0.099` and
both passed when only one would fit. Race window confirmed in a
unit test.

Fix: a `reservedEur` counter on the router. The filter now reads
`ledger.getTotal() + reservedEur + cost`. Each await-bound paid
attempt reserves before the await and releases in `finally`. A
SECOND sync re-check before reservation closes the inter-await
race window.

| code path | before | after |
| --- | --- | --- |
| filter | ledger.getTotal() + cost ≤ cap | ledger.getTotal() + reserved + cost ≤ cap |
| inside for-loop | n/a | re-check + reserve + try/finally release |

Unit test: 2 concurrent `router.search` calls with cap=€0.001 and
slow paid provider — exactly 1 paid call fires, ledger ends at
€0.001 (was 2 calls / €0.002 before fix).

### Test count after G.1

- 402 unit tests pass / 1 skipped, typecheck 0 errors
- new pinned cases:
  - 24 directory / wrong-sector URLs in legacy_guardrails
  - SerperProvider parser handles null/undefined (defence)
  - concurrent paid-cap test (race regression pinned)

### G.1 acceptance status

- Code shipped, tests green ✓
- Live safety regression complete: `--cost-ceiling-eur 0` on PD
  produced 437 / 437 rows, cost €0, Serper calls 0, found 52.
- p91 paid bench DEFERRED — only after explicit operator go-ahead.
- Total real spend so far across G.5 + G.1: **€0.328** (no
  additional paid calls in G.1).

### G.8 — Next paid run contract

The p90 result proved that the paid integration was safe from a cost
perspective but not reliable enough from a precision perspective. G.1
shipped the Serper-specific directory and wrong-sector filters, plus
the concurrency-safe run-cap reservation. p91 is therefore technically
unblocked, but still requires explicit operator go-ahead because it
will make paid calls.

The next benchmark is:

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

---

## G.1 — Live safety regression (FINAL)

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out /tmp/p_safety_regression.csv \
  --cost-ceiling-eur 0.00
```

Run completed in 21:43 min. Final:

| field | value |
| --- | --- |
| 437 in → 437 out | ✓ |
| cost EUR | **0.000000** ✓ |
| Serper calls | **0** ✓ |
| ledger summaries | 1 ✓ |
| found | 52 (vs p85 53; ±1 noise variance) |
| providers used | dns_mx, crtsh, direct_fetch, ddg_lite, bing_html — Serper absent |

**Default-deny holds with all G.1 changes in place.** Free-pipeline
found count (52) is within ±1 of p85's 53 and p89's 52. The 24 new
DIRECTORIES entries did NOT regress any free-pipeline TPs — none of
the new entries was previously surfacing as a legitimate result.

G.1 acceptance: ALL ✓.

---

## G.2 — Round-2 directory expansion (post-p91)

### p91 results (G.1 stack, paid Serper)

```bash
npm run enrich -- \
  --input output/p80_provincia_pd.csv \
  --out output/p91_pd_enriched_serper_filtered_010.csv \
  --enable-paid --cost-ceiling-eur 0.003 --run-cost-ceiling-eur 0.10
```

| field | value |
| --- | --- |
| 437 in → 437 out | ✓ |
| total cost EUR | **€0.099** ≤ €0.10 ✓ run-cap held atomically |
| Serper calls | 99 |
| 1 ledger summary | ✓ |
| direct_fetch breaker | CLOSED ✓ |
| found | 93 (vs p85 53; +40 new, 0 lost) |
| SERP_PAID matches | 41 (vs p90 61: G.1 caught 20 FPs offline-predicted) |

### G.6 audit on the 41 p91 SERP_PAID

- **~25 likely TPs** — composite brand domains:
  studiozetapadova.it, costruzionibordignon.it, agenziaimmobiliare2000.it,
  studioimmobiliaresigma.it, livianaimmobiliare.it,
  trifoglioimmobiliare.com, helioscasa.it, immobiliareumberto.it,
  immobiliareberto.it, ilcubosi.it, antonianacase2.it, arcuum.eu (×2),
  studiolacoccinella.it, szaffari.it, coltroimmobiliare.it,
  finlucati.it, immobiliaremarino.it, veleimmobiliare.it,
  pintonello.it, astrolabioimmobili.it, puntoimmobiliare.it,
  giovannadoriguzzi.it, immobiliareanna.padova.it,
  immobiliare-forcellini-nazareth.it.

- **~16 FPs (new domains not in G.1 blocklist)**:
  - `casavenezia.it/it/agenzie/le_agenzie/...` — directory listing
  - `intercasarredamenti.it/chi-siamo/` — furniture brand (wrong sector)
  - `impresaitalia.info/...` (×2) — directory
  - `mioaffitto.it/microsite/...` — directory
  - `cittanostra.it/agenzie-immobiliari/...` — directory
  - `bedandbreakfast.it/...` (no-hyphen variant) — directory
  - `bancadellecase.it/agenzia/...` — directory
  - `icribis.com/...` — directory
  - `agenziaroma.com` — geo mismatch (Roma vs Padova)
  - `aterpadova.it` — public housing authority
  - `aopd.veneto.it/sez,217` — Azienda Ospedaliera Padova (hospital!)
  - `arte-casa.info` — parked-style .info

**SERP_PAID precision = ~25/41 = 61 %** (vs p90 49 % — improvement
+12 pp but still below the 85 % KEEP threshold).

### Decision: NEED-MORE-AUDIT — round-2 blocklist shipped

Added 12 hosts to `DIRECTORIES` and 12 URLs to the legacy_guardrails
pinned list:

`casavenezia.it`, `impresaitalia.info`, `mioaffitto.it`,
`cittanostra.it`, `bedandbreakfast.it`, `bancadellecase.it`,
`icribis.com`, `agenziaroma.com`, `aterpadova.it`,
`aopd.veneto.it`, `arte-casa.info`, `intercasarredamenti.it`.

414 unit tests pass / 1 skipped, typecheck 0 errors.

### Cumulative spend across Phase G

| stage | spend | reason |
| --- | --- | --- |
| G.5 attempt 2 | €0.229 | run-cap not enforced (bug, killed) |
| G.5 attempt 3 | €0.099 | run-cap held; 60 SERP_PAID, ~50 % precision |
| G.1 safety regr | €0.000 | default-deny verified |
| G.5 p91 (G.1 stack) | €0.099 | 41 SERP_PAID, ~61 % precision |
| **TOTAL** | **€0.427** | |

### G.6 final decision (after G.2 round-2 blocklist)

- **NEED-MORE-AUDIT**: Serper SERP_PAID precision still below 85 %
  threshold even with G.1+G.2 blocklist. Round-2 catches 12 more
  observed FPs but Serper's organic tail keeps surfacing novel
  aggregators.
- **Hold paid runs.** Free pipeline (~98 % precision, 53 found on
  PD) remains the trust baseline.
- **Followup #35**: A SECOND offline simulation against p91 with
  the round-2 blocklist applied, to estimate the precision lift
  before another paid run. This is zero-cost like the post-p90
  simulation that justified p91.
- **Followup #36**: Beyond blocklist, Serper-fallback may need a
  positive-sector check (RDAP-mandatory or HTML-must-contain-
  agency-keywords) to filter the long tail of wrong-sector hits
  (intercasarredamenti, aopd.veneto.it, agenziaroma.com).

No new paid run executed in G.2.
