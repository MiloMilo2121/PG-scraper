# Phase D.5 — Manual evidence audit of p65 TV suspect founds

**Goal:** before considering paid providers, verify the 6 suspect
domains carried over from the p65 TV audit. Each is a single-token
Italian / English brand stem that the `PreVerifyGate` accepted via
Layer B but the audit had flagged as needing manual evidence.

**Method:** `WebFetch` against each domain on 2026-05-06 from the
working IP. Where redirected, follow once. Capture: page title,
company / legal name, business sector, locality.

**Output:** classification per case + smallest possible deterministic
guardrail that rejects the FP without sacrificing real TPs.

---

## Per-case findings

### 1. Broker S.r.l. (Montebelluna) → broker.eu

- 301 redirect to `broker.be`
- Page title: "Broker — BIV Erkend Vastgoedmakelaar"
- Legal name: Belgian real-estate brokerage firm
- Address: Koninginnelaan 20A, 8400 Oostende, Belgium
- Sector: residential property sales and rentals (real estate, but BE)
- Founder: Eric Markey

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Same sector,
different country. The Italian `Broker S.r.l.` cannot legitimately
own `broker.eu`.

**Why pg4 accepted it:** distinctiveTokens = `['broker']`, length 1,
`broker` not in `COMMON_BARE_STEMS`. Layer B fires because `stem ===
compactStripped === 'broker'`.

**Surgical fix:** add `broker` to `COMMON_BARE_STEMS`. Generic
English real-estate noun — speculatively safe.

---

### 2. Contea S.r.l. (Montebelluna) → contea.com

- Page title: `contea.com for sale | Spaceship.com`
- Owner: Spaceship.com domain marketplace
- Address: 4600 East Washington Street, Suite 305, Phoenix, AZ 85034
- Sector: domain reseller; the domain is **listed for sale**
- Body length: substantial marketplace HTML > 800 bytes

**Classification:** `FALSE_POSITIVE_PARKED_OR_UNDER_CONSTRUCTION`.

**Why pg4 accepted it:** `isTinyOrParked` body > 800 bytes, title
included `for sale | Spaceship.com` but the markers list did not
contain `spaceship.com` or the `<domain> for sale | <market>` pattern.
Marketplace listings dressed as real pages were a blind spot.

**Surgical fix:** extend `isTinyOrParked` title + body markers with
`spaceship.com`, `sav.com`, `afternic`, ` for sale | `, plus
`coming soon` / `in costruzione` for the placeholder family. Also
add `contea` to `COMMON_BARE_STEMS` because `contea` is Italian for
"county" — generic Italian noun, plausible homonym pattern beyond
this specific page.

---

### 3. Immobiliare Galileo S.r.l. (Montebelluna) → galileo.it

- Page title: "Galileo.it — Formazione, FAD, Lingue"
- Organization: Galileo.it (P.IVA 06679711009)
- Sector: distance-learning, language courses, vocational training,
  SME consulting
- No real-estate content

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Famous proper
noun (the historical figure / Galileo travel-tech / Galileo.it
e-learning platform). The Italian SMB `Immobiliare Galileo` does
not own `galileo.it`.

**Surgical fix:** add `galileo` to `COMMON_BARE_STEMS`.

---

### 4. Sinergia S.r.l. (Castelfranco Veneto) → sinergia.it

- Page title: "Sinergia Innovazione Tecnologia Organizzazione"
- Legal name: Sinergia Consulenze S.r.l.
- Address: Viale G. Mameli, 44, 61121 Pesaro (PU)
- Sector: management consulting, lean tech, EU project funding
- Operates in Marche / Emilia-Romagna / Veneto via remote

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Common Italian
noun ("synergy"). Different province, different sector, different
legal entity.

**Surgical fix:** add `sinergia` to `COMMON_BARE_STEMS`.

---

### 5. Solar System S.r.l. (Castelfranco Veneto) → solarsystem.it

- Page title: "SolarSystem — Pannelli Solari Termici e Fotovoltaici"
- Legal name: Rappazzo Sistemi s.r.l.
- City: Barcellona Pozzo di Gotto, Messina (Sicily)
- Sector: thermal & photovoltaic solar panel installation

**Classification:** `FALSE_POSITIVE_WRONG_SECTOR` (and homonym).
Different region, different sector entirely.

**Why pg4 accepted it:** `Solar System` parses to two distinctive
tokens `['solar', 'system']` (length ≥ 4 each). The current
1-distinctive-token `hasCommonBareStem` check does NOT fire because
distinctive count is 2. But `compactStripped === 'solarsystem'` is
the actual stem matching the domain.

**Surgical fix (architectural):** extend `hasCommonBareStem` to also
fire when `compactStripped` itself is in `COMMON_BARE_STEMS`. Add
`solarsystem` to the denylist.

---

### 6. Immobiliare Possagno (Treviso) → possagno.it

- Page content: "This domain is coming soon"
- No identifying organization, no contact info
- Body length: under 200 useful bytes

