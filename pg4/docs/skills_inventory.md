# Skills inventory — what's installed, pg4-relevance, what was used

*Discovered (not assumed) from `~/.claude/skills/` — 88 installed skills. 2026-06-14.*

## GreenWatt-context finding (REQUIRED by the mission — and it inverts the worry)
The mission expected GreenWatt-anchored skills (`greenwatt-red-team-guardrails`,
`greenwatt-strategic-reasoning`, `greenwatt-memo-writer`, etc.). **None of those are
installed** — they live under `~/Downloads/04_GREENWATT/SKILLS/`, not in the skills
path. The installed set is the GENERIC, project-agnostic family (the reasoning/
red-team/memo functions exist as `claim-realism-check`, `evidence-backed-
argumentation`, `claim-evidence-mapping`, `source-triangulation`, `strategic-memo-
writing`, `deal-risk-review`, `integration-risk-review`). I read each one's
frontmatter: none bakes in GreenWatt figures (burn €62k/mo, Kill Gates, dossier).
So the GreenWatt-context risk is LOWER than briefed — the only real vector is
`llm-council`'s "scan CLAUDE.md" step (handled: see council_decision.md). Several
skills DO carry Marco-business context (Italian B2B, AECO, AXEND) — but that's
pg4-ALIGNED (pg4 is Italian B2B), so it's signal, not contamination.

## Skills USED for this step (council → Openapi slice)
| skill | method kept | GreenWatt context stripped? |
|---|---|---|
| **llm-council** | 5-lens advisors → anonymized peer review → chairman | YES — fed pg4-only framed question, no CLAUDE.md scan |
| **integration-risk-review** | the 10-point risk checklist (side effects, rate limits, auth, idempotency, retries, compliance, rollback) applied to the Openapi adapter | n/a — generic; kept the checklist, dropped the "design doc §7.5" refs |
| **research-briefing** (method) | structure the Openapi license/ToS + endpoint verification as question→sources→findings→confidence→unknowns | n/a — generic |
| **source-triangulation** + **claim-realism-check** (method) | the slice compares free-scrape vs Openapi on the SAME claim, reports fill AND precision separately, every number checked against the source | n/a — generic; reinforces the project's fill≠precision rule |

## pg4-RELEVANT skills (future steps, not this one)
- **automation-spec-writing / workflow-design** — spec'ing the registry-universe
  adapter (the C build-spec already written) or n8n handoffs.
- **n8n-workflow-drafting** — if Openapi enrichment is exposed as an n8n node.
- **italian-business-context-check / b2b-offer-messaging / cold-email-writing /
  objection-aware-copy** — the SELL side of pg4 (the council flagged PEC as the
  monetizable channel; these shape the offer when productizing).
- **lead-scoring-framework / crm-segmentation-strategy / pipeline-stage-design** —
  turning enriched data into a scored, segmented product.
- **claim-evidence-mapping / evidence-backed-argumentation / executive-summary-
  writing / strategic-memo-writing** — the reporting discipline (already the
  project's spine: every claim → evidence).
- **webapp-testing** — Playwright testing of the dashboard (pg4 has a web UI).
- **claude-api / mcp-builder** — if pg4 exposes an API/MCP surface later.
- **rag-quality-evaluation** — if the corpus becomes a retrieval product.

## NEUTRAL / not pg4-relevant (Marco's personal-ops + doc-tooling families)
- Memory/ingest ops: `fast-memory-*`, `semantic-memory-promotion`, `episodic-
  cluster-synthesis`, `kb-ingest-planning`, `ingest-manifest-planning`, `intake-
  router`, `payload-schema-conformance`, `safe-*-runbook`, `working-memory-
  retention`, `memory-hygiene-reporting`, `obsidian-knowledge-ingest`,
  `structured-folder-ingest-planning`, `folder-*`, `future-usefulness-review`,
  `canonicality-review`, `document-type-extraction`, `batch-coherence-review`.
- Content/marketing ops: `content-*`, `editorial-calendar-planning`, `distribution-
  plan-writing`, `content-pillar-strategy`, `follow-up-*`, `negotiation-copy-
  drafting`, `objection-handling-strategy`.
- Personal productivity: `agenda-briefing`, `weekly-planning`, `task-triage`,
  `crm-hygiene-planning`, `internal-comms`, `deal-risk-review`.
- Doc/artifact tooling: `docx`, `pdf`, `pptx`, `xlsx`, `canvas-design`,
  `algorithmic-art`, `brand-guidelines`, `theme-factory`, `frontend-design`,
  `web-artifacts-builder`, `slack-gif-creator`, `higgsfield-*`, `gstack`,
  `voltagent`, `doc-coauthoring`, `skill-creator`, `find-skills`,
  `anthropic-skills`, `impeccable`, `market-context-synthesis`,
  `aeco-domain-sanity-check`, `tone-register-review`, `revision-from-review`,
  `safe-migration-planning`, `automation-spec-writing` (listed above where used).

## Bottom line
The decision step needs four skills' METHODS — council (decide), integration-risk-
review (wire the API safely), research-briefing (verify the license), source-
triangulation/claim-realism (measure honestly). All generic; GreenWatt context was
never imported. The rest of the catalog is Marco's personal-ops + the SELL-side
toolkit — relevant when pg4 turns enriched data into a sold product, not for this
build step.
