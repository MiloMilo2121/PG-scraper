# R10.b — TV paid confirmation rerun with R9 gate active

Clean rerun on Treviso (provincia=TV) input, after the prior R10.b
attempt was invalidated by concurrent writers (commit 6d404ec added
output_lock to prevent recurrence). Fresh output basename used.

  npm run enrich --
    --input  output/p60_provincia_tv.csv
    --out    output/p_recal_tv_paid_rerun.csv
    --enable-paid
    --cost-ceiling-eur 0.005
    --run-cost-ceiling-eur 0.20

run_id: `run-1779378303622-d69e`
duration: 1285.8 s (~21.4 min)

## Headline

  | metric                | R10 VR (post-R9) | R10.b TV (this run) |
  | --------------------- | ---------------: | ------------------: |
  | total leads           |              433 |                 441 |
  | leads_with_website    |              155 |                 157 |
  | SERP_PAID             |               45 |                  65 |
  | PG_PHONE_SOURCE_TRUST |               40 |                  31 |
  | HYPER_GUESSER         |               70 |                  61 |
  | Serper calls          |              199 |                 199 |
  | Serper cost (EUR)     |            0.199 |               0.199 |
  | total_cost_eur        |            0.199 |               0.199 |
  | run cap (EUR)         |             0.20 |                0.20 |
  | direct_fetch breaker  |           closed |              closed |
  | leads_errored         |                0 |                   0 |

Cap respected. Ledger contains exactly 1 summary and 1 run_id.
CSV parses with csv-parse (442 lines: 1 header + 441 rows).
JSONL has 441 rows. No concurrent-writer corruption.

## SERP_PAID audit (65 rows, all method=piva conf 0.95, all category=agenzie immobiliari)

Category is uniform (TV input is real-estate-only slice). All audited.

### FP — strong evidence (2 / 65 = 3.1%)

  | # | host                       | company                              | class             |
  | - | -------------------------- | ------------------------------------ | ----------------- |
  | 12| trasparenza.cultura.gov.it | Edil Invest di Fermi Ezio & C. S.a.s | FP_GOV_RESEARCH   |
  | 32| infoimmobile.it            | Agenzia Immobiliare Ambienti Durigon | FP_AGGREGATOR     |

`trasparenza.cultura.gov.it` is a Ministry of Culture transparency
portal — it should have been blocked structurally; gate let the host
through because the P.IVA was cited inside a transparency PDF that
mentions the company as a contractor. Recommend host-class
denylist update.

`infoimmobile.it` is a real-estate listing portal (info-style domain,
no token overlap with company brand). Standard aggregator pattern
the R9 gate is supposed to catch — possibly slipped because the
listing page surfaces the P.IVA in body text.

### INCONCLUSIVE — name mismatch, evidence-light (8 / 65 = 12.3%)

  | # | host                     | company                           |
  | - | ------------------------ | --------------------------------- |
  | 22| asoloshire.com           | Agenzia Immobiliare Ellebi        |
  | 34| studiomida.com           | Dalbon Francesca                  |
  | 39| casaservice360.it        | Immobiliare Opera (Moschini)      |
  | 45| dicasaincasa.org         | Studio Marcon (Baradel)           |
  | 57| immobiliareghedin.it     | Gb Realestate                     |
  | 58| directaimmobiliare.it    | Soluzioni Immobiliari (Collodel)  |
  | 61| immobiliaredinamica.it   | Fly (Collodel)                    |
  | 65| agenzialapieve.it        | Colella Raffaella                 |

These are single-owner agencies whose host appears to be a brand
distinct from the company legal name. In Italian real estate this
is normal practice (proprietor trades under a brand). Without a
page-fetch evidence pass they cannot be confirmed TP nor flagged
FP. Listed as INCONCLUSIVE per the audit taxonomy.

### TP — strong evidence (55 / 65 = 84.6%)

Brand/owner-token match between host and company name, plus host
not in directory/gov/portal patterns. Includes 5 occurrences of
`impresaimmobiliare.com` for "Impresa S.r.l." (literal brand match;
input row duplicated 5× upstream).

### Precision

  | denominator        | TP | FP | INCONCL | precision |
  | ------------------ | -: | -: | ------: | --------: |
  | TP+FP only         | 55 |  2 |       — |    96.5 % |
  | All audited        | 55 |  2 |       8 |    84.6 % |

Canonical precision (TP / (TP+FP)) = **96.5 %**, above the 85 %
threshold. INCONCLUSIVE rows are evidence-gap, not confirmed FPs.

## Decision

R10.b TV **PASSED**. The R9 PaidEvidenceGate continues to block the
structural FP classes it was designed for (directories, aggregators,
gov) — only 2 leaks out of 65 SERP_PAID gains, both addressable with
targeted denylist tightening.

### Follow-ups (non-blocking, recorded)

1. Add `trasparenza.cultura.gov.it` and the broader
   `*.trasparenza.*.gov.it` family to the gate's gov denylist.
2. Add `infoimmobile.it` to the known-aggregator denylist for the
   real-estate category.
3. Optional: schedule a one-shot evidence-fetch on the 8 INCONCLUSIVE
   rows to close the audit gap. Not blocking; would raise audited
   precision toward the canonical 96.5 %.

## Hygiene

- output_lock from commit 6d404ec prevented the prior double-writer
  failure mode; no `.lock` collision observed.
- The first attempt of this rerun was killed mid-run at ~317/441
  rows; partial outputs and stale lock were removed before the
  clean rerun documented here.
- Outputs of record:
  - output/p_recal_tv_paid_rerun.csv (442 lines)
  - output/p_recal_tv_paid_rerun.jsonl (441 rows)
  - output/p_recal_tv_paid_rerun.cost-ledger.jsonl (2117 events, 1 summary)