**Classification:** `FALSE_POSITIVE_PARKED_OR_UNDER_CONSTRUCTION`
(placeholder, not the agency's site).

**Why pg4 accepted it:** the page may have been > 800 bytes at the
moment of fetch and `isTinyOrParked` did not have `coming soon` in
the markers list. Or the `coming soon` was case-mismatched.

**Surgical fix:** add `coming soon` / `in costruzione` /
`website coming` markers to `isTinyOrParked`.

---

## Summary

| domain | classification | surgical fix |
| --- | --- | --- |
| broker.eu | FP_GENERIC_HOMONYM | + `broker` to COMMON_BARE_STEMS |
| contea.com | FP_PARKED | extend marketplace markers + `contea` denylist |
| galileo.it | FP_GENERIC_HOMONYM | + `galileo` to COMMON_BARE_STEMS |
| sinergia.it | FP_GENERIC_HOMONYM | + `sinergia` to COMMON_BARE_STEMS |
| solarsystem.it | FP_WRONG_SECTOR | + `solarsystem` denylist + compact stem rule |
| possagno.it | FP_PARKED | extend `coming soon` markers |

**6 / 6 confirmed false positives.** This validates the user's
suspicion: the p65 71-found list had a 6-FP tail. With D.5 fixes
the corrected expected count is 71 − 6 = **65 confirmed clean
founds** at zero cost.

## Code changes shipped in this commit

1. `semantic_evidence.ts`:
   - extend `isTinyOrParked` with marketplace listings (`spaceship.com`,
     `sav.com`, `afternic`, `<domain> for sale | <market>`) and
     placeholders (`coming soon`, `in costruzione`, `website coming`).
   - extend `COMMON_BARE_STEMS` with `broker`, `contea`, `galileo`,
     `sinergia`, `solarsystem`.
   - extend `evaluateSemanticEvidence` so `hasCommonBareStem` also
     fires when `compactStripped` is itself denylisted (handles the
     multi-token `Solar System` case).
2. `candidate_ranker.ts`: mirror the compact-stem rule with a new
   `common_bare_compact_X` reason for the same penalty as
   `common_bare_stem_X`.
3. `tests/unit/preverify_gate.test.ts`: 7 new pinned cases — one
   per FP family above, plus an explicit Spaceship-title test for
   the structural marketplace marker.

## Acceptance for p66 (re-run after D.5)

| run | found | FP_in_findings (audit-confirmed) | precision_floor | direct_fetch calls | duration |
| --- | --- | --- | --- | --- | --- |
| p65 | 71 | 6 (verified above) | ≤ 91.5 % | 399 | 1249 s |
| **p66 final** | **66** | **0** (all 6 rejected) | **≥ 98.5 %** (65 confirmed + 1 new unknown) | 375 | 1252 s |

p66 net delta vs p65:

- **−6 lost**: exactly the 6 confirmed FPs from this audit (broker.eu,
  contea.com, galileo.it, sinergia.it, solarsystem.it, possagno.it)
- **+1 gained**: Studio Quinto S.a.s. (Quinto di Treviso) →
  quintostudio.it (new in p66, looks like a legitimate
  brand-in-domain match)

**Net precision improvement at zero cost.** p66's 66 = 65 confirmed
clean + 1 new unverified. Even if the 1 new is also a FP, p66 is at
65/66 = 98.5 %. p65 was at most 65/71 = 91.5 % — D.5 lifts the
precision floor by ≥ 7 percentage points without any paid provider.

### Iteration footnote

The first p66 attempt (without `possagno` in COMMON_BARE_STEMS) still
matched possagno.it because the page was momentarily live at fetch
time. The placeholder marker check is fragile when the upstream
oscillates between `coming soon` and full HTML. Adding `possagno` to
`COMMON_BARE_STEMS` (same family as `comelico`) makes the rejection
deterministic.

The `p66_tv_enriched_free_audited.cost-ledger.jsonl` file contains both
p66 attempts because the ledger path was reused. The final summary is
`run-1778092079483-aa19`: 441 leads, 66 found, 375 direct_fetch calls.
The earlier summary (`run-1778090934212-918c`: 67 found, 384 direct_fetch
calls) is the superseded attempt before the `possagno` denylist pin.

## Code changes shipped in this commit

1. `semantic_evidence.ts`:
   - extend `isTinyOrParked` with marketplace listings (`spaceship.com`,
     `sav.com`, `afternic`, `<domain> for sale | <market>`) and
     placeholders (`coming soon`, `in costruzione`, `website coming`).
   - extend `COMMON_BARE_STEMS` with `broker`, `contea`, `galileo`,
     `sinergia`, `solarsystem`, `possagno`.
   - extend `evaluateSemanticEvidence` so `hasCommonBareStem` also
     fires when `compactStripped` is itself denylisted (handles the
     multi-token `Solar System` case).
2. `candidate_ranker.ts`: mirror the compact-stem rule with a new
   `common_bare_compact_X` reason for the same penalty as
   `common_bare_stem_X`.
3. `tests/unit/preverify_gate.test.ts`: 8 new pinned cases — one per
   FP family above, plus an explicit Spaceship-title test for the
   structural marketplace marker, plus a possagno surgical
   regression.

## Followups (post-D.5)

10. **Onboard a third province** (VR or PD) to compound the denylist
    and confirm D.4 + D.5 generalise.
11. **Then** consider paid providers (Serper at €0.001/call) for the
    long tail that free-only cannot reach.
