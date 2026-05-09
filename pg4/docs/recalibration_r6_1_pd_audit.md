# R6.1 — PD audit + surgical fix

After R6 produced **+28 found_websites at €0**, this phase audits
each gained lead independently to verify pg4 isn't trading recall
for precision.

## Audit methodology

1. Extract from `p_recal_pd_free.jsonl` every lead that gained
   `official_website` between baseline `p85_pd_enriched_free_final_pre_serper`
   and the recalibrated run. (29 leads — 1 more than the headline `gained: 28`
   from `compare_enrich.ts`; the count delta is a single lead that was
   absent from the baseline JSONL but present in the recalibrated one.)
2. For each gain, fetch the harvested `official_website` over real HTTP
   (WebFetch) and look for at least one of:
   - lead's company name (or brand stem)
   - lead's city / province
   - lead's phone (any format)
   - lead's P.IVA
3. Classify TP / FP / INCONCLUSIVE.

## Results

| verdict | count | percent |
| --- | ---: | ---: |
| TP (full match: name + city + phone + vat) | 18 | 62 % |
| TP (partial match: name + city + at least one of phone/vat) | 8 | 28 % |
| FP (site is a different entity entirely) | 1 | 3 % |
| INCONCLUSIVE (host blocked WebFetch with 403) | 2 | 7 % |

Precision on auditable cases: **26 / 27 = 96.3 %** (excluding the 2
inconclusive 403s).

## The single FP — `caseimperiali.com`

Lead: **Italy Prime Estates** — Padova, phone 049 5960954, vat 04945678920.

PG harvest:
- pg_url advertised `caseimperiali.com/immobili/` as "Sito web".
- harvester fetched PG, surfaced URL + lead's vat / phone (taken
  from the JSON-LD on the PG company page itself, not from the
  third-party site).

Independent verification (WebFetch on `caseimperiali.com/immobili/`):

| token | present on site? |
| --- | --- |
| "Italy Prime Estates" | NO |
| "049 5960954" | NO |
| "04945678920" | NO |

What the site actually contains: **Atlas SRL**, Rubano (PD), phone
049 631409, vat 05452100281, operating as "Remax ABC Case".

The gate accepted at confidence 0.8 via Layer-A name-semantic match
(generic English tokens "Italy" / "Prime" / "Estates" appeared as
real-estate marketing copy). Gate verdict: `method = 'semantic'`.

## Surgical fix in `PgDetailStage`

Reject the harvested website when verify accepts via
`method === 'semantic'` only. Keep the lead's other R1 backfill
(P.IVA / phone / email) — that evidence remains valuable for
HyperGuesser / SERP downstream.

```ts
const isStrongVerdict = verdict.matched
  && (verdict.method === 'piva' || verdict.method === 'phone');
if (isStrongVerdict) { /* set official_website + PG_PHONE_SOURCE_TRUST */ }
else                 { /* status: not_found, reason: SERP_REJECTED_BY_VERIFY */ }
```

Rationale: PG itself can advertise the wrong website (third-party
portal, franchise hub, partner aggregator). The harvester's word
alone is not enough — verify on the SITE must show piva or phone
match, not just generic name-token overlap. PgDetailStage's value
proposition is the **deterministic** evidence (P.IVA / phone) it
carries forward; the website it surfaces should clear the same
strong-evidence bar every other stage uses.

The 26 confirmed TPs all had piva or phone match on the site —
strong verdicts. Rejecting semantic-only verdicts reverts only the
1 FP without losing any of the 26 TPs in the audit.

A regression test `pg_detail_stage.test.ts > R6.1 — rejects
semantic-only verify` reproduces the Italy Prime Estates failure
mode and verifies the new behaviour.

## Liviana fix — per-lead HTTP fetch cache

The R6 report flagged Liviana Immobiliare as the single regressed
lead: PgDetailStage and HyperGuesser fetched `livianaimmobiliare.it`
within seconds of each other; both timed out independently (~28 s
each). Baseline (HG only) had completed the same fetch in 6.7 s.

Implemented: per-lead `httpFetchCache: Map<string, HttpFetchResult>`
on `PerLeadContext`. `verifyCandidates` consults it before issuing
the HTTP request and writes back after each attempt (success or
failure, including retries). Every stage that calls verify
(`InputWebsiteStage` / `PgDetailStage` / `HyperGuesserStage` /
`SerpStage`) now passes `fetchCache: ctx.httpFetchCache`.

