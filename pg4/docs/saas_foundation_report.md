# SaaS Foundation — Build Report

*What was built this pass, per phase, with commit refs · REUSES vs ADDS · the
multi-tenant isolation proof · what is deliberately LEFT IN NEUTRAL and exactly
how to activate it. 2026-06-11. Branch `pg4/phase-4.4-structure-cleanup`.*

**Mandate:** "SaaS-architected, not production-live." Build the complete machine,
leave the production-only pieces disabled-but-documented. Decision recorded: DB
as migrations + sink (no live cloud DB); API + frontend handled as control-plane
+ spec (frontend is a separate app, not scaffolded as mock UI); the one €0.02
live spend awaits a key.

## Result at a glance

| | |
|---|---|
| Tests | **780 pass**, 1 skip (was 736 at pass start) |
| typecheck / lint | clean |
| € spent | **€0** (the one €0.02 live test is pending a SERPER_API_KEY) |
| Live DB / server / Stripe / deploy | none — by design |
| Commits | Gate-0 `8d5b9b3` · persistence `f6b6156` · API `2452d61` · per-field `8feab3a` · this report (pending) |

---

## Phase A — Gate-0 hardening (`8d5b9b3`)

The deferred hardening, closed first because on a paid-capable multi-tenant
product the silent-dead-provider class is a prerequisite, not a nice-to-have.

| Item | REUSES | ADDS |
|---|---|---|
| **Provider-health detector** | `CostLedger.getByProvider()` | `runtime/provider_health.ts` — any provider ≥10 calls + 0% success → run-summary warning + `provider_dead` on the run record + a notifier event. The dns_mx/crtsh class can never hide again. |
| **Dead-provider removal** | — | Deleted `dns_mx` + `crtsh` (0/12,728 each); updated 6 entangled test files; `ddg_lite` kept, gated. |
| **Dedup hardening** | the `Deduplicator` | legal-form canonicalization (`S.r.l.`≡`SRL`, but `SRL`≠`SPA`) + shared-registrable-host review trigger, franchise-safe. Closes the ~3-4% same-entity leak. |
| **Money-guard invariant** | the router reservation logic | a deterministic test: the ledger NEVER crosses the run ceiling across 50 paid calls (€0). |
| **Forced preflight failure** | `runScrapePreflight` | a test that forces a 0-match selector → `PreflightError` + exit 3 + actionable message. |

## Phase B — Multi-tenant persistence (`f6b6156`)

The irreversible architectural decision — multi-tenant from table #1 — built +
tested without provisioning a live DB.

| Component | REUSES | ADDS |
|---|---|---|
| `db/migrations/0001_multitenant_init.sql` | the lead column taxonomy + RunRecord/LedgerEntry shapes | 12 tables, `tenant_id` on every domain row, RLS enabled + FORCED on each, the `tenant_isolation` policy. |
| `persistence/dedup_key.ts` | the deduper's key builders (now exported) | the canonical `dedup_key` + alias keys for `UNIQUE(tenant_id, dedup_key)` — same source as the scraper, cannot drift. |
| `persistence/tenant_db.ts` | — | `TenantDb` interface + `COMPANY_VALUE_COLUMNS` (explicit, matches the migration) + `leadToCompanyRow`. |
| `in_memory_tenant_db.ts` | — | working dev/test backend; isolation is STRUCTURAL. |
| `tenant_lead_sink.ts` / `lead_sink.ts` | the existing CSV writer (unchanged) | the sink seam; a sink is bound to ONE tenant. |
| `pg_tenant_db.ts` | — | production adapter over a `SqlExecutor` seam (real fill-only-missing UPSERT). Unwired — no supabase dep this pass. |
| `enrichment_cache.ts` | the `Cache` shape | cross-run, tenant-scoped cache for the cost lever. |

## Phase C — Tenant-scoped API control plane (`2452d61`)

| Component | REUSES | ADDS |
|---|---|---|
| `api/types.ts` + `api/control_plane.ts` | the engine types + `TenantDb` | framework-agnostic handlers: import, create-enrich-job, create-scrape-job, status, cost, suppression — all scoped to `ctx.tenantId`, writes require non-viewer. A Next.js route handler becomes a thin adapter. |

## Phase D — Per-field waterfall framework (`8feab3a`)

