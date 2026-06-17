# pg4 — actions catalog: what's performable now + the full frontend surface

*Exhaustive (including uncertain items, by request). Status: **[HAVE]** live in the
dashboard · **[PARTIAL]** backend ready / UI thin · **[SHOULD]** clear need, not built ·
**[MAYBE]** plausible, undecided. Grounded in the real CLI scripts, API endpoints, and
web methods (2026-06-17). Engine surfaces: CLI · dev-server (8788) + dashboard (web).*

## PART 1 — what can be performed TODAY (grounded)
**CLI** (`pnpm run …`): `scrape` (PG/Maps by category+province) · `enrich` (free-gold
fields) · `run` (scrape+enrich chained) · `judge` (L2–L5 two-axis verdict, CSV→JSONL,
`--two-pass`/`--paid`/`--limit`) · `judge:eval` (golden set → per-block precision/recall) ·
`validate:output` · `lookup` · `benchmark` · `serve` (dev API) · build/typecheck/test/lint.
**Dev-server API**: `/api/companies` · `/api/metrics` · `/api/provider-health` ·
`/api/dedup-review` · `/api/cost` · `/api/runs` · `/api/health` · `/api/jobs/{scrape,enrich,
discovery,collect-signals,judge,validate-export}` + `/api/jobs/:id` poll · `/api/judgment?id=`.
**Dashboard**: new-search panel (category+province+source toggles+paid toggle) · company
table (paginated 50, select, text-filter) · field-coverage bars · provider-health · cost ·
runs · per-field enrich buttons · judgment buttons (L2–L5) · verdict badge · **judgment drawer**.

---

## PART 2 — the FULL frontend action catalog (everything it should expose)

### A. Discovery / Sourcing
| action | status |
|---|---|
| Scrape by category + province (PG/Maps toggles) | HAVE |
| Paid-provider toggle for discovery | PARTIAL (UI, build disabled) |
| Pre-submit COST estimate + selection ceiling enforced (today disconnected) | SHOULD |
| **ATECO-based discovery** (Cypher: map ATECO→search terms) | SHOULD |
| **Openapi `IT-search` enumeration** by ATECO+province (count via dryRun, then pull) | SHOULD (client built, disabled) |
| Per-vertical **calibration runner** + yield report (new categories) | SHOULD |
| Preflight **selector-health** check before a run | SHOULD |
| Resume / checkpoint control for an interrupted scrape | SHOULD |
| Multi-province / multi-category batch launch | MAYBE |
| Scheduled / recurring discovery (cron) | MAYBE |

### B. Table / Data view
| action | status |
|---|---|
| Paginated table, row select, text filter | HAVE |
| Filters: quadrant · target · fill-state · category · province · score-range | SHOULD |
| Sort by any column · column show/hide config | SHOULD |
| **Virtualization** for large lists (today paginated 50) | SHOULD |
| Per-cell **evidence drill-down** (source + confidence + raw) | PARTIAL (tooltip only) |
| Export the (filtered) view to CSV/JSONL | SHOULD |
| Select-all-filtered · saved views / segments | SHOULD |
| Company **detail page** (all fields + judgment + history) | SHOULD |
| Inline manual edit / override of a cell | MAYBE |

### C. Enrichment (per-field cascade)
| action | status |
|---|---|
| + Email · + P.IVA(VAT) · + Fatturato · + Dipendenti · + IG/FB/LinkedIn (bulk on selection) | HAVE |
| Provenance + confidence shown per cell | HAVE (tooltip) |
| + PEC · + Decision-maker (fields exist) | PARTIAL |
| **Paid-tier enrich** (DropContact/Proxycurl) behind cost gate + confirmation | SHOULD (wired-disabled) |
| **Openapi deep-enrich** (top-on-request: IT-advanced + IT-pec) — the activation layer | SHOULD (client built, disabled) |
| Re-enrich / force-refresh a field · refresh stale cells | SHOULD |
| "Show only low-confidence cells" · confidence threshold filter | SHOULD |
| Bulk enrich-all-fields with per-selection cost preview | MAYBE |

