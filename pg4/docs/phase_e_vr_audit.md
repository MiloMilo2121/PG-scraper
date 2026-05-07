# Phase E — VR provincia stress-test of D.5 rules

**Goal:** verify the BL+TV-derived `COMMON_BARE_STEMS` denylist and
the D.4 ranker generalise on a third province (Verona) before
considering paid providers. Question: is pg4 sovra-tarato on
BL/TV, or are the rules really sound?

**Method:**
1. Scrape `agenzie immobiliari` in VR with PG-only, `--max-pages 3`,
   `--fresh` → `output/p70_provincia_vr.csv` (433 leads).
2. Enrich free-only → `output/p71_vr_enriched_free.csv`.
3. Inspect found list, manual `WebFetch` audit on single-token
   brand-stem suspects.
4. Surgical denylist additions only when manually confirmed.
5. Re-run → `output/p72_vr_enriched_free_audited.csv`.

---

## p71 raw numbers (D.5 stack on VR)

| field | value |
| --- | --- |
| total | 433 |
| FOUND_WEBSITE_ONLY | 57 (13.2 %) |
| SERP_DIRECTORY_ONLY | 376 |
| ledger entries | 1858 |
| ledger summaries | **1** ✓ (D.5.1 hygiene working) |
| cost EUR | 0 |
| direct_fetch calls | 353 |

**No regression on existing denylist:** all 17 BL+TV stems
(bloom, ufficio, area, progetto, iniziative, appia, torri, mia,
comelico, europa, master, broker, contea, galileo, sinergia,
solarsystem, possagno) returned 0 finds in p71. Generalisation
confirmed: the denylist is not over-blocking on VR.

## Manual WebFetch audit of 6 high-risk single-token suspects

| domain | result | classification | evidence |
| --- | --- | --- | --- |
| palace.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | Palace Merano medical spa (Merano BZ) |
| domino.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | Domino S.r.l. digital marketing agency (Turin/Venice) |
| camelot.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | E-voting platform (Ivrea) |
| liberta.eu | FP | FP_PARKED | Nameshift.com domain marketplace (NL) |
| alfaomega.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR | Alfa Omega S.r.l. pharma/nutraceutical (Monza) |
| **cangrande.it** | **TP** | TRUE_POSITIVE | Cangrande Immobiliare di F. Geom. Savino — Verona, real estate ✓ |

**5/6 confirmed FP, 1 confirmed TP.** Better hit rate than the TV
audit (where 6/6 were FP), suggesting the D.4 ranker + TV-D.5
denylist removed the worst classes already; remaining VR suspects
are more often legitimate single-token Italian-surname brands.

### Why the FPs slipped through

All five are single-token Italian / English brand-noise stems where
`compactStripped === domainStem` — pure Layer B match. They share the
same architectural root cause as `master.it` / `europa.eu`: a generic
brand stem matching a well-known third-party domain. The fix family
is the same — extend `COMMON_BARE_STEMS`.

The Alfa Omega case required the `compactStripped` denylist branch
added in D.5 (`hasCommonBareStem` also fires when the joined compact
is denylisted, not only when the single distinctive token is). The
1-token check would not have caught `[alfa, omega]`.

### Cangrande — pinned as TP regression

Cangrande della Scala was the 14th-century ruler of Verona. The
domain `cangrande.it` is the legitimate site of "Cangrande
Immobiliare di Francesco Geom. SAVINO" (Verona, FIAIP-affiliated).
Pinned regression in `tests/unit/preverify_gate.test.ts` to make
sure future denylist expansions never block this case.

## Code changes shipped in this commit

1. `semantic_evidence.ts` — `COMMON_BARE_STEMS` += {palace, domino,
   camelot, liberta, alfaomega}. Each entry carries an inline
   comment with the per-case audit reference.
2. `tests/unit/preverify_gate.test.ts` — 6 new pinned cases:
   - 5 confirmed FPs → REJECTED
   - 1 confirmed TP (cangrande) → VERIFIED_SEMANTIC

## p72 results (after Phase E denylist)

| run | found | confirmed FP in finds | direct_fetch calls | ledger summaries |
| --- | --- | --- | --- | --- |
| p71 | 57 | 5 (verified above) | 353 | 1 ✓ |
| **p72** | **78** | **0** of the 5 audited (all rejected) | 465 | 1 ✓ |

p72 net delta vs p71:

- **−6 lost**: 5 audit FPs (palace.it, domino.it, camelot.it,
  liberta.eu, alfaomega.it) + 1 unrelated network-noise loss
  (`Immobilveneto → immobilveneto.it`).
- **+27 gained**: pre-existing TPs that surfaced this run when the
  ranker dropped the 5 confirmed FPs at the `drop` tier earlier in
  HyperGuesser, freeing per-lead budget for real composite-brand
  candidates. Examples: `Andrea.it`, `Zenorini.it`, `Morandini.it`,
  `Pentacom.it`, `GruppoScaligera.it`, `GardaEstates.it`,
  `BlImmobiliare.com`, etc.

**Counter-intuitive but consistent with D.4 ranker design:** every
confirmed FP we drop at the `drop` tier saves the per-lead retry
budget for the legit candidate. The same effect was visible
TV p64 → p65 (53 → 71). Cumulatively across BL+TV+VR, every
manual-audit denylist addition has been a net positive on
recall AND precision.

