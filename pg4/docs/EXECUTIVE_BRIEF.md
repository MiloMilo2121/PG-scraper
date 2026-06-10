# pg4 → Company-Intelligence Platform — Executive Brief

*2 pages. The thing to read first. Written 2026-06-11.*

## What pg4 is today

A validated CLI engine that turns `{category, geo}` into a CSV of Italian
companies. Three hardening/audit passes this session proved (MEASURED) that
its **safety machinery is real** — loud failures, cost ceilings, output lock,
checkpoint/resume, GDPR suppression + retention, 719 passing tests. But the
**product is thin**: only `phone` (92–99%) and `official_website` (21–44%) are
populated; `email`, `pec`, `revenue`, `employees`, `decision_maker`,
`vat_code_final` are all **0.00%**. It is a 2-column scraper with an
unusually trustworthy engine underneath.

## What it becomes

A web app where a non-technical operator types an intent ("all companies of
type X in area Y"), and the system autonomously scrapes + enriches **per
field, free-first, in a waterfall**, streaming results into a live dashboard
with per-field "enrich this" buttons, fill-rate metrics, a cost meter, and
per-cell evidence. Output is a rich company-intelligence record, not a CSV.
Decision (locked): build it as a **sellable multi-tenant SaaS**.

## The one idea that governs the economics

**Free-gold.** pg4 already HTTP-fetches a company's own website to verify it,
then throws the page away. That page contains email, PEC, social links, and
the P.IVA — all extractable at **€0 marginal cost** (the fetch already
happened). Phase 1 (built this pass) mines it. This is the difference between
"pay an API per field" and "parse what we already have, pay only for what the
page doesn't give us." Every later field cascade is free-first for the same
reason.

> **Free-gold thesis, MEASURED this pass:** see
> `docs/measurement_evidence/` — the probe re-ran the extractor over real PD
> company sites and reports email / social / VAT hit-rates at €0.

## The moat (why a US tool can't clone it)

Italian official data, keyed by P.IVA: **VAT → PEC** (INI-PEC, legally
mandatory + registry-published, near-100% coverage), **VAT → revenue/
employees** (fatturatoitalia parser already exists, pure, just needs a
fetcher), **VAT → firmographics** (VIES already wired-but-disabled). "VAT as
master key" turns one validated number into a full record from authoritative
sources. This is structural, local, and hard to replicate.

## The 3–5 decisions that gate everything

1. **Cross-worker cost ceiling** (money, highest risk). The in-process
   reservation logic exists; the multi-worker version is a DB advisory lock +
   ledger SUM. Decide before the orchestrator phase. *Default: DB lock +
   in-process guard as defence-in-depth.*
2. **Lawful basis for email enrichment** (legal, blocks the email phase going
   live). Email-by-inference shifts the GDPR profile → needs a documented LIA
   + Art.14 notice. *Default: legitimate-interest, DPO authors the LIA.*
3. **Registry/PEC data source + ToS** (legal). *Default: official/licensed
   (INI-PEC, registroimprese API) over scraping.*
4. **Auth + worker runtime.** *Default: Supabase Auth (you already run
   Supabase eu-central-1) + a dedicated Node worker pool leased via Postgres
   (n8n for scheduling only).*
5. **Billing model.** *Default: per-field credits backed by the cost_ledger
   actuals — simplest to reconcile and cap.*

Full ranked ledger in `docs/production_roadmap.md` §Open-Decisions.

## The single recommended first phase

**Free-gold page extraction — and it is already built in this pass** (Phase 1):
- New pure module `src/enrichment/extract/extract_from_body.ts` +
  `apply_free_gold.ts`, wired at the website-verify seam, mining email / PEC /
  instagram / facebook / linkedin / VAT / phone from the already-fetched body.
- Schema v2: `instagram/facebook/linkedin` appended (append-only, no column
  moved). `email_inferred/pec/vat_code_final` already existed — now populated.
- Zero new HTTP, zero cost, 719 tests stay green + 17 new tests.
- A read-only probe quantifies the hit-rates (the thesis evidence).

**Next**, in order: the Gate-0 hardening (delete the 3 dead providers, fix the
dedup leak, one live €0.10-capped paid run, merge the branch) → engine-library
extraction (`enrichLead`) → official-data spine (the moat) → per-field
waterfall framework → Supabase persistence → API → orchestrator → frontend →
multi-tenant → billing. Each phase, its gate, and its effort (code-grounded)
are in `docs/production_roadmap.md`.

## The meta-lesson baked into the design

All three prior passes taught the same thing: *competence in the small is
worthless without context verification in the large* (the readiness report
celebrated two near-non-problem fixes while a real silent failure — 3 dead
providers — went unnamed). So the platform makes the system **self-reporting**:
a provider at 0% success is surfaced in the dashboard's provider-health panel,
never silent; Maps lead-counts are shown as "≥ N" (the MEASURED 6× variance
band), never as false point values; every enriched value carries its evidence
(source, method, confidence, cost) so precision claims trace to data, not
assertion.

## Read next
- `docs/platform_blueprint.md` — architecture, Postgres schema, API, risk/scale, compliance.
- `docs/frontend_spec.md` — the dashboard + design language, buildable by a frontend agent.
- `docs/production_roadmap.md` — the phased roadmap, build sequence, gates, open decisions.
- `docs/measurement_evidence/` — the free-gold hit-rate numbers + the command to re-run them.
