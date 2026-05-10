# R8.1 — paid Serper generalization on BL + VR (partial)

User mandate: validate the R7 stack on TV / VR / BL before declaring
generalization. Cap €0.20 per province, stop-rule precision ≥ 85 %
on SERP_PAID.

Result so far: **STOP-rule triggered on VR (precision 75.9 %)**. TV
not run yet pending user direction.

## BL — `p_recal_bl_paid` ✅

  npm run enrich --
    --input  output/p43_provincia_bl.csv
    --out    output/p_recal_bl_paid.csv
    --enable-paid
    --cost-ceiling-eur 0.005
    --run-cost-ceiling-eur 0.20

  - 194 leads, 0 errors, 1 ledger summary ✓
  - 112 found_website (33 free + 79 paid; SERP_PAID 73, PG 16, HG 22, free SERP 1)
  - Serper: 149 calls, **€0.149** (≤ €0.20 ✓)
  - success_rate 98.66 %

### Audit (73 SERP_PAID gains, all method=piva conf 0.95)

  TP                       67  91.8 %
  FP_DIRECTORY              5  6.8 %  (telefonforsaljare.nu)
  FP_DIRECTORY              1  1.4 %  (agenzie.generali.it / generali.it)
  precision overall        67 / 73 = **91.8 %** ✓ (> 85 % threshold)

Multi-occurrence hosts that are still TP (same legal entity across
multiple PG/Maps duplicates):
  cortina.it × 2          (Agenzia Immobiliare Cortinese Sas)
  dolomitirentals.com × 3 (Dolomitissime Srl)

Confirmed FP class on BL: Swedish phone-spam aggregator
(`telefonforsaljare.nu`) crawled multiple BL leads and surfaces
the firm's P.IVA in user-reported call entries — the page passes
piva_match without being the firm's site. Generali insurance
directory FP is the same wrong-sector pattern as PD's
`opencoesione.gov.it` / `provincia.pd.it`.

Blocklist additions (committed): `telefonforsaljare.nu`,
`generali.it` (parent — covers all `*.generali.it` subdomains).

## VR — `p_recal_vr_paid` ❌ STOP

  npm run enrich --
    --input  output/p70_provincia_vr.csv
    --out    output/p_recal_vr_paid.csv
    --enable-paid
    --cost-ceiling-eur 0.005
    --run-cost-ceiling-eur 0.20

  - 433 leads, 0 errors, 1 ledger summary ✓
  - 165 found_website (107 free + 58 paid; SERP_PAID 58, PG 40, HG 67)
  - Serper: 199 calls, **€0.199** (≤ €0.20 ✓)
  - success_rate 99.5 %

### Audit (58 SERP_PAID gains, all method=piva conf 0.95)

  TP                       44  75.9 %
  FP_DIRECTORY (aggregator) 6  10.3 %  casabitare.it ×3, sihappy.it,
                                       startuplus.it, visure24.com
  FP_DIRECTORY (govt/edu)   3   5.2 %  cnr.it, opencup.gov.it, univalpo.it
  FP_DIRECTORY (video)      1   1.7 %  m.youtube.com
  FP_WRONG_SECTOR           4   6.9 %  babileather.it ×2 (leather),
                                       ingebau.it (engineering),
                                       tipsammartino.it (printing)
  precision overall        44 / 58 = **75.9 %** ❌ (< 85 % threshold)

### Why VR dropped below threshold

VR audit revealed two FP families that BL didn't surface:

1. **Cross-vat wrong-sector** (4 cases): a single legal entity owns
   multiple businesses. The lead is the real-estate division;
   Serper happens to rank the OTHER division's site higher (leather
   workshop, engineering firm, print shop). Layer-1 piva_match
   accepts the page because the vat is shared by both businesses.

2. **Italian aggregator long-tail** (6 cases): casabitare.it (×3),
   sihappy.it, startuplus.it, visure24.com — none surfaced in PD or
   BL audits. Each publishes the firm's P.IVA in directory entries.

Plus a govt/research cluster (cnr.it, opencup.gov.it, univalpo.it)
analogous to PD's `opencoesione.gov.it` / `provincia.pd.it`.

### VR hardening (committed, pending validation)

Added 12 hosts to `DIRECTORIES`:

  Aggregators:
    casabitare.it, sihappy.it, startuplus.it, visure24.com
  Video / multi-purpose:
    youtube.com (covers m.youtube.com)
  Govt / research / education:
    cnr.it, opencup.gov.it, univalpo.it
  Cross-vat wrong-sector:
    babileather.it, ingebau.it, tipsammartino.it

After hardening, the SerpStage paid pass will reject these hosts
at `verifyCandidates` entry (same as the PD R7.1.b/c blocklist
additions). A confirmation rerun on VR is the natural validation
step — projected precision recovery: 14 FPs → ~3-4 residual = ~93 %.

## Cumulative spend so far

  BL run:   €0.149
  VR run:   €0.199
  total:    €0.348 / €0.60 authorized
  remaining: €0.252

## Decision required

Per acceptance criteria, **R8.1 is paused before TV**. Three options:

A) **Validate VR rerun**: spend up to €0.20 (within remaining
   €0.252) to confirm the hardening lifts VR ≥ 85 %. If yes, then
   ask for renewed authorization on TV (would push total to
   ≈ €0.55 — still under €0.60).

B) **Skip VR rerun, proceed straight to TV** with the hardened
   blocklist. Trusts the hardening to generalize. Saves one run
   but leaves VR's precision unverified post-fix.

C) **Stop generalization here**, commit the BL + VR partial result
   + hardening, treat the 22 % precision drop on VR as evidence
   that piva-on-site alone isn't enough — schedule a future R9
   to design a sector-corroboration rule (require sector-keyword
   in body alongside piva_match) before any further paid runs.

The most honest call is **C**, because the BL→VR precision drop
(91.8 % → 75.9 %) suggests the host-blocklist approach is reactive
and won't generalize cleanly to new provinces (each will surface
its own aggregator long-tail). The structural fix is sector-
corroboration, not list maintenance.