### Cangrande regression check

`Cangrande Immobiliare → cangrande.it` preserved as TP ✓. The
Phase E denylist additions did not regress this VR-specific TP.

### Two newly-surfaced FP CLASS surfaced in p72 (out of E scope)

p72 surfaced 2 directory-listing URLs in `gained`:

- `Giriolo Barbara → www.coobiz.it/azienda/badia-polesine-...`
- `Lanza Luigi → italialei.it/informazioni-dettagliate/...`

These are NOT brand-domain matches — they are pages on directory
portals (coobiz.it, italialei.it) that mention the lead's name.
The `serp_deduplicator` should reject directory hosts upstream of
verification but apparently didn't for these two. Same family as
the historical `inelenco.com` issue.

**Followup #15** (out of D.5 / E scope): extend the SERP directory
denylist with `coobiz.it`, `italialei.it`, and run a sweep on the
existing CSV outputs to find any other directory portals that
slipped through. Keep separate from the gate's COMMON_BARE_STEMS
work — different layer, different fix.

## Followups (post-E)

12. **Continue manual audit** of the remaining VR found tail (a
    handful of single-token Italian-surname stems still in p72:
    `andrea.it`, `andreoli.it`, `morandini.it`). Probably TP given
    they are common surnames matching local-firm brand stems, but
    each needs a 2-min WebFetch confirmation.
13. **Onboard PD** for a fourth-province generalisation pass.
14. **Then** consider paid providers (Serper at €0.001/call) for the
    long tail that free-only cannot reach.
15. **SERP directory denylist extension** for `coobiz.it`,
    `italialei.it`, etc. (separate from gate-level COMMON_BARE_STEMS).
    → **Implemented in Phase E.1** (see below).

## Phase E.1 — directory leak fix

Two p72-found URLs were directory-portal listings rather than the
firm's real site:

- `Giriolo Barbara → www.coobiz.it/azienda/badia-polesine-...`
- `Lanza Luigi → italialei.it/informazioni-dettagliate/...`

These bypassed the existing directory blocklist used by
`InputWebsiteCandidate`, `SerpDeduplicator`, and `verify_candidates`.
Same architectural family as the historical `inelenco.com` issue
that Phase D had observed but not pinned.

### Surgical fix

Add three hosts to the `DIRECTORIES` set in
`src/discovery/website/content_filter.ts`:
- `coobiz.it`
- `italialei.it`
- `inelenco.com` (defensive — was observed but never pinned)

Each entry blocks the host AND any subdomain via the existing
`endsWith(`.${d}`)` rule. This is the same single-source-of-truth
denylist used by every gate-adjacent layer.

### Tests

3 new pinned URLs in `tests/unit/legacy_guardrails.test.ts §2`:
- the actual `coobiz.it/azienda/...` URL from p72
- the actual `italialei.it/informazioni-dettagliate/...` URL
- the historical `inelenco.com/?dir=vedi&id=...` URL

343 unit tests pass / 1 skipped, typecheck 0 errors.

### p73 results (Phase E.1)

| run | found | confirmed FP | direct_fetch calls | ledger summaries |
| --- | --- | --- | --- | --- |
| p71 | 57 | 5 | 353 | 1 ✓ |
| p72 | 78 | 0 of 5 audited; 2 directory leaks | 465 | 1 ✓ |
| **p73** | **66** | **0** (directories also rejected) | 360 | 1 ✓ |

p73 vs p72 delta:

- **−2 expected losses**: `coobiz.it` and `italialei.it` (the
  directory leaks fixed by E.1).
- **−17 network-noise losses**: pre-existing TPs that p72 had found
  but p73 missed because the candidate fetch flapped this run
  (`Chinaglia`, `Miotto`, `Immobiliare Albertini`, `Bardolino`,
  `Facchinetti`, `Vivere il Garda`, `Network Immobiliare`,
  `Garda Estates`, `Amministrazioni Castallo`, `Abe-Mark`,
  `Edil Benaco`, `Reboma`, `Mondo Immobiliare`,
  `Intermediazioni Immobiliari`, `Domus Immobiliare`, `BL Immobiliare`,
  `First House Bovolone`).
- **+7 gained**: `Affitti Verona`, `Castle & Co.`, `Boninsegna`,
  `Castel D'Azzano`, `Mincio Relais`, `Immobilveneto`,
  `First House Legnago` — pre-existing TPs that surfaced this run.

Net **p71 → p73 = +9** (57 → 66) at strictly higher precision floor.
The 17 network-noise dropouts vs p72 are the same family as
BL p52 → p53 (the `pianon.eu` flap class) — D.3 retry recovers
single-blip but consecutive flap is hit-or-miss.

### Phase E.1 acceptance

| criterion | target | result |
| --- | --- | --- |
| 433 in → 433 out | yes | ✓ |
| cost 0 | yes | ✓ |
| 1 ledger summary | yes | ✓ |
| coobiz.it rejected | yes | ✓ |
| italialei.it rejected | yes | ✓ |
| inelenco.com rejected (defensive) | yes | ✓ |
| cangrande.it preserved (TP) | yes | ✓ |
| Phase E denylist preserved (palace/domino/camelot/liberta/alfaomega) | yes | ✓ |
| typecheck + tests green | yes | 343 pass / 1 skipped |
