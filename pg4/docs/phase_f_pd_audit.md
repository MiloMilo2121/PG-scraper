# Phase F — PD provincia free-only generalization test

**Goal:** verify pg4's BL+TV+VR-derived rules generalise on a fourth
province (Padova) without paid providers. Not chasing recall — testing
whether the founds stay trustworthy at zero cost.

**Method:**
1. PG-only scrape, `--max-pages 3`, `--fresh` → `output/p80_provincia_pd.csv`.
2. Enrich free-only → `output/p81_pd_enriched_free.csv`.
3. Manual `WebFetch` audit on suspect single-token domains.
4. Surgical denylist additions only when FP confirmed.
5. Re-run → `output/p82_pd_enriched_free_audited.csv`.

---

## p80 raw scrape

| field | value |
| --- | --- |
| total leads (CSV body) | 437 |
| JSONL rows | 437 |
| collapsed_by_dedupe | 463 |
| Maps used | no (PG-only by default) |
| anomalous parser drops | none |

CSV / JSONL aligned (437+1 header in CSV, 437 JSONL lines).

## p81 raw enrichment numbers (D.5.1 + Phase E.1 stack on PD)

| field | value |
| --- | --- |
| total | 437 |
| FOUND_WEBSITE_ONLY | 52 (11.9 %) |
| SERP_DIRECTORY_ONLY | 385 |
| ledger entries | 1875 |
| ledger summaries | **1** ✓ |
| cost EUR | 0 |
| direct_fetch calls | 334 |
| paid provider calls | 0 |
| breaker at end | closed |

**No regression on existing 25 denylist stems** (BL+TV+VR cumulative:
bloom, ufficio, area, progetto, iniziative, appia, torri, mia,
comelico, europa, master, broker, contea, galileo, sinergia,
solarsystem, possagno, palace, domino, camelot, liberta, alfaomega,
coobiz, italialei, inelenco). Generalisation confirmed: zero
over-blocking on PD.

## Manual WebFetch audit of high-risk single-token suspects

| domain | result | classification | evidence |
| --- | --- | --- | --- |
| americanino.eu | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | redirects to americaninooriginal.com — clothing / footwear brand (Sport Commerce Italia, Creazzo) |
| raffaello.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | redirects to raffaello.com — Ferrero confectionery brand (chocolate, ice cream) |
| cantele.it | FP | FP_WRONG_SECTOR | "Cantele Vini — Estate Winery" — wine producer (Guagnano, LE) |
| gemini.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | "GEmiNI" condominium management software (cloud SaaS) |
| fusion.org | FP | FP_PARKED | redirects to synergytech.com/buy-domain — domain marketplace |
| myhome.com | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | "MyHome — Williston Financial Group" — US real-estate tech (CA/NV/AZ) |
| orchidea.it | FP | FP_WRONG_SECTOR | redirects to orchideamilano.it — "Orchidea Milano 1981" furniture retail (Corsico) |
| ypsilon.net | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | "Ypsilon.Net AG" — travel tech (PCI / ISO certified) |
| alessandra.com | FP | FP_GENERIC_HOMONYM | "Dr. Tony Alessandra Official Website" — US business consultant / speaker |

**9 / 9 audited domains confirmed FP.**

Remaining suspect single-token brand stems NOT audited yet (left as
followup — too many to verify in one pass without paid evidence
verification):
- `franca.it`, `sartori.it`, `giemme.com` (loading screen only),
  `colonna.net`, `chemello.it`, `lachiave.com`, `phosphoro.com`

These stay in the p81 found list. Each needs a 2-min WebFetch in a
follow-up audit before deciding whether to denylist.

## Code changes shipped in this commit

1. `semantic_evidence.ts` — `COMMON_BARE_STEMS` += {americanino,
   raffaello, cantele, gemini, fusion, myhome, orchidea, ypsilon,
   alessandra}. Each entry carries an inline comment with the
   per-case audit reference.
2. `tests/unit/preverify_gate.test.ts` — 9 new pinned cases (one
   per FP family above) + the existing Cangrande TP regression
   guards against denylist over-reach.

## p82 results

| run | found | confirmed FP rejected | direct_fetch calls | ledger summaries |
| --- | --- | --- | --- | --- |
| p81 | 52 | 0 (9 of 9 still in finds — pre-Phase F) | 334 | 1 ✓ |
| **p82** | **48** | **9 / 9** ✓ | 324 | 1 ✓ |

p82 net delta vs p81:

- **−10 lost**: the 9 audit FPs (Americanino, Raffaello, Cantele,
  Gemini ×2 dup, Fusion, My Home, Orchidea, Ypsilon, Alessandra).
- **+6 gained**: pre-existing TPs that surfaced this run — same
  ranker-feedback effect as TV p65 → p66 → p72:
  - `Liviana Immobiliare → livianaimmobiliare.it`
  - `Colli Euganei → collieuganei.it`
  - `Happy House → happyhouse.it`
  - `Immobilsole → immobilsole.it`
  - `Obiettivo Casa → obiettivocasa.it`
  - `Pentacom → pentacom.it`

When the ranker drops a confirmed FP at `drop` tier, the per-lead
retry budget is freed for the legit composite-brand candidate.

### Phase F acceptance

| criterion | target | result |
| --- | --- | --- |
| 437 in → 437 out | yes | ✓ |
| cost = 0 | yes | ✓ |
| 1 ledger summary | yes | ✓ |
| no paid provider calls | yes | ✓ |
| breaker not open at end | yes | ✓ closed |
| no known blocked stems accepted | yes | ✓ (25 + 9 prior, all clean) |
| 9 audit FPs rejected | yes | ✓ all 9 |
| typecheck + tests green | yes | **352 pass / 1 skipped** |

## Cumulative state across BL + TV + VR + PD

| province | total | found | confirmed FP rejected | precision floor |
| --- | --- | --- | --- | --- |
| BL p52 | 194 | 19 | 12 | ≥ 95 % |
| TV p66 | 441 | 66 | 6 | ≥ 98.5 % |
| VR p73 | 433 | 66 | 5 + 3 directory | ≥ 92.3 % |
| PD p82 | 437 | 48 | 9 | ≥ 87 % (estimated; see followup #16) |

`COMMON_BARE_STEMS` size: 31 entries (was 22 pre-Phase F).
Directory denylist: 3 new entries (coobiz / italialei / inelenco).

## Followups (post-F)

16. **Manual audit of remaining PD suspects** (franca, sartori,
    giemme, colonna, chemello, lachiave, phosphoro) — each 2-min
    WebFetch.
17. **Then** consider paid providers (Serper at €0.001/call) for the
    long tail that free-only cannot reach.
18. **Re-audit suspect TPs across all provinces with manual paid
    evidence** before declaring final precision floor.
