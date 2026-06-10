# pg4 → Platform — Production Roadmap

*The phased, dependency-ordered, gated build plan. Effort grounded in real
code. Companion to `platform_blueprint.md`. 2026-06-11.*

Effort scale: **S** ≤1d · **M** ~2-5d · **L** ~1-2wk · **XL** ongoing. Every
phase: Goal · In-scope · Non-scope · Deps · Effort · Risk · DoD · Unblocks.

---

## GATE 0 — Hardening & merge  *(must precede any paid-at-scale)*
- **Goal:** make the engine trustworthy and merge the branch before money flows.
- **In-scope:** (Q1) delete `dns_mx.ts`+`crtsh.ts`, drop from `provider_catalog.ts:28-35`, update the 6 referencing test files (`dns_mx.test.ts`, `crtsh.test.ts`, `provider_policy.test.ts`, `serp_stage_category_routing.test.ts`, `serp_providers_smoke.test.ts`, `circuit_breaker.test.ts`); demote `ddg_lite`. (Q3) widen the dedup near-dup trigger (`deduper.ts:77`) so `.dedup-review.jsonl` fires + a test that proves it. (Q5) **one live €0.10-capped paid run** (`SERPER_ENABLED=true` + `--enable-paid` + `--run-cost-ceiling-eur 0.10`), assert ledger ≤ ceiling + the latched `run_cost_ceiling_hit` fired. Merge `pg4/phase-4.4-structure-cleanup` → main.
- **Non-scope:** any new field, persistence, UI.
- **Deps:** none.
- **Effort: M.** Provider deletion is M (not the "S cheap win" Phase 1 assumed — 6 test files entangle it; this is WHY it was deferred out of the free-gold build). Dedup widening S-M. Live-spend test M. Merge S.
- **Risk:** Medium — first real money moves (cap hard); deleting providers breaks asserting tests (update them).
- **DoD:** suite green; dead providers gone; dedup-review fires on a fixture; one billed run proves the ceiling to the cent; branch merged.
- **Unblocks:** everything paid-at-scale.

## PHASE 1 — Free-gold page extraction  ✅ BUILT THIS PASS
- **Goal:** mine the already-fetched website body for email/PEC/social/VAT at €0.
- **Shipped:** `src/enrichment/extract/extract_from_body.ts` (pure) + `apply_free_gold.ts`; `PerLeadContext.verifiedBody` set at the 4 strong-match seam sites (`input_website_stage.ts`, `pg_detail_stage.ts`, `serp_stage.ts` free+paid); one hook in `enrichment_pipeline.ts` beside FinancialStage; schema v2 (`instagram/facebook/linkedin`, `SCHEMA_VERSION=2`, append-only); `src/scripts/probe_free_gold.ts`; 17 new tests + 5 fixtures; the 4 schema-contract tests updated to v2.
- **DoD (met):** typecheck + 736 tests green; pipeline test proves `cost_eur` unchanged at 0; probe reports hit-rates (`docs/measurement_evidence/`).
- **Unblocks:** the value proposition for every later field; the LIA/GDPR track (email enrichment now exists).
- **Note:** Gate-0 provider deletion was deferred OUT of this phase (entanglement above); the free-gold extractor spends nothing, so it didn't need Gate-0's cost-ceiling test.

## PHASE 2 — Engine-library `enrichLead`
- **Goal:** `enrichLead(lead, opts) → EnrichmentResult`, no CLI/filesystem coupling.
- **In-scope:** adapter wrapping `runEnrichmentPipeline` from opts (port construction out of `enrich_command.ts:64-110`); `CostLedger` sink callback (today in-memory + JSONL only, `cost_ledger.ts:178-186`); publish `@pg/engine`; widen `verify_candidates.ts` body capture to semantic matches (the Phase-1 deferral).
- **Deps:** Gate 0.  **Effort: S-M** (core 2-3h + packaging).  **Risk:** Low.
- **DoD:** callable from a fresh process, mock-HTTP smoke green (`cli/mock_http.ts` exists), CLI still works.
- **Unblocks:** orchestrator, per-field framework, all server-side use.

## [COMPLIANCE GATE A] — before email enrichment reaches a real subject
LIA + Art.14 notice + suppression on email fields. Legal sign-off. Blocks
Phase 4's email cascade going live (not the build, the go-live).

## PHASE 3 — Official-data spine (the moat)
- **Goal:** wire VIES + Italian registry/PEC; VAT/PEC/revenue from authoritative sources.
- **In-scope:** wire `vies.ts` into `FinancialStage` (today disabled, `financial_stage.ts:46`); add INI-PEC + registroimprese + fatturatoitalia providers feeding the existing pure parsers (`fatturato_italia_parser.ts`, `revenue_parser.ts`); confidence 0.6→0.9; every value → `field_evidence`.
- **Deps:** Phase 2, Gate 0.  **Effort: L** (VIES M; registry/PEC providers L — new auth/rate-limits).  **Risk:** Med-High (VIES flaky — breaker configured; registry ToS — operator/legal).
- **DoD:** VAT VIES-validated with provenance; PEC from official source; revenue parsed with source+confidence.
- **Unblocks:** real Q4 precision audit; premium paid tier.