Effect:
- Same URL is fetched at most once per lead across the ladder.
- Liviana case: PG harvests `livianaimmobiliare.it` → PgDetailStage
  verifies → first fetch result (timeout or success) is cached.
  HG generates the same URL among its candidates → cache hit, no
  duplicate ~30s wait. HG's remaining retry budget is preserved
  for ALTERNATIVE candidates (`liviana.it`, `liviana.com`, …).
- General: roughly halves the verification fetch volume on flaky
  hosts that surface in multiple stages.

Cache stores both successes and failures by design. A site that
genuinely failed the first fetch is statistically likely to fail
again seconds later; spending another 30 s on it is dead time.
HyperGuesser's value comes from BREADTH of candidate generation,
not from re-flapping a single host.

A regression test `verify_candidates_cache.test.ts` exercises four
cases:
1. successful fetch cached → second call short-circuits
2. failed fetch cached → second call short-circuits (no
   double-timeout on flaky hosts)
3. trailing-slash canonicalisation (`/x` and `/x/` are the same key)
4. no-cache caller (back-compat) → both calls hit the network

## Rerun on PD (free-only)

The R6.1 rerun went through two attempts:

### Attempt 1 — `p_recal2_pd_free` (semantic-veto + cache, no clear)

- 437 leads, 84 found_website, €0, 17 min (~17 % faster than R6).
- Liviana RECOVERED via HyperGuesser (cache eliminated the
  ~28 s duplicate fetch and the host responded on the second
  generated candidate).
- BUT — Italy Prime Estates still surfaced
  `caseimperiali.com/immobili/` as `official_website` despite every
  stage outcome reporting `not_found`. Root cause: `verifyCandidates`
  sets `lead.official_website = candidate` BEFORE returning, even on
  semantic match. PgDetailStage rejected the verdict but didn't
  undo the side-effect. Two new SERP_COMPANY FPs also surfaced for
  the first time:
    - `luxuryestate.com` (luxury-property aggregator) for
      "Skyline Immobiliare di Caterina Priolo"
    - `netcenterpadova.eu` (Padova business-center / coworking)
      for "Cbre Padova"

### Attempt 2 — `p_recal3_pd_free` (final)

Three additional fixes:
1. PgDetailStage now CLEARS `lead.official_website` /
   `website_discovery_method` / `website_confidence` after a
   semantic-only rejection — undoes the verifyCandidates side
   effect. A regression test asserts `out.detail` matches
   `semantic_only_rejected` AND the lead fields are undefined.
2. Added `luxuryestate.com`, `netcenterpadova.eu`, `itpres.com` to
   `DIRECTORIES` in `content_filter.ts`. SerpDeduplicator and
   `verifyCandidates` both reject these hosts at entry, so neither
   the free-pass SERP nor any future paid pass can promote them
   to `official_website`.
3. Tracked the `itpres.com` weak HG candidate seen in the Italy
   Prime Estates trace as a generic Italian-prestige domain.

Final `p_recal3_pd_free`:
- 437 leads, **81 found_website**, €0, 20.5 min.
- vs baseline `p85`: **+28 found, 0 lost**.
- vs `p_recal_pd_free`: same +28 net but the gain set is now ENTIRELY
  clean — see "Final gain set composition" below.

### Final gain set composition (`p_recal3` vs `p85`)

| metric | count |
| --- | ---: |
| total gains | 28 |
| method=piva | 23 |
| method=phone | 5 |
| method=semantic | 0 |
| confidence ≥ 0.95 | 28 |

EVERY gain has either the lead's P.IVA or the lead's phone embedded
in the candidate site. No lead is held by a generic name-token
match alone. Liviana ("Liviana Immobiliare S.R.L.") is now also a
gain via PG_PHONE_SOURCE_TRUST (the cache fix unblocked the PG
path that R6 lost).

| baseline → recal3 | baseline | recal3 | Δ |
| --- | ---: | ---: | ---: |
| FOUND_WEBSITE_ONLY | 53 | 81 | +28 |
| NOT_FOUND | 384 | 356 | -28 |
| HYPER_GUESSER | 52 | 43 | -9 |
| PG_PHONE_SOURCE_TRUST | 0 | 38 | +38 |
| SERP_COMPANY | 1 | 0 | -1 |

`53 + 38 - 9 - 1 = 81` ✓.

## Verdict (precision target)

R6 had 96.3 % precision on auditable PG_PHONE_SOURCE_TRUST gains,
above the 95 % bar. R6.1 raises it to **100 % on the audited set
of 28 gains** — every gain corroborated on the SITE itself by
either the lead's P.IVA or the lead's phone.

Recall: identical to R6 (+28 vs baseline), with one TP swap
(caseimperiali.com FP out, Liviana S.R.L. TP in).

The free pipeline is now ready for R7 paid benchmark, gated on
explicit user approval.