### D. Judgment (L2–L5) — the two-axis engine
| action | status |
|---|---|
| L2 Discovery · L3 Collect-signals · L4 Judge · Validate-export (per selection) | HAVE |
| Verdict badge (target/quadrant) | HAVE |
| **Judgment drawer**: A/B level+score+rationale, quadrant, target, motivation, leve, §17-flag | HAVE |
| **Eval view**: load golden → `judge:eval` → per-block precision/recall + **A-agreement** + quadrant confusion | SHOULD |
| **Human override (L5b)**: correct A/B-level, quadrant, target in the drawer → write to golden | SHOULD |
| **Quadrant matrix** view: companies plotted A×B, click a quadrant to filter (targets = A+B-) | SHOULD |
| Levers → outreach **playbook** per lead (the "leva" made actionable) | SHOULD (partial in drawer) |
| Batch-judge with progress · re-judge · pick judgment_config version | SHOULD |
| Surface the §17 **category benchmark / cohort** context per block | SHOULD |
| "Explain this verdict" — the evidence chain per signal · critic's validation | MAYBE |
| Compare two judge configs (A/B) on the same golden | MAYBE |

### E. Cypher workflow (client lead-gen)
| action | status |
|---|---|
| Cluster selector (C1 home / C2 brand / C3 hospitality) → its ATECO codes | SHOULD |
| Per-ATECO discovery launcher (from roadmap_ateco.md) | SHOULD |
| **Prospect-matrix builder** (100 companies × 4 metrics: decisore · problema · budget · conversione) | SHOULD |
| Call-outcome tracker (qualified call → proposal → willingness-to-pay) | SHOULD |
| ICP-fit score (A+B- weighted + ATECO priority) · per-cluster segment export | MAYBE |
| Per-cluster offer template attach | MAYBE |

### F. Cost / budget
| action | status |
|---|---|
| Cost view · provider-health (dead-provider detector) | HAVE |
| Ceiling config (per-field €0.02 · per-run · per-session) + live spend gauge | SHOULD |
| Per-provider cost breakdown · paid on/off with cost projection | SHOULD |
| Budget alerts · cost-per-lead · per-Cypher-cluster spend | MAYBE |

### G. GDPR / Legal (the "scrapable ≠ usable" gates)
| action | status |
|---|---|
| **Suppression manager** (do-not-contact — engine has it, surface it) | SHOULD |
| **Gate-A consent** toggle required before export/outreach | SHOULD |
| Opt-out handler · data-request (access/erasure) · retention config | SHOULD |
| Per-source ToS/robots flag · "separate scrape/enrich/send" enforced in UI | SHOULD |
| Consent-basis tag per lead · audit log (who-touched-what) | MAYBE |

### H. System / Ops / Observability
| action | status |
|---|---|
| Provider-health panel · dedup-review COUNT · runs (1 synthetic row) | HAVE |
| Full **dedup-review** UI (review / merge / keep the near-dup queue) | SHOULD |
| Run-history (full list + per-run detail/cost/status) · live job progress | PARTIAL (poll exists) |
| **Settings**: surface env flags (providers on/off, OPENAPI_ENABLED, etc.) | SHOULD |
| Tenant switch (multi-tenant is in the schema) | SHOULD |
| Yield-anomaly alerts · preflight selector-health surface | SHOULD |
| Realtime (websocket vs 1.2s polling) · scheduling UI · error/log viewer · judgment-config editor | MAYBE |

### I. Export / Handoff
| action | status |
|---|---|
| Export CSV/JSONL (the lead schema) — filtered / scored / segmented | SHOULD |
| **CRM push** (Attio / Instantly — Marco's stack) | SHOULD |
| Webhook / API export · scheduled export · n8n handoff · per-cluster list export | MAYBE |

---

## Honest read (priority for a frontend build)
The dashboard today is a strong MVP for **discovery + free-gold enrich + trigger-judgment**.
The biggest gaps that BLOCK the Cypher workflow + the judgment thesis:
1. **Eval view + human-override (L5b)** — without it the judge can't be validated/improved in-UI.
2. **Quadrant matrix + filters** — to actually SELECT the A+B- targets (Cypher's ICP).
3. **Cypher cluster → ATECO discovery → prospect-matrix** — the client workflow.
4. **GDPR gates (suppression, Gate-A consent) + export/CRM** — to move from leads to outreach legally.
Everything else is enrich/cost/ops polish. (A-axis still reads `unknown` until the A-sources
land — see next_steps.md — which caps judgment quality regardless of UI.)
