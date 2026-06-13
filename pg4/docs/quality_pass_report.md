# Quality pass — Precision → Fill-Rate → Coverage

*Sequenced, gated. 2026-06-12. FILL-RATE (got populated) and PRECISION (is
correct) are reported separately, never conflated — the whole point.*

## The one-page top: every field's honest (fill-rate, precision) pair, today

| field | FILL-RATE (populated) | PRECISION (correct) | basis |
|---|---|---|---|
| **email** | ~52% | **~100%** of filled are same-domain (the company's own) | extractor enforces same-domain; probe confirms 12/12 |
| **social** | ~61% | 100% profile-shaped; **ownership needs eyeball** | probe; ownership not auto-verifiable |
| **VAT** | ~78% | **~40% VIES-confirmed (0.95)**, ~60% footer-unconfirmed (0.6); proven-foreign refused | probe + vatResolve real-data verify |
| **fatturato** | ~45% of website-having | **fixed**: most-recent year (was 2020 for all); golden-locked | wrong-year bug, fixed + golden |
| **dipendenti** | ~50% of VATs | **fixed**: real bands "10-15"/"1000+" (was "1015"); golden-locked | band bug, fixed + golden |

Numbers are MEASURED on real PD data, €0 (`docs/precision_evidence/`,
`docs/measurement_evidence/`). PRECISION is a measured proxy, stated honestly;
where it can't be auto-verified (social ownership, domestic VAT) it says so.

---

## Phase A — PRECISION (gate PASSED). REUSES vs ADDS.

### A.1 — VIES-gate the unverified input VAT (`field_registry.ts`)
`resolveVat` now carries provenance (`site` vs `input`). The fatturatoitalia
step VIES-validates an **input** VAT before trusting it: VIES-confirmed → trust;
VIES names another company → refuse (`vat_unverified`); VIES unreachable →
low-confidence + flagged. A site-scraped VAT is trusted directly. REUSES
`checkVatViaVies` (already wired, free); ADDS the provenance + gate. €0.

### A.2 — Precision sample per field (`src/scripts/probe_precision.ts`, repeatable)
A real-site, source-checked probe (the manual fatturato check made systematic):
email same-domain, **VAT via VIES official-name match** (the standout — VIES
names the holder, so a footer VAT can be confirmed/refuted automatically),
social profile-shape. Output + verdicts in `docs/precision_evidence/`. This is
how the wrong VAT (~28% upper-bound) was quantified. €0.

### A.3 — Per-cell provenance + confidence
Every enrich cell carries `source` + `confidence` end-to-end (StepResult →
job → dashboard tooltip): "fonte: vat:vies_confirmed · conf 95%" vs "vat:
footer_unconfirmed · conf 60%" vs "fatturatoitalia(input?vies-down)". A footer
mailto ≠ a guess; a VIES-confirmed VAT ≠ an unconfirmed one — now visible.
ADDS confidence to the cell; the fuller per-field schema column is the
activation path (the dashboard surface is live now).

### A.4 — Real-data golden audit (the latent-bug class)
| extractor | golden | type |
|---|---|---|
| fatturato year selection | `fatturato_euganea_oldest_first.html` (real chart vars) | **REAL** ✓ |
| dipendenti bands | `parseDipendenti` real strings ("da 10 a 15", "oltre 1000") | **REAL** ✓ |
| VAT precision (name match) | real VIES-vs-company name pairs | **REAL** ✓ |
| email/social/VAT body extract | `it_site_*.html` synthetic-but-faithful | synthetic + real-site probe |
| resolveVat provenance | pure logic | unit |

The two STRUCTURED parsers (fatturato, dipendenti) — where the latent bugs lived
because the assumption (array order, single value) didn't match reality — now
have REAL-data goldens. The body extractors are simple (mailto / footer text /
hrefs); their synthetic fixtures are structurally faithful AND backed by the
real-site precision probe (A.2). Committing real-site fixtures for them would
commit company PII (against the project's discipline) — so the real-data check
for those is the probe, not a committed page.

### Phase A GATE — evidence
- [x] Input VAT VIES-validated before trust; low-confidence flagged (A.1 + tests)
- [x] Measured PRECISION per filled field, source-checked + saved (A.2)
- [x] Per-cell provenance + confidence shipped + visible (A.3)
- [x] Every extractor has a real-data golden where the risk lives; body
      extractors backed by the real-site probe (A.4)
- [x] VAT precision was poor (~62% verifiable) → FIXED in Phase A (vatResolve):
      proven-foreign refused, confirmed @0.95, domestic kept @0.6 honest
- [x] 800 tests green; €0 spent (VIES + fatturatoitalia free; paid `enabled:false`)

**Three real-data catches this pass** (the discipline working): the fatturato
wrong-year, the dipendenti bands, and — on my own fix — VIES over-rejecting valid
domestic VATs (VIES covers only intra-EU-registered VATs). Each was caught by a
check against the source, not by a green test.

---

## Phase B — FILL-RATE — HANDOFF (gate A passed; not executed this pass)

Per the mission's budget rule (Phase A is the non-negotiable core; B/C compress
with a precise handoff), B is specced, not built — a measured precision baseline
first. Each B gain MUST carry a precision check on a fresh sample before it counts.
- **B.1 free email**: parse /contatti, /chi-siamo (often already-fetched) → then
  pattern-guess `info@domain` as a LOW-confidence tier (tag via A.3). Precision-
  check each tier separately (a guess ≠ a scraped mailto).
- **B.2 VAT-as-master-key**: every +1 VAT point lifts fatturato+dipendenti+PEC.
  Raising VAT fill (contact-page beyond footer) is the highest-leverage free lever
  — but keep vatResolve's VIES-confirm so new VATs are precision-tiered, not blind.
- **B.3 paid tiers** (DropContact/Proxycurl): wire DISABLED behind the €0.02
  ceiling; one bounded paid sample to measure precision; never at scale. PEC via
  INI-PEC stays the operator decision.

## Phase C — COVERAGE — HANDOFF
- **C.1 registry-as-universe**: ATECO+province → all VATs → enrich (VAT-keyed, so
  fatturato/PEC come free). The moat + the frontend's intent. Visure partly paid →
  gate. Deliver a one-ATECO+province slice first.
- **C.2 category #2**: ~6 hardcode sites, M-L, operator names the sector first.
- **C.3 Maps "≥ N"** honesty stays where Maps contributes.

## What's LEFT IN NEUTRAL + how to activate
- Domestic VAT *validation* (vs VIES confirmation): needs Registro Imprese (Phase C).
- Paid enrichment tiers: `enabled:false` behind the proven €0.02 ceiling.
- INI-PEC bulk PEC: operator decision (paid API vs ToS scrape).
- Push: held by the owner behind the manual sample-check. Not pushed.
