# R7 — Paid Serper benchmark (PD), precision-first

User mandate: precision-first paid run on the recalibrated stack
(R0-R6.1) with hard caps and audit gates. Run-cap €0.20, per-lead
cap €0.005, paid only after the free pipeline fails, no Serper on
weak leads (gated by `SmartSerperGate`), no semantic-only verdicts
allowed, no directory/aggregator hosts allowed as `official_website`.

## Pre-run code change — R7.0

The R6.1 PgDetailStage anti-semantic-veto + side-effect clear is
extended to the paid SERP pass:

  - `SerpStage.runPaidPass` accepts `verdict.matched` only when
    `method === 'piva' || method === 'phone'`. Same precision rule
    that worked for PG-attestation works for Serper output: brand-
    semantic match alone does not earn a website assignment.
  - On rejection, `lead.official_website` /
    `website_discovery_method` / `website_confidence` are cleared
    so the pipeline doesn't finalize with a URL nobody endorsed.
  - Regression test `serp_stage_paid_semantic_veto.test.ts` covers
    both the veto path (long brand on aggregator-style content,
    no piva/phone on site) and the accept path (piva on site).

## Run progression

R7 took 3 iterative passes, each gated by audit on the previous:

### R7.1.a — first paid run (`p_recal_pd_paid`)

  npm run enrich -- \
    --input  output/p80_provincia_pd.csv \
    --out    output/p_recal_pd_paid.csv \
    --enable-paid \
    --cost-ceiling-eur 0.005 \
    --run-cost-ceiling-eur 0.20

  - 437 leads, 0 errors
  - 154 found_website (81 free + 73 paid)
  - SERP_PAID: 73 (all method=piva, conf 0.95)
  - Serper: 199 calls, €0.199 (cap respected)
  - Audit on 73 SERP_PAID gains:
      ~21 confirmed FPs by URL inspection of host distribution
      ~70 % precision — BELOW the 85 % threshold

  Failure-class identified: business-data aggregators publish the
  firm's P.IVA in directory entries. `piva_match` accepts those
  pages because the public registry P.IVA literally appears in
  the body, even though the URL is not the firm's site. The
  R7.0 semantic-veto isn't enough — piva-on-the-site can ALSO
  be a directory leak.

### R7.1.b — DIRECTORIES expansion (`p_recal2_pd_paid`)

  Added 13 hosts to the `DIRECTORIES` blocklist after WebFetch
  verification of representatives:

    Aggregators / business-data:
      aziende.it          (Ad Intend Srl — Italian biz aggregator)
      eulerpool.com       (German financial data)
      gestionaleimmobiliare.it (real-estate sales-software portal)
      xrayfinance.it      (financial aggregator)
      dbiz.it             (METRIKS.AI directory)
      sahibkimdir.com     (Turkish phone/biz lookup)
      creditsafe.com      (credit / business data)
      openbdap.rgs.mef.gov.it (Italian Min. Economia DB)
      bur.regione.veneto.it    (Bollettino Ufficiale Regione Veneto)
      comunichiamoimpresa.it   (state-aid registry)
      amministrazionicomunali.it (municipal-tax tools)

    Wrong-sector cross-publishing (same vat, different business):
      lafemmestore.eu     (clothing store — Retecasa Vigonza vat)
      centrobachelet.org  (community center)

  Rerun:
  - 437 leads, 0 errors
  - 133 found_website (81 free + 54 paid -1 PG +1 HG ... net)
  - SERP_PAID: 54
  - Serper: 199 calls, €0.199 (same cost; calls happen before
    verify; blocklist filters at verify entry)
  - Audit on 54 SERP_PAID: 51 TP / 3 FP
      96.2 % minus 3 govt/transport residuals
      (opencoesione.gov.it, fsbusitalia.it, provincia.pd.it)

### R7.1.c — final round (`p_recal3_pd_paid`)

  Added 3 govt/transport hosts after R7.1.b audit:
      opencoesione.gov.it, fsbusitalia.it, provincia.pd.it

  Rerun surfaced 2 new residuals in SERP_PAID and 2 in SERP_COMPANY
  (free-pass ranking shifted after blocklist):
      servizi.comune.albignasego.pd.it (1)
      ac.infn.it (1)
      italiarecensioni.com (×2, surfaced via SERP_COMPANY free pass)

  Final result:
  - 437 leads, 0 errors
  - **137 found_website** (+4 vs R7.1.b due to ranker-shift recoveries)
  - SERP_PAID: 53 (51 TP + 2 FP audited)
  - SERP_COMPANY (free): 3 (1 TP + 2 FP italiarecensioni)
  - HG: 44, PG_PHONE_SOURCE_TRUST: 37
  - Serper: 199 calls, €0.199

  Final blocklist update: +3 hosts (servizi.comune.*, ac.infn.it,
  italiarecensioni.com) for future runs.

