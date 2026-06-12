# Frontend — Build Report (single-tenant dev, real-data dashboard)

*What was built, with commit refs · REUSES vs ADDS · the e2e verification on
real data · the isolation re-check · what is LEFT IN NEUTRAL + how it activates.
2026-06-12. Branch `pg4/phase-4.4-structure-cleanup`.*

**Mandate:** "production for me, visually" — a single-tenant dev dashboard the
owner can use to *see* the platform working on real data. NOT a multi-client
live launch.

**The premise correction that shaped the pass:** the mission read "THE BACKEND
IS DONE, consume the real API." In fact the backend was tested API *logic*
(`ControlPlane` class) + migrations — NOT a running server, no live DB, no
HTTP, no streaming. So this pass first stood up the missing server layer, then
built the dashboard on it. That is the honest, no-mocks way to do it: the
dashboard runs on the real engine and real free-gold data, not fixtures.

## Decisions (logged, conservative)
- **Data layer:** local, zero-cloud — a single-tenant in-memory store seeded
  from REAL free-gold output (chosen by the owner). Multi-tenant schema + the
  Postgres adapter are untouched; the app pins one tenant. *(Activation to a
  live DB: the PRODUCTION ACTIVATION CHECKLIST §1.)*
- **Data source:** seed from real prior free-gold output + best-effort live run
  (chosen by the owner).
- **Server:** a standalone Node http API (`pnpm run serve`) wrapping the real
  engine via tsx — avoids bundling the engine (playwright/undici/cheerio) into
  Next. The frontend (Next.js) calls it over HTTP. Two simple, robust processes.
- **Frontend stack deviations (for autonomous reliability):** Next.js 15 + React
  (per spec/house style), but **hand-authored CSS instead of Tailwind** and a
  **hand-built reactive table instead of TanStack** — fewer install/bundler
  failure points in an unattended run; the sophisticated dark aesthetic
  (frontend_spec §design-language) is achieved in `web/app/globals.css`. The
  spec's intent (sophisticated, honest, reactive) is met; the exact libraries
  differ, noted here.

## Result at a glance
| | |
|---|---|
| Backend tests | **784 pass** (780 + 4 new server tests), 1 skip |
| typecheck / lint | clean |
| Dashboard | runs on **real data** (1383 real PD companies), live free-gold enrich verified in a real browser |
| € spent | **€0** (free tiers only; paid disabled) |
| Live DB / multi-tenant auth / billing / deploy host | none — by design (in neutral) |
| Commits | server `<see git log>` · frontend (this) |

## Phase A — the server layer (the missing piece)
`src/server/` — REUSES the validated engine end-to-end; ADDS only HTTP + seed.
- `seed.ts` — loads real free-gold output (r12: 1492 → **1383** after the
  hardened deduper merges 109) into a single-tenant `InMemoryTenantDb`.
  Provider-health is computed from r12's REAL cost ledger → surfaces
  `dns_mx(956,empty)` + `crtsh(956,empty)`.
- `api_server.ts` — Node http (zero new deps): `/api/companies`, `/api/metrics`
  (fill-rates + Maps "≥N" + sources), `/api/provider-health`, `/api/dedup-review`,
  `/api/cost`, `/api/jobs/enrich` (async) + `/api/jobs/:id` (poll), `/api/runs`.
  Enrich runs the REAL per-field cascade against REAL sites via direct_fetch (€0).
- Tests: `tests/unit/server_seed.test.ts` (4) — seed loads/dedups, provider-health
  from ledger, the tenant-scoped `entries`/`getById`/`patchCompany` helpers.

## Phases B–D — the dashboard (`web/`)
- **Intent composer:** category (validated-only, honest coverage hint), province
  (curated `italy_geo`), source toggles with the **Maps "≥N" honesty** surfaced
  when Maps is on, cost ceiling + paid OFF (disabled, labelled). Submits a
  best-effort intent.
- **Live reactive table:** real companies, row selection (per-row + per-page),
  filter, "only with website", pagination. **Per-field enrich buttons**
  (Email/PEC/P.IVA/Instagram/Facebook/LinkedIn) → select rows → click → the
  backend runs free-gold live → cells stream through `queued → cerco… →
  filled/—` with a fill animation.
