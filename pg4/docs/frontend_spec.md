# pg4 Platform — Frontend & Dashboard Spec

*Buildable by a frontend agent. Next.js 15 (App Router) + TypeScript strict +
Tailwind 4 + shadcn/ui + TanStack Query + Supabase Realtime. Uses the
`frontend-design` skill. 2026-06-11.*

A sophisticated B2B company-intelligence tool — **not** a CRUD admin. The feel
is Linear / Stripe / Vercel: calm, dense-but-legible, dark, fast.

---

## 0. Design language

- **Theme:** OKLCH dark base, ONE accent (electric indigo or teal — pick one),
  high-contrast text (WCAG 2.2 AA). No purple AI-slop gradients.
- **Surfaces:** glassmorphism cards (backdrop-blur + saturate) over a subtle
  aurora/mesh-gradient backdrop, used sparingly (hero + job composer only).
- **Type:** Geist Sans for UI; Instrument Serif Italic for section accents /
  big numbers in the metrics rail. Tabular figures for all counts/costs.
- **Motion:** Motion (ex-Framer) + Lenis smooth scroll; every transition
  honors `prefers-reduced-motion`. Cell-fill animations are subtle pulses,
  not confetti.
- **Density:** bento-grid metrics, comfortable table rows (44px touch
  targets), generous whitespace around the cost meter.
- **States designed, not afterthoughts:** empty, configuring, running, done,
  error, cost-capped, partial — each has a real layout.

---

## 1. Intent-input surface (the job composer)

A focused, single-purpose composer — the operator expresses "all companies of
type X in area Y" and what to enrich.

**Components:**
- **Category picker** — combobox constrained to *validated* categories
  (today: "agenzie immobiliari"). A clearly-labeled "request a new category"
  affordance that's honest: uncurated categories run with reduced Maps recall.
  Surfaces the coverage truth, doesn't hide it.
- **Geo picker** — province → comune, bound to the curated `italy_geo`
  12-province list (BL VR VE PD VI TV RO BS MN MI TO RM). Uncurated provinces
  show a "manual comuni list" input + a "coverage: partial" badge.
- **Source toggles** — PG · Maps · Registry (registry disabled until Phase 3).
  Maps toggle carries a tooltip: "Maps counts vary run-to-run (±, see results)."
- **Field selector** — checkboxes for the enrichable fields (website, email,
  pec, vat, revenue, employees, socials, decision_maker). Each field shows a
  tier badge: **free** (green) · **free if site** (teal) · **paid** (amber).
- **Cost controls** — per-lead ceiling + run ceiling (€ inputs); a paid
  on/off master switch (off by default, with a "paid requires a key" inline
  check mirroring `assertPaidSecrets`).
- **Estimate** — a live "estimated cost: €X – €Y" range computed from the
  selected paid fields × selection size, before the operator commits.

**States:** empty (just the composer) · configuring (fields chosen, estimate
updating) · submitting · submitted (→ redirect to results).

---

## 2. Live results dashboard

The heart. A reactive table + a metrics rail, streaming as the job runs.

### 2.1 The table (TanStack Table, virtualized)
- Thousands of rows, virtualized. Columns = the selected fields + identity
  (company_name, city, official_website).
- **Per-cell state machine**, each visually distinct:
  `empty → queued → running (pulse) → filled → failed → cost-capped`.
- **Row selection** model (checkbox + shift-range + select-all-filtered).
- **Per-field enrichment buttons** (the core interaction): select rows →
  toolbar shows "Enrich email (124 rows · ~€1.24)" → click → a job is queued →
  those cells go `queued → running → filled` in real time via the Realtime
  channel. Amber "cost-capped" badge on cells the run ceiling stopped.
- **Evidence drill-down**: click a filled cell → popover with the Q4
  provenance — `source · discovery_method · confidence · cost_eur`, and the
  raw evidence snippet/URL. This is what makes precision claims auditable.

### 2.2 The metrics rail (bento grid)
- **Fill-rate per field** — a small bar per field (e.g. "email 54%"), updating
  live. Mirrors the free-gold reality the operator should see.
- **Leads found** — shown as **"≥ N"** for Maps-heavy runs (the MEASURED 6×
  variance band), with a "run again & merge" action that does multi-run union.
  Never a false point value.
- **Cost meter** — spent vs ceiling, a radial or linear gauge; turns amber as
  it approaches the cap, red + a toast when the latched `run_cost_ceiling_hit`
  fires.
- **Source breakdown** — PG / Maps / registry contribution.
- **Dedup-review queue** — count of near-duplicate pairs flagged for review
  (the Q3 fix surfaced as a UI affordance, not a silent file).
- **Provider-health panel** — every active provider with its live success
  rate; **a provider at 0% success is flagged red** (the dead-provider
  detector made visible — the meta-lesson of all 3 prior passes, in the UI).

### 2.3 Realtime mechanism
Supabase Realtime channel subscribed to `job_items` (and a lightweight
aggregate channel for the metrics). No hand-rolled SSE — it's already in the
stack. TanStack Query for the non-streaming reads (companies list, evidence,
cost summary) with optimistic updates on enrichment-button clicks.

---

## 3. Secondary surfaces
- **Suppression manager** — table of suppressed phone/VAT entries + an "add"
  form (Art.21 objection / Art.14). Maps to `POST /api/suppression`.
- **Runs history** — list from the `runs` table; each run's cost, yield,
  suspect flag (the yield-anomaly detector), downloadable output.
- **Settings** — retention window (per-tenant), paid-provider keys (masked),
  plan/usage (Phase 10).

---

## 4. Component inventory (for the build)
`JobComposer`, `CategoryCombobox`, `GeoPicker`, `FieldSelector` (+ `FieldTierBadge`),
`CostCeilingControls`, `CostEstimate`, `ResultsTable` (+ `EnrichableCell` state
machine, `EvidencePopover`, `RowSelectionToolbar`), `MetricsRail` (+ `FillRateBar`,
`LeadCountBadge` with ≥N framing, `CostMeter`, `SourceBreakdown`,
`DedupReviewBadge`, `ProviderHealthPanel`), `SuppressionManager`, `RunsHistory`,
`SettingsPanel`. Empty/loading/error/cost-capped variants for each data
surface.

## 5. Non-scope (deferred)
Billing UI (Phase 10), multi-org switcher polish (Phase 9), advanced
saved-segments/automation. This spec covers the operator's core loop:
**compose intent → watch results fill → enrich fields on demand → audit
evidence → export.**
