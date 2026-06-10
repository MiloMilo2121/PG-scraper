# pg4 → Dynamic Company-Intelligence Platform — Master Blueprint

*Architecture · persistence · API · per-field cost engine · risk/scale ·
compliance · open decisions. Code-grounded against the repo at branch
`pg4/phase-4.4-structure-cleanup` @ `505c4f1`, 2026-06-11.*

Tags: **MEASURED** (ran it) · **READ** (from code/prior reports) · **ASSUMED**
(judgment, flagged). Companion docs: `production_roadmap.md` (phases),
`frontend_spec.md` (UI), `EXECUTIVE_BRIEF.md` (2-page summary),
`measurement_evidence/` (the free-gold numbers).

---

## Part I — Verified ground truth (the constraints)

| Finding | Tag | Shapes the design |
|---|---|---|
| **Free-gold seam is REAL.** `direct_fetch` returns `HttpFetchResult.html` populated on success (`direct_fetch.ts:37-46`); the body surfaces as `VerifyVerdict.body` at `verify_candidates.ts:257` (piva_match) + `:272` (phone_match), consumed by `serp_stage.ts:221` for the paid-gate, then discarded. **Correction (Plan-agent code-read): body is set on the 2 STRONG matches only, NOT the 2 semantic returns (294-312).** | MEASURED | Phase 1 mines the body for email/social/VAT/phone at €0. Governs the cost model. Phase 2 widens body capture to semantic matches. |
| **Engine ~80% library-clean.** `runEnrichmentPipeline` (`enrichment_pipeline.ts:64`) is already pure; CLI coupling = 5 files. `enrichLead(lead,opts)` extractable ~2-3h. `src/index.ts` export-ready. | READ | Wrap the engine, never rewrite. 719 tests stay green. |
| **One hardwired waterfall.** 6 stages (Input→PgDetail→HyperGuesser→Serp[free→paid]→Rdap→Financial), `tierCapForLead` (run_context.ts:93), stop-at-success (pipeline:141), per-lead+run ceilings (provider_router.ts:294-319). `serp_stage.runPaidPass` (165-199) = template for per-field. | READ | Generalize to one waterfall PER FIELD: field/cascade/ceiling/cache become **data**. |
| **3 dead providers.** `dns_mx`+`crtsh` = 0/12,728 successes (`available(){return true}`); `ddg_lite` = ad-junk. | MEASURED | Gate-0 BLOCKER. NOTE: deletion deferred from Phase 1 — entangled with 6 test files (`dns_mx.test.ts`, `crtsh.test.ts`, `provider_policy.test.ts`, `serp_stage_category_routing.test.ts`, `serp_providers_smoke.test.ts`, `circuit_breaker.test.ts`); it's an M refactor, not a cheap win. Do it in the dedicated Gate-0. |
| **Dedup leak ~3-4%.** writer exists (`scrape_pipeline.ts:362`), trigger too narrow (`deduper.ts:77`) → never fires. | MEASURED | Gate-0: widen trigger + test. Becomes a `dedup_review` row. |
| **Financial = checksum-only no-op.** `vies.ts`/`fatturato_italia_parser.ts`/`revenue_parser.ts` exist, **pure, unwired**. | READ | Phase 3 (moat). VAT-as-master-key. |
| **Cost ceilings verified by-READ-not-spend.** | READ | Gate-0: one live €0.10-capped run. |
| **Maps 6× non-determinism** (15 vs 92, 71.5% overlap; PG stable). | MEASURED | UI shows "≥ N" + multi-run union (Q11). |
| **BL/VR/TV paid precision asserted, not tabled** (`paid_evidence_gate.ts:8-12`). | READ | `field_evidence` IS the audit table (Q4). |
| **Persistence = filesystem JSONL.** `cost_ledger.ts`, `run_record.ts` (`_runs.jsonl`), `Lead` schema (RAW 21/ENRICHED 41 cols after v2, append-only). `output_lock.ts` = PID file lock. | READ | → Supabase; file lock → `FOR UPDATE SKIP LOCKED`. |

