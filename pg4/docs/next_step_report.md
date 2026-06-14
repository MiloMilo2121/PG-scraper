# Next-step report — council decision + skill-driven execution

*2026-06-14. €0 spent, nothing pushed, 806 tests still green (no code changed).*

## What was decided (Act 1 — the council)
Ran `llm-council` (5 independent Sonnet advisors → anonymized peer review →
chairman) on pg4's first real spend decision: (A) pay Openapi official registry
API, (B) stay free, (C) bypass government captchas.

**Verdict: Path A (Openapi), measure-first via the free tier. Kill C. B insufficient.**
- C died unanimously — on PROVENANCE, not cost: a SaaS selling "clean official
  Italian data" cannot launder INI-PEC/Agenzia-Entrate data through a captcha-solver
  (collapses at first enterprise due-diligence; still leaves the fragile scraping
  that caused all 5 bugs). The owner's "cents at scale" point is real and still loses.
- PEC (IT-pec €0.03) is the highest-leverage first endpoint (monetizable certified
  direct-reach + regulatory tailwind from INAD/mandatory-PEC).
- The €0 free-tier slice is the move that satisfies all advisors at once.

**Flip-conditions:** (1) Openapi ToS forbids SaaS redistribution → A's moat voids,
pivot to a licensed CCIAA feed [HIGHEST PRIORITY — unresolved, operator gate]; (2)
slice shows negligible uplift → stay free; (3) unit economics invert → enumeration
+ PEC-only, defer IT-advanced.

Full run (advisor takes, peer review, blind spots): `docs/council_decision.md`.

## What the skills gave (Act 2)
Discovered all 88 installed skills (`docs/skills_inventory.md`). **Finding that
inverts the brief's worry:** the GreenWatt-named skills are NOT installed — the
installed set is the generic family; no skill bakes in GreenWatt baselines. Only
context vector was `llm-council`'s CLAUDE.md-scan step (stripped: advisors got a
pg4-only framed question). Methods used: `llm-council` (decide), `integration-risk-
review` (the 10-point gate on the Openapi adapter), `research-briefing` (license
verification), `source-triangulation`/`claim-realism-check` (the fill≠precision
measurement discipline). GreenWatt context kept: none; stripped: the CLAUDE.md scan.

## What was done (Act 3 — execution, honestly an HANDOFF not a RUN)
The council's step is the €0 free-tier slice. It needs a free Openapi key (none in
`.env`). Per the project's discipline (no golden from an unverified API shape;
sample against the source) and the budget rule (compress to a precise handoff), I
did everything that does NOT require the key, and did not fake the rest:
- **Verified the API against the source** (web): IT-search `GET company.openapi.com/
  IT-search`, ATECO+province, free ≤100/day with dry_run (counts), €0.01 beyond;
  per-endpoint pricing (IT-pec/IT-advanced); visure €2.90+. ✅
- **Chased the #1 flip-condition**: the redistribution clause is in a ToS PDF I
  couldn't extract → flagged as the operator gate BEFORE any moat claim or spend.
- **Ran integration-risk-review** on the adapter → APPROVED WITH MITIGATIONS (one
  BLOCKER for the *moat claim*: the license; none for building the free slice).
- **Wrote the ready-to-run slice spec** (`docs/openapi_slice_comparison.md`):
  68.31+PD, field-by-field fill+precision, €0 core (IT-search+IT-pec free), the
  keyed-run steps.

REUSES vs ADDS: **no code added** (deliberate — an untested HTTP adapter would
violate the real-data-golden rule). The existing `env.ts` provider pattern + the
`field_registry` triple-gate are the reuse surface; the adapter is specced, not
shipped. `scripts/compare_enrich.ts` exists but is website-level, NOT field-level —
the slice harness is a small NEW build, listed in the keyed-run steps.

## Measured vs assumed
- MEASURED: the council verdict (real 5+5 agent run); the API facts (web-verified);
  the skills inventory (read from disk); pg4's current state (prior passes' evidence).
- ASSUMED / UNVERIFIED: exact per-endpoint prices (confirm in-console); the
  redistribution license (PDF, operator); the actual field-level uplift (needs the
  keyed slice run — that's the whole point of measuring before spending).

## Recommended move after this
1. **Operator: verify the Openapi SaaS-redistribution license** (the moat depends
   on it) + create a free-tier key.
2. Hand back: I finalize the adapter from ONE real response (real golden) + run the
   €0 slice (68.31+PD) → fill+precision delta table → the IT-advanced go/no-go.
3. Decide IT-advanced (€0.10) on those numbers + a real client-price unit-economics
   check (the Contrarian's gate).

## Left in neutral + activation
- **Openapi paid tiers**: specced, wired-disabled-by-design; activate = key + adapter
  + flip `OPENAPI_ENABLED` (ceiling-gated). 
- **2Captcha / path C**: rejected by the council; not built (correct — irreversible
  dirty provenance is an owner-only call, and the owner's product premise forbids it).
- **Registry census (prior Phase C)**: still the highest-leverage coverage fix;
  Openapi IT-search is now the identified paid source for it (enumeration by
  ATECO+province) — the same key unlocks both coverage AND the VAT-confidence fix.
- **Push**: held by the owner behind the 10-row source-check. Nothing pushed.