| Component | REUSES | ADDS |
|---|---|---|
| `enrichment/fields/*` | the Phase-1 free-gold `extractFromBody`; the pipeline loop shape; `CostLedger` | the `FIELD_REGISTRY` (one free→paid cascade per field) + `runFieldCascade` runner with the triple gate. Free tiers LIVE (€0), paid/registry tiers WIRED BUT DISABLED. |

## Phase F — Compliance mechanics (docs)

`docs/gdpr/`: `PRODUCTION_ACTIVATION_CHECKLIST.md` (the gate), `LIA_template.md`,
`art14_notice_template.md`, `processor_posture.md`. Mechanics built (suppression,
retention, audit, Art.21→suppress loop); legal basis NOT flipped.

---

## The multi-tenant isolation proof

Isolation is the one thing expensive to retrofit, so it is proven at two layers:

1. **App layer (tested now, €0):** `tests/unit/persistence_tenant_isolation.test.ts`
   + `api_tenant_scoping.test.ts` — tenant A's writes are never visible to B;
   the same lead under two tenants makes two rows; a job created by A is 404 to
   B (status + cost); cross-tenant company ids are 404 (no existence leak); every
   sink/handler is bound to a tenant id with no cross-tenant path.
2. **DB layer (proof deferred to a live DB):** RLS enabled + FORCED on every
   tenant table in migration 0001. The cross-tenant `select` leakage test
   (checklist 1.4 / Gate C) is the one isolation assertion that needs a real
   Postgres — it runs at activation, before a second customer.

## What is LEFT IN NEUTRAL — and how to activate each

| In neutral | Why | Activate via |
|---|---|---|
| Live database | "no live DB" decision | Checklist §1 — apply migration, wire `SqlExecutor`, run the live leakage test. |
| Paid providers | free-first; one €0.02 test only | Checklist §2 — provide the key, run the €0.02 test (below), flip `enabled`. |
| Official-data tiers (INI-PEC/VIES/fatturatoitalia) | Phase 3 | Wire the provider + flip the disabled step in `field_registry.ts`. |
| Billing | schema present, no Stripe | Checklist §3 — Stripe metered on `cost_ledger`→`usage`. |
| Legal basis (email outreach) | Gate A | Checklist §0 — signed LIA + Art.14 notice. |
| Frontend + deploy | separate app | `docs/frontend_spec.md` + checklist §4. |

## A4 — the one live spend (€0.02), pending a key

The money-guard is proven deterministically (`cost_ceiling_invariant.test.ts`,
€0). The end-to-end LIVE proof — the only real spend this pass — needs a real
`SERPER_API_KEY`. When provided (in `.env`, never in chat), run:

```bash
# ~30 leads, hard €0.02 run ceiling, paid enabled
SERPER_ENABLED=true SERPER_API_KEY=<key> \
  pnpm run enrich -- \
  --input <small_30_lead.csv> \
  --out output/ceiling_live_check.csv \
  --enable-paid \
  --run-cost-ceiling-eur 0.02
# PASS = ledger total ≤ €0.02 AND the latched run_cost_ceiling_hit fired
sqlite_or_jq output/ceiling_live_check.cost-ledger.jsonl   # inspect total
```

Expected: the run halts paid calls at the cap; `output/ceiling_live_check.cost-ledger.jsonl`
total never exceeds €0.02; the notifier emits `run_cost_ceiling_hit` once.

## Definition of Done — status

- [x] Gate-0 closed; silent-dead-provider class now self-reporting
- [x] Multi-tenant schema, `tenant_id` on every domain row, isolation tested (app layer; DB-layer RLS test at activation)
- [x] Engine persists via a sink (CSV unchanged, core intact) — sink seam + Pg adapter
- [x] Audit trail (`_runs.jsonl`) mapped to the `runs` table (loader at activation)
- [x] API: enrich-field-on-selection + status, all tenant-scoped
- [x] Per-field waterfall: free tiers live, paid wired-but-disabled
- [x] Compliance mechanics built; PRODUCTION ACTIVATION CHECKLIST written
- [x] 780 tests pass; €0 spent (the €0.02 test pends a key)
- [x] This report: REUSES-vs-ADDS, isolation proof, what's-in-neutral + activation
- [ ] Reactive frontend wired to real API + dev tenant — deferred (separate app; spec ready)
- [ ] Live €0.02 ceiling test — pends `SERPER_API_KEY`