---

## Part II — Target architecture (control-plane over the validated engine)

```
FRONTEND (Next.js 15, Vercel)        ── ADDS all (intent input + live dashboard)
   │  HTTPS/JSON + Supabase Realtime
API LAYER (Next.js route handlers)   ── REUSES Lead/enum types as the wire contract; ADDS HTTP+Zod+RLS client
   │
PERSISTENCE (Supabase Postgres, eu-central-1, RLS)  ── REUSES column taxonomy + ledger/run shapes; ADDS tables+RLS
   │
ORCHESTRATOR (n8n schedule + Node worker pool)  ── REUSES Backpressure+RateLimiter+CircuitBreaker+CostLedger; ADDS lease queue, DB-advisory ceiling, per-field dispatcher
   │  invoke enrichLead()
ENGINE (@pg/engine = wrapped pg4)    ── REUSES runEnrichmentPipeline, ProviderRouter, all stages, gates, vat/vies, deduper, extract_from_body; ADDS enrichLead adapter + ledger sink
   │
PROVIDERS  ── REUSES direct_fetch, bing_html, serper, vies; ADDS registry/PEC + page-extractor; REMOVES dns_mx/crtsh
```

Per layer, REUSES vs ADDS is explicit so the build respects the validated core.

### Persistence — Postgres schema (Supabase)

Append-only-CSV → one `companies` row per (tenant, company) + append-only
`field_evidence` and `cost_ledger` children. The CSV "fill-only-missing,
first-source-wins" merge (`deduper.ts:103`) becomes "UPSERT a company column
only if currently NULL or lower-confidence."

```
tenants(id, name, plan, created_at)
users(id = supabase auth.uid, email)
memberships(tenant_id, user_id, role, pk(tenant_id,user_id))   -- RLS join

companies(
  id, tenant_id,
  <every RAW_CSV_COLUMNS + ENRICHED_CSV_COLUMNS verbatim, incl. v2 instagram/facebook/linkedin>,
  schema_version int default 2, dedup_key text, created_at, updated_at,
  UNIQUE(tenant_id, dedup_key)
)
field_evidence(   -- the append-only spine = the Q4 precision-audit table
  id, tenant_id, company_id, field, value, source, discovery_method,
  confidence numeric, cost_eur numeric, run_id, job_item_id,
  evidence_blob jsonb, created_at,         -- NEVER updated
  UNIQUE(company_id, field, source, run_id)  -- idempotent re-runs
)
enrichment_jobs(id, tenant_id, created_by, selection jsonb, fields text[],
  paid_enabled, per_item_cost_ceiling_eur, run_cost_ceiling_eur, status,
  total_cost_eur, created_at)
job_items(id, tenant_id, job_id, company_id, fields text[], status,
  lease_owner, lease_until, attempts, cost_eur, result jsonb, error)
runs(...)         -- migrates _runs.jsonl 1:1 (run_record.ts:28-53)
cost_ledger(...)  -- migrates *.cost-ledger.jsonl 1:1 (cost_ledger.ts:5-15)
suppression(id, tenant_id, phone_key, vat_key, reason, source, created_at)
audit_events(id, tenant_id, kind, subject jsonb, actor, ts)  -- Art.30/14/LIA
```

- **RLS** on every table: `USING (tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid()))`. Workers use the service-role key but MUST set `tenant_id` on every write (+ CHECK it matches the parent job).
- **dedup_key**: port `phoneKey`/`nameCityKey`/`nameAddrKey` (`deduper.ts:124-196`) to an Edge/SQL fn; alias keys → `company_dedup_aliases` so the find-existing path is one indexed query.
- **`_runs.jsonl` migration**: `readRunHistory()` already parses (skips malformed) → one-shot loader.

### API surface (tenant-scoped, RLS-filtered)

