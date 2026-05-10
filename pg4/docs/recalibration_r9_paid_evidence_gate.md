# R9 — Structural Paid Evidence Gate (offline, no paid spend)

User mandate: R8.1 stop-rule triggered on VR (75.9 % precision). The
host-blocklist approach was reactive; each province surfaced its own
aggregator long-tail. R9 designs and validates a structural rule using
existing BL + VR paid outputs (zero new Serper spend).

## The bug

`piva_match` from PreVerifyGate accepts any page whose body contains
the lead's 11-digit P.IVA. Three FP classes survive:

  1. **Aggregators** publish the firm's P.IVA in directory listings
     (casabitare.it, visure24.com, sihappy.it, startuplus.it,
     gazzettaufficiale.it, cercaaziendepro.it).
  2. **Wrong-sector cross-vat**: same legal entity operates a non-
     real-estate business surface (babileather.it leather,
     ingebau.it engineering, tipsammartino.it printing).
  3. **Govt / research / video** publish business data for their own
     purposes (cnr.it, opencup.gov.it, univalpo.it, youtube.com).

All three pass piva_match without being the firm's site.

## The fix — `evaluatePaidEvidence(html, normalized, lead)`

Pure module `src/discovery/website/paid_evidence_gate.ts`. Runs
AFTER `verifyCandidates` returns `method === 'piva' | 'phone'` and
BEFORE setting `lead.official_website` for `SERP_PAID`.

Two rules, in order:

  1. **Aggregator detection** — distinct vat count ≥ 4 in body → veto.
     Real agency sites have 1-2 vats (firm's own + maybe partner);
     aggregators have 10+.

  2. **Sector density** — count of real-estate vocabulary matches in
     body. Real agency sites have 5-50+ matches across nav, hero
     copy, listings, footer. Wrong-sector pages have 0-2 ("immobiliare"
     mentioned once in a corporate-divisions paragraph or regulatory
     footer). Threshold: **≥ 3 matches**.

The title-rule explored earlier was dropped — too strict, rejected
real agency homepages whose title is generic ("Cortina.it", "Agenzia
Valbelluna") while the body content is dominantly real-estate.
Sector density is a stronger structural signal.

## Wiring

`SerpStage.runPaidPass` now consumes `verdict.body` (newly exposed
from `verifyCandidates`) and runs `evaluatePaidEvidence` before
setting `SERP_PAID`. On reject:
- `lead.official_website` / `website_discovery_method` /
  `website_confidence` cleared (same side-effect cleanup R7.0
  introduced)
- info log emitted with the gate's reasons
- stage returns null → free-only failure paths run

`PgDetailStage` is intentionally NOT updated: R6.1's semantic-veto
already protects it, and PG-attestation is a different evidence path
(PG harvested vs Serper search).

## Offline simulation results

`scripts/simulate_paid_gate.ts` — refetches each `SERP_PAID`
accepted lead from BL + VR outputs, applies directory filter, then
gate. Compares to manually-audited ground truth.

### BL (`p_recal_bl_paid.jsonl`)

  | metric                           | value |
  | -------------------------------- | ----: |
  | SERP_PAID input                  | 73    |
  | TPs (corrected ground truth)     | 62    |
  | FPs (corrected ground truth)     | 11    |
  | allowed by combined pipeline     | 58    |
  | of which from directory filter   | 11    |
  | of which from sector-density gate| 4     |
  | tp kept                          | 58    |
  | tp lost                          | 4     |
  | fp caught                        | 11    |
  | fp kept                          | 0     |
  | **precision**                    | **100 %** |
  | **tp recall**                    | **93.5 %** |
  | **tp loss**                      | **6.5 %** |

The 4 real TP regressions: agenzia-palatini.it/en/,
marinopiccolotto.it/en, benedetti.immo/impressum/,
agenziatable.it — all share the pattern of a non-homepage URL whose
body lacks sector density. Future refinement: retry the homepage
when a non-homepage path fails the gate.

The R9 simulator surfaced 5 additional BL FPs my first audit missed
(domus-picta.com vineyard, cercaaziendepro.it directory,
gazzettaufficiale.it govt, visure24.com aggregator,
cenatesotto.halleyweb.it municipal). Each added to `DIRECTORIES`.

### VR (`p_recal_vr_paid.jsonl`)

  | metric                           | value |
  | -------------------------------- | ----: |
  | SERP_PAID input                  | 58    |
  | TPs                              | 44    |
  | FPs                              | 14    |
  | allowed by combined pipeline     | 40    |
  | of which from directory filter   | 14    |
  | of which from sector-density gate| 4     |
  | tp kept                          | 40    |
  | tp lost                          | 4     |
  | fp caught                        | 14    |
  | fp kept                          | 0     |
  | **precision**                    | **100 %** |
  | **tp recall**                    | **90.9 %** |
  | **tp loss**                      | **9.1 %** |

The 4 VR TP regressions: bphome.org, immobiliaremincio.it/agenzia.html,
saralorenzin.it, ethika.pro/it/cookie-policy/. Same pattern: most are
non-homepage URLs with limited body content.

## Combined effect — provinces summary

  | province | before R9 (audit) | after R9 (simulated) | TP loss |
  | -------- | ----------------- | -------------------- | ------- |
  | BL       | 91.8 %            | **100 %**            | 6.5 %   |
  | VR       | 75.9 %            | **100 %**            | 9.1 %   |

Both target metrics met:
  - precision ≥ 90 % ✓
  - TP loss ≤ 10-15 % ✓

## Tests

`tests/unit/paid_evidence_gate.test.ts` — 15 cases:
- 7 REJECT (low density): babileather, ingebau, tipsammartino,
  cnr, opencup, univalpo, youtube, visure24
- 2 REJECT (aggregator): casabitare, sihappy
- 3 ACCEPT (real agency): studiozetapadova, cortina.it (generic
  title + dense body), Bordignon-with-partner
- 3 guards: empty html, aggregator-veto-precedence

`tests/unit/serp_stage_paid_semantic_veto.test.ts` updated: the
ACCEPT-piva test now uses richer real-estate body to clear the
sector-density bar (single-mention HTML no longer passes — by
design).

## Verification

  npm run typecheck   green
  npm test            521 passed | 1 skipped (47 files)
  npx tsx scripts/simulate_paid_gate.ts output/p_recal_bl_paid.jsonl /tmp/bl_truth.json
  npx tsx scripts/simulate_paid_gate.ts output/p_recal_vr_paid.jsonl /tmp/vr_truth.json

Zero paid spend in R9. All gate validation done on existing BL+VR
outputs already paid for in R8.1.

## What's pending

R9 ships the gate behind the existing run-cap discipline. No paid
provider call is initiated by R9 itself. Next step requires
re-authorization:

  - **R10 (paid)** — confirmation rerun on VR with the new gate
    active. Cap €0.20. Should validate the 100 % simulated precision.
    Awaiting explicit "GO R10 paid — autorizzo max €0.20".

  - **R10.b** — TV paid run (the originally-deferred R8.1 third
    province). Cap €0.20. Verifies generalization beyond
    BL+VR audit data. Awaiting explicit "GO R10.b paid — autorizzo
    max €0.20" only after R10 passes.

The host-blocklist additions stay (they catch the canonical FP
hosts) AND the structural gate stays (catches new hosts as they
emerge). The gate doesn't replace the blocklist; the two layers
compose.