## PHASE 4 — Per-field waterfall framework
- **Goal:** generalize the website ladder into a configurable per-field free→paid waterfall.
- **In-scope:** refactor the fixed `stages` array (`enrichment_pipeline.ts:118-124`) into `FIELD_REGISTRY`; reuse `runPaidPass` semantics; per-field budget = slice of `costCeilingEur` via `ledger.costForField` (new `meta.field` tag); the NET-NEW cross-run cache (`SupabaseCache implements Cache`).
- **Deps:** Phases 2+3.  **Effort: M-L.**  **Risk:** Med (per-field budget math must not double-spend; reuse `costForLead`/`reservedEur`).
- **DoD:** "enrich only `pec` on these 100 companies" runs, touches only PEC providers, respects a per-field ceiling.
- **Unblocks:** the API's "enrich field X on selection Y" verb, granular billing.

## PHASE 5 — Persistence (Supabase)
- **Goal:** system-of-record from filesystem → Postgres.
- **In-scope:** the schema (`platform_blueprint.md` Part II); port dedup-key (`deduper.ts:124-196`); sink `CostLedger` → `cost_ledger`; migrate `_runs.jsonl`→`runs`, `suppression.csv`→`suppression`; `field_evidence` append-only.
- **Deps:** Phase 2 (structured results), Phase 4 (fields).  **Effort: L.**  **Risk:** Med (dedup-key uniqueness must match the deduper or split/merge companies — test against a known CSV).
- **DoD:** a run writes companies+evidence+ledger; `_runs.jsonl` history loaded; reads match the old CSV.

## PHASE 6 — API layer
- **In-scope:** Next.js route handlers (`platform_blueprint.md` API surface); Zod schemas on the exported types; SSE/Supabase Realtime.  **Deps:** Phase 5.  **Effort: M-L.**  **DoD:** create a job, watch results stream, read live cost.

## PHASE 7 — Orchestrator  **[GATE B: cross-worker ceiling proven with real spend]**
- **In-scope:** `job_items` lease queue (`FOR UPDATE SKIP LOCKED`); per-field dispatcher calling `enrichLead`; DB-advisory run ceiling replacing `output_lock.ts`; retry/backoff on `FailureKind`; `Backpressure`/`RateLimiter`/`CircuitBreaker` per worker; n8n scheduling.
- **Deps:** 4,5,6.  **Effort: L.**  **Risk: High** — the cross-worker ceiling is the single highest-risk component (money). Build the Gate-0 live-spend test into a multi-worker version here.
- **DoD:** N workers drain a job concurrently, never exceed the ceiling (proven with real spend), survive a worker crash (lease re-claim).

## PHASE 8 — Frontend
- **In-scope:** the full UI (`frontend_spec.md`): list/upload, job composer + field-selector + cost estimate, live result stream, cost meter, evidence drill-down, suppression management. Next.js 15 + Tailwind 4 + shadcn + TanStack Query.  **Deps:** 6 (+7 for live).  **Effort: L.**  **DoD:** a user runs a job end-to-end from the browser, downloads results.

## PHASE 9 — Multi-tenant / Auth  **[GATE C: per-table cross-tenant leakage test before 2nd customer]**
- **In-scope:** Supabase Auth + `memberships`; RLS on every table; service-role workers set `tenant_id` + CHECK; per-tenant suppression/retention.  **Deps:** 5-8.  **Effort: M-L.**  **Risk: High** — one missing RLS policy leaks a client's leads.  **DoD:** automated "tenant A cannot read B" test per table passes.

## PHASE 10 — Billing
- **In-scope:** plans/quotas on `tenants`; Stripe metered keyed to `cost_ledger` aggregates; plan-limit enforcement in the API; usage view.  **Deps:** Phase 9.  **Effort: M-L.**  **DoD:** a tenant is billed for actual spend + margin; over-quota jobs rejected.

## PHASE 11 — Scale / observability
- **In-scope:** worker autoscaling, provider key pooling/rotation, per-tenant rate-limit fairness, cost/yield dashboards from `runs`/`cost_ledger`, archival/retention sweeps.  **Effort: XL, ongoing.**

---

## Linear build sequence (gates marked)
1. **[GATE 0]** dead providers + dedup fix + live €-ceiling test + merge.
2. Phase 1 free-gold ✅ (done) → 3. `enrichLead` extraction.
4. **[GATE A]** LIA/Art.14 before email goes live.
5. Official-data spine → 6. per-field framework → 7. Supabase → 8. API.
9. Orchestrator **[GATE B: cross-worker ceiling proven]** → 10. Frontend.
11. Multi-tenant **[GATE C: cross-tenant test]** → 12. Billing → 13. Scale.

---

## Open-decisions ledger (ranked)
1. Cross-worker cost ceiling (money) — *DB advisory lock + ledger SUM + in-process guard.*
2. Auth — *Supabase Auth.*
3. Worker runtime — *dedicated Node pool leased via Postgres; n8n schedule only.*
4. Registry/PEC source + ToS (legal) — *official/licensed; gates Phase 3 go-live.*
5. Lawful basis for email (legal) — *LIA + Art.14; gates Gate A.*
6. Retention window — *configurable, 180d default.*
7. Billing model — *per-field credits on `cost_ledger` actuals.*
8. Maps non-determinism — *accept + document; cap_likely geo-grid split.*
9. `ddg_lite` — *disable default, per-category flag.*
10. Next validated categories — *operator picks before the category-pack work.*