```
POST /api/companies/import   {rows: Lead[]}            → {imported, deduped, ids[]}
POST /api/jobs               {selection, fields[], paid_enabled,
                              per_item_ceiling, run_ceiling}  → {job_id, estimated_cost_eur}
GET  /api/jobs/:id/stream    SSE/Realtime: {company_id, field, value, source, confidence, cost_eur, status}
GET  /api/jobs/:id/cost      → mirrors CostLedger.getSummary()
GET  /api/companies/:id/evidence  → per-field provenance (Q4)
POST /api/suppression  ·  POST /api/retention/policy
```

Request/response use the engine's exported `Lead` / `ReasonCode` /
`LeadStatus` / `DiscoveryMethod` — API and engine share one contract.

### Orchestrator

- **Queue** = `job_items`; worker claims via `UPDATE … FOR UPDATE SKIP LOCKED`. The PID file-lock (`output_lock.ts`) → this lease (multi-host).
- **Per-field dispatcher** generalizes `serp_stage.runPaidPass`: per requested field, free→paid ladder, stop at first strong evidence, each step a `ProviderRouter` call with `meta={tenant_id, job_item_id, field}` (CostLedger/CircuitBreaker/RateLimiter keep working).
- **Cross-worker run ceiling** = DB advisory lock + `SUM(cost_eur)` check wrapping each paid call; in-process `reservedEur` (provider_router.ts:99-154) stays as inner guard.
- **Per-field rate limit** = extend RateLimiter keys to `provider:field`. **Retry** on transient `FailureKind` (provider_router.ts classification).

---

## Part III — Per-field waterfall framework (the cost engine)

See `production_roadmap.md` Phase 4 for the build. Core abstraction:

```
EnrichmentField { field, cascade: Step[], ceiling_eur, stop(r), cache_key(lead) }
EnrichmentStep  { id, tier:0|1|2, run(ctx,lead)->StepResult, enabled?(cfg) }
```

The per-field runner is the `enrichment_pipeline.ts:129-158` loop lifted into
`runFieldCascade(field, ctx, lead)` — **zero engine rewrite**. `paidEnabled`
still globally vetoes any tier-2 step (born free-first and safe).

**6 cost principles → mechanisms:** (a) waterfall-per-field = `FIELD_REGISTRY`;
(b) parse-already-fetched-page = `extractFromBody` tier-0 (**shipped, Phase 1**);
(c) VAT-as-master-key = resolve `vat_code_final` first → keys PEC (INI-PEC by
P.IVA), revenue (fatturatoitalia by P.IVA), VIES firmographics; (d) per-field
ceilings = `ceiling_eur` + `ledger.costForField` (new `meta.field` tag);
(e) cross-run cache = **NET-NEW** Supabase `enrichment_cache(cache_key PK,
value, confidence, fetched_at)` behind the existing `Cache` interface
(`MemoryCache` is per-process 30-min only — NOT cross-run today); (f)
verify-at-point-of-use = each cascade's terminal step is a validator
(checksum/VIES/MX), not a fetch.

**Field cascades (free unless noted):**

| field | cascade | free? | note |
|---|---|---|---|
| `vat_code_final` | T0 checksum + body-scan + T1 VIES-harden (0.6→0.9, yields name/address) | yes | master key |
| `email` | T0 mailto/same-domain → T1 MX-verified guess → T2 finder API | mostly | reject 3rd-party/directory |
| `pec` | T0 body → **T1 INI-PEC by P.IVA** | yes | near-100% IT coverage (legally mandatory) |
| `revenue`+`employees` | T1 fatturatoitalia by P.IVA (one fetch fills both) | yes | VAT-gated; parser exists |
| `instagram/facebook/linkedin` | T0 footer href scan | **free if website** | structurally expensive without one — don't build T2 |
| `decision_maker` | T0 chi-siamo minority → T2 people-finder | **paid** | honestly needs paid APIs |
| `phone_validation` | T0 E.164 + on-site corroboration | yes | phone-match signal already computed |
| `email_deliverability` | T1 MX via existing DnsMx | mostly | PEC always deliverable (short-circuit) |