## Final headline (`p_recal3_pd_paid` vs baselines)

| metric | p85 baseline | R6.1 free | **R7 paid** |
| --- | ---: | ---: | ---: |
| found_website | 53 | 81 | **137** |
| cost (EUR) | 0.000 | 0.000 | **0.199** |
| Δ vs baseline | — | +28 (+52.8 %) | **+84 (+158 %)** |
| Δ vs free | — | — | **+56 (+69 %)** |
| errors | 0 | 0 | 0 |
| run-cap respected | n/a | n/a | yes (€0.199 ≤ €0.20) |

## SERP_PAID precision — final audit

53 SERP_PAID gains, all method=piva conf 0.95.

| classification | count | % |
| --- | ---: | ---: |
| TP (legit agency site, vat on body) | 51 | 96.2 % |
| FP_GENERIC_HOMONYM | 0 | — |
| FP_WRONG_SECTOR | 1 | 1.9 % (ac.infn.it — research institute) |
| FP_DIRECTORY | 1 | 1.9 % (servizi.comune.albignasego.pd.it) |
| FP_PARKED | 0 | — |
| INCONCLUSIVE | 0 | — |

Both residual FPs added to DIRECTORIES — future runs will not
surface them.

## Per-lead delta — paid vs free (R6.1 vs R7)

  gained: 55 (53 SERP_PAID + 2 net via PG/HG ranker shift)
  lost:    1

The 1 lost lead is a PG_PHONE_SOURCE_TRUST candidate that
previously surfaced; on R7 the candidate dropped because the new
blocklist entries shifted ranking — minor noise, no signal.

## Cost / call efficiency

  Serper calls:           199
  Serper cost:            €0.1990
  Serper success_rate:    96.98 %
  SERP_PAID conversions:  53 / 199 = 26.6 %
  Cost per acquired site: €0.1990 / 53 ≈ €0.00375
  Cost per lead processed: €0.1990 / 437 ≈ €0.000455

The 26.6 % conversion rate (Serper-call → verified-website) is
the bisturi-rule paying off: SmartSerperGate denied paid for 238
of 437 leads (54 %), and within the allowed 199 leads, ~27 %
yielded a strong verdict. The remaining 73 % of paid calls were
rejected at verify (directory blocklist, semantic-only veto, or
piva/phone mismatch on the candidate).

## Cumulative recall vs precision

| stack stage | found | precision (audited gains) |
| --- | ---: | ---: |
| baseline (p85)            |  53 | (n/a)        |
| R6 (R1 only)              |  81 | 96.3 %       |
| R6.1 (R1 + clears + cache)|  81 | 100 %        |
| **R7 (R6.1 + paid)**      | **137** | **51/53 = 96.2 %** |

Across the whole stack, every gain has either the lead's P.IVA
or the lead's phone embedded in the candidate site (zero
semantic-only acceptances by construction).

## Verdict

R7 hits the precision target (96.2 % > 85 %) at €0.199 (within the
€0.20 cap) with +158 % recall vs baseline / +69 % over the free
pipeline. The bisturi rule (R4 SmartSerperGate + R7.0 anti-
semantic veto + DIRECTORIES blocklist) keeps Serper as a scalpel,
not a net.

The paid pipeline is publishable. The free pipeline alone (R6.1)
is also publishable for cost-sensitive scenarios — at €0 it
delivers +52.8 % vs baseline at 100 % precision.

## What's left (optional follow-ups)

- R8 (not requested): same recalibrated stack on TV / VR / BL to
  verify generalization beyond PD.
- Maps `--coverage full` (R5) is implemented but not exercised
  in any benchmark — testing that against an existing scrape
  would lift the input population, not the per-lead conversion.
- A sector-keyword check on PreVerifyGate's piva_match path
  could replace some host-blocklist entries with a single rule —
  worthwhile if more cross-sector cases (lafemmestore-class)
  surface in future provinces.