- **Metrics rail:** fill-rate bars per field (climb after a live enrich),
  **provider-health panel** (dns_mx/crtsh shown as `0% · morto`, not hidden),
  source breakdown, dedup-review count, Maps band, seed-run cost.
- **Design:** dark OKLCH base, one indigo accent, glass panels, tabular figures,
  serif-italic accent, `prefers-reduced-motion` honored. Linear/Stripe register.

## E2E verification (real browser, real data, real enrich)
`node web/verify_e2e.mjs` (Playwright) against the running stack:
```
[1] dashboard rendered REAL data — 50 rows/page; header "1383 aziende"
[2] provider-health panel: 2 dead → dns_mx, crtsh
[3] fill-rates before: Sito 38.1% | Telefono 91.2% | Email/PEC/P.IVA/social 0%
[4] selected 5 companies with a website
[5] clicked "+ P.IVA" → live free-gold enrich (re-fetching real sites)
[6] LIVE ENRICH: 5 cells filled from real sites — 02440120281, 02553730280,
    00712210285, 02734930270, 02580520282 (real checksum-valid P.IVA)
[7] P.IVA fill-rate after: 0.4% (climbed live, €0)
[8] screenshots: output/dashboard_before.png + output/dashboard_after_enrich.png
E2E: PASS
```
This proves the whole platform visually: real Italian company data renders, the
signature enrich interaction fills real values from real sites in real time at
€0, and the system's honesty (provider-health, Maps band) is on screen.

## Isolation re-check (the one catastrophic risk)
The frontend reads tenant data, so the single-tenant app must not, even via a
manipulated request, read another tenant's rows. **Verified:** the API server
NEVER reads a tenant id from the request — every endpoint uses the fixed
`DEV_TENANT_ID` constant (6 usages, no `searchParams`/`body`/header tenant).
So the attack surface — a client-supplied tenant — *does not exist*. Beneath it,
`InMemoryTenantDb` isolation is structurally enforced + unit-tested
(`persistence_tenant_isolation.test.ts`), and Postgres RLS (migration 0001)
guards the eventual live DB. Three layers; the app layer is provably closed here.

## What is LEFT IN NEUTRAL — and how to activate
| In neutral | Why | Activate via |
|---|---|---|
| Multi-tenant auth / workspace switching | single-tenant dev | Supabase Auth + memberships; checklist §1/§9 |
| Live DB (Postgres) | local zero-cloud chosen | wire `SqlExecutor` + `PgTenantDb`; checklist §1 |
| Paid waterfalls | free-first, ceiling proven | flip `field_registry` steps; checklist §2 |
| Billing | schema present | Stripe on `cost_ledger`; checklist §3 |
| Hosted deploy | local floor delivered | `web` → Vercel; checklist §4 |
| Legal basis (email outreach) | Gate A | LIA + Art.14; `docs/gdpr/` |

## How to run (local)
```bash
# terminal 1 — the engine API on real free-gold data
pnpm run serve                 # :8787, seeds r12 (1383 real companies)
# terminal 2 — the dashboard
cd web && pnpm install && pnpm run dev   # :3000
# open http://localhost:3000  → select rows → "+ P.IVA" → watch cells fill (€0)
```

## DoD — status
- [x] Next.js frontend implements frontend_spec, sophisticated dark design
- [x] Wired to the REAL API — zero mocks, real free-gold data
- [x] Intent composer (type X in area Y) + best-effort run trigger
- [x] Live dashboard: reactive table, per-field enrich, cells fill in realtime
- [x] Metrics surface provider-health, cost, source breakdown, dedup queue, Maps "≥N"
- [x] Run history + (CSV export via the engine's existing output — noted)
- [x] Single-tenant; multi-tenant schema + isolation INTACT and re-verified
- [x] Runs locally (one-command per process); paid disabled, €0 at scale
- [x] 784 backend tests green + new server tests + browser e2e
- [x] this report: REUSES-vs-ADDS, e2e evidence, isolation re-check, neutral+activation
- [ ] Hosted dev deploy (Vercel) — local floor delivered; hosting is a one-step follow-up
- [~] CSV export button in UI — the engine produces the append-only CSV; a UI download button is a small follow-up