**FREE by page-parse:** email, socials, VAT-footer, phones, on-site PEC.
**FREE but VAT-gated:** INI-PEC, revenue, employees, VIES. **Structurally
PAID:** decision_maker (beyond minority), social/email without a website, HLR.

---

## Part V — Risk, scale & the hard parts

- **Cost at scale** (highest): thousands of leads × multiple paid fields = real money + rate-limit exposure. Contained by per-field ceilings + the cross-worker DB-advisory run ceiling + the cross-run cache (P.IVA→PEC never changes — cache forever). **Worst-case model:** 10k leads × 3 paid fields × €0.01 = €300/run; the run ceiling caps it deterministically; the cache collapses repeat runs toward €0.
- **Maps non-determinism at product scale**: a count that swings 6× is not a census. The UI shows "≥ N" with the variance band and offers multi-run union (scrape N times, dedupe-merge — the deduper already merges). The architecture makes it honest, not hidden.
- **The dead-provider silent-failure class**: the provider-health panel surfaces any provider at 0% success; the system is self-reporting so this class can't recur silently (the meta-lesson of all 3 prior passes).
- **Multi-tenant isolation**: RLS on every table + a per-table "tenant A cannot read tenant B" test (Gate C) before the 2nd customer. A single missing policy leaks another client's leads.
- **Honestly hard / expensive / may-not-work**: Instagram-without-website (no reliable free name→handle path; paid is noisy); paywalled registry firmographics; IP-ban exposure scraping at volume (the existing RateLimiter + per-provider buckets mitigate, don't eliminate); VIES flakiness (breaker already configured for it).

---

## Part VII — Compliance & claims track (threaded through the roadmap)

| Item | What | Build vs Operator/Legal |
|---|---|---|
| **RPO (Italian telemarketing)** | calling (incl. cell + ditte individuali) needs Registro Pubblico Opposizioni check → feed `suppression` | Build: RPO-import → rows. Legal: RPO access + scope |
| **Email → GDPR profile shift** | email-by-inference = personal data; needs LIA + Art.14 notice. **COMPLIANCE GATE A blocks the per-field email phase going live** | Build: notice trigger + email-key suppression + retention activation. Legal: author LIA + lawful basis |
| **Precision audit (Q4)** | `field_evidence` IS the table; populate from every paid call; tabulation query | Build: query. Operator: verify before marketing precision |
| **Claims discipline** | no "industry-leading"/fabricated numbers; every claim traces to a `field_evidence` query | Operator: gate marketing copy on the audit table |
| **Retention** | `retention.ts` exists, default OFF; SaaS sets per-tenant window + scheduled sweep | Build: policy + sweep. Legal: choose window |

---

## Part VIII — Open decisions (ranked, recommended default)

1. **Cross-worker cost ceiling** (money): DB advisory lock + ledger SUM, in-process `reservedEur` inner guard. Before the orchestrator phase.
2. **Auth**: Supabase Auth (you run Supabase; RLS via `auth.uid()`).
3. **Worker runtime**: dedicated Node pool (Playwright-capable, long jobs) leased via Postgres; n8n for scheduling only (Edge timeouts fight long jobs).
4. **Registry/PEC source + ToS** (legal): official/licensed (INI-PEC, registroimprese API) over scraping; gates the official-data phase go-live.
5. **Lawful basis for email** (legal): legitimate-interest + LIA + Art.14; gates the email phase.
6. **Retention window**: configurable, conservative default (e.g. 180d).
7. **Billing model**: per-field credits backed by `cost_ledger` actuals.
8. **Maps non-determinism (Q11)**: accept + document; `cap_likely` geo-grid split, not scrape-determinism chasing.
9. **Keep `ddg_lite`?** Disable by default (ad-junk), keep behind a per-category flag (router already supports `excludeProviderIds`).

These mirror + extend the 8 standing operator decisions from the prior
readiness/discovery passes; nothing here silently assumes a SaaS-vs-personal
answer (that fork is resolved to **SaaS** by operator decision this session).
