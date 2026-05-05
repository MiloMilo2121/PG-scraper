# Phase C — Free Enrichment Accuracy Audit (BL province, 26 found)

> Evidence-based per-lead audit of all 26 leads emitted as `FOUND_WEBSITE_ONLY` by the Phase B free-only enrichment of `output/p43_provincia_bl.csv`. Each verdict is grounded in: HTTP fetch of the matched `official_website`, page title, body sector signal (`immobiliare` vs cartoleria/falegnameria/etc.), `business_city` presence in body, lead-phone digit-match in body, and parking/for-sale markers. No paid APIs, no LLM, no browser engine. Lightweight `curl -sL --max-time 8 --max-filesize 100k`, one fetch per lead.

## 1. Executive summary

| Bucket | Count | % of 26 |
|---|---|---|
| TRUE_POSITIVE | **11** | 42.3% |
| FALSE_POSITIVE_GENERIC_HOMONYM | 7 | 26.9% |
| FALSE_POSITIVE_WRONG_SECTOR | 3 | 11.5% |
| FALSE_POSITIVE_DIRECTORY_OR_PORTAL | 1 | 3.8% |
| FALSE_POSITIVE_PARKED_OR_UNDER_CONSTRUCTION | 1 | 3.8% |
| INCONCLUSIVE_NEEDS_PAID_OR_BROWSER | 3 | 11.5% |
| **Total** | **26** | 100% |

**Estimated precision (excluding inconclusive):** 11 / 23 = **47.8%**
**Estimated precision (worst-case, inconclusive = FP):** 11 / 26 = **42.3%**
**Estimated precision (best-case, inconclusive = TP):** 14 / 26 = 53.8%

**Estimated real recall over 194 leads:**
- Strict (only confirmed TP): 11 / 194 = **5.7%**
- Optimistic (TP + best-case inconclusive): 14 / 194 = 7.2%

**Bottom line:** the Phase B headline `26/194 = 13.4%` is misleading. After audit, ~half of the "found" leads point at the wrong company. Phase D must tighten the gate substantially before any province-wide free run is worth shipping.

## 2. Per-lead audit table

Notation:
- *city*  = `business_city` (parsed from PG card address)
- *signals* = lightweight body checks: `SECTOR_OK` (mentions immobiliare-class terms), `SECTOR_WRONG` (mentions cartoleria/falegnameria/etc.), `CITY_MATCH` (lead's business_city present in body), `PHONE_MATCH` (lead's phone last-7 digits in body), `TINY_BODY` (<200 bytes), `PARKED` / `GENERIC_HOMONYM_HIT`.

| # | Company | City | Website | Page title | Signals | Verdict | Failure mode |
|---|---|---|---|---|---|---|---|
| 1 | Agenzia Immobiliare Estimo Pierobon | Belluno | agenziaimmobiliareestimopierobon.com | "Agenzia Immobiliare Estimo Pierobon a Belluno (BL)" | SECTOR_OK + CITY + **PHONE** | **TRUE_POSITIVE** | — |
| 2 | Agenzia Immobiliare Le Torri | Belluno | agenzialetorri.com | "Agenzia Immobiliare Le Torri: compravendita e affitto immobili a **Modena**" | SECTOR_OK | **FP_GENERIC_HOMONYM** | Same brand, different agency in Modena |
| 3 | Area Immobiliare | Belluno | areaimmobiliare.com | "Area Immobiliare – 30 anni da protagonisti del **mercato immobiliare bergamasco**" | SECTOR_OK | **FP_GENERIC_HOMONYM** | Same brand, different agency in Bergamo region |
| 4 | Immobiliare dalla Riva S.r.l. | Belluno | dallariva.it | "Home - Fresatura Alesatura Tornitura - **Dalla Riva Costruzioni Meccaniche**" | SECTOR_WRONG | **FP_WRONG_SECTOR** | Mechanical workshop, not real estate |
| 5 | Pb Properties S.r.l. | Belluno | pbproperties.com | "**Premier Business Properties, Inc.**" | SECTOR_OK | **FP_GENERIC_HOMONYM** | US-based firm, unrelated entity |
| 6 | Savim S.r.l. | Belluno | savim.it (→ savimeurope.com) | "SAVIM EUROPE | **Impianti e Cabine di Verniciatura Industriale**" | (sector neither) | **FP_WRONG_SECTOR** | Industrial paint cabins; lead is mis-categorised on PG OR same-name homonym |
| 7 | Agenzia Immobiliare Il Maso S.n.c. | Follina | agenziailmaso.it | "Agenzia Immobiliare Il Maso" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 8 | Agenzia Immobiliare 'La Mia Casa' | Follina | agenzialamiacasa.it | "La Mia Casa - Agenzia immobiliare **Cuneo**" | SECTOR_OK | **FP_GENERIC_HOMONYM** | Same brand, different agency in Cuneo |
| 9 | La Decisa S.r.l. | Vittorio Veneto | ladecisa.com | "La Decisa Immobiliare" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 10 | Progetto 50 S.r.l. | Cison di Valmarino | progetto50.it | "Progetto 5.0" | (no signals) | **FP_GENERIC_HOMONYM** | Generic name; site is a different "Progetto 5.0" |
| 11 | Agenzia Immobiliare dalla Riva | Feltre | agenziadallariva.com | "Agenzia Immobiliare Dalla Riva **Belluno**" | SECTOR_OK + CITY | **TRUE_POSITIVE** | (related to lead #4 — this is the correct site for the dalla Riva immobiliare; the lead #4 mis-matched a homonym) |
| 12 | Gecoimmobili | Cornuda | gecoimmobili.it | "Homepage \| Gecoimmobili" | SECTOR_OK + CITY + **PHONE** | **TRUE_POSITIVE** | — |
| 13 | Casa Group S.r.l. | Maser | casagroup.it | "Home - CasaGroup" | SECTOR_WRONG | **INCONCLUSIVE** | Title uninformative; sector_wrong from a non-immobiliare keyword in body. Browser inspection needed. |
| 14 | Iniziative S.p.a. | Asolo | iniziative.org | "**INIZIATIVE.ORG - For Sale**" | (none) | **FP_PARKED_OR_UNDER_CONSTRUCTION** | Domain explicitly listed for sale |
| 15 | Bloom | Pieve di Cadore | bloom.it | "Bloom! – Frammenti di organizzazione" | GENERIC_HOMONYM_HIT | **FP_GENERIC_HOMONYM** | "Bloom" is an organisational-design blog |
| 16 | Giacin Immobiliare | Pieve di Cadore | giacin.com | "Home - Giacin Immobiliare" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 17 | Agenzia Immobiliare Mz Case | San Vito di Cadore | agenziamc.it | (curl status=000, empty body) | TINY_BODY | **INCONCLUSIVE** | Server unreachable from this run; need browser to evaluate |
| 18 | Comelico Immobiliare | Santo Stefano di Cadore | comelicoimmobiliare.it | "Welcome" | SECTOR_OK | **TRUE_POSITIVE** | Domain is the literal brand+sector concatenation; SECTOR_OK passes; "Welcome" is a placeholder home page |
| 19 | Agenzia Immobiliare Ariston | Cortina d'Ampezzo | agenziaariston.it | (no title, tiny body) | TINY_BODY | **INCONCLUSIVE** | Site appears empty / placeholder |
| 20 | Agenzia Immobiliare | Cortina d'Ampezzo | agenziaimmobiliare.it | "**Agenziaimmobiliare.it - Vendi la tua casa**" | SECTOR_OK | **FP_DIRECTORY_OR_PORTAL** | Generic real-estate portal, not a Cortina agency |
| 21 | Agenzia Immobiliare Sg | San Vito di Cadore | agenziaimmobiliaresg.it | "Agenzia immobiliare SG di Serafini Gianantonio & C. Snc" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 22 | Cortina Properties S.r.l. | Cortina d'Ampezzo | cortinaproperties.com | "Agenzia Immobiliare Cortina Properties" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 23 | Dmc Legno S.r.l. | Padola | dmclegno.it | "DMC Legno - Falegnameria e Carpenteria a **Padola di Comelico, Belluno**" | SECTOR_OK + CITY | **TRUE_POSITIVE** | The lead is mis-categorised on PG (real business is carpentry, not real estate) but the matched website IS the company's real site. Audit verdict is on website match, not PG categorization. |
| 24 | Immobiliare Appia (Cortina) | Cortina d'Ampezzo | immobiliareappia.it | "Immobiliare Appia s.a.s. \| Agenzia Immobiliare - Via Raffaele De Cesare 149, **00179 Roma**" | SECTOR_OK | **FP_GENERIC_HOMONYM** | Same brand, different Roma-based agency |
| 25 | Agenzia Immobiliare Andreotta | Cortina d'Ampezzo | agenziaandreotta.it | "Agenzia Immobiliare AGENZIA ANDREOTTA **CORTINA**" | SECTOR_OK + CITY | **TRUE_POSITIVE** | — |
| 26 | Ufficio | Cortina d'Ampezzo | ufficio.com | "**Cartoleria, Cancelleria, Carta, Cartucce, Toner** e Accessori a prezzi da discount" | SECTOR_WRONG | **FP_WRONG_SECTOR** | Stationery e-commerce; brand "Ufficio" is too generic |

## 3. Pattern analysis

### 3.1 Generic-name failures (7 / 26 — biggest single failure mode)

The `PreVerifyGate` accepts a semantic match when:
- ≥ 50% of name tokens appear in the body, AND
- domain-stem token-similarity OR location-string presence in body acts as "ownership anchor".

This passes trivially when the lead's brand IS a common Italian word that any site in the same sector would mention:

| Lead brand | Domain reached | Wrong-location detail |
|---|---|---|
| "Le Torri" | agenzialetorri.com | Modena agency |
| "Area Immobiliare" | areaimmobiliare.com | Bergamo agency |
| "La Mia Casa" | agenzialamiacasa.it | Cuneo agency |
| "Immobiliare Appia" | immobiliareappia.it | Roma agency |
| "Bloom" | bloom.it | unrelated blog |
| "Pb Properties" | pbproperties.com | US firm |
| "Progetto 50" | progetto50.it | Generic "Progetto 5.0" |

**Common signature:** the body is real-estate-themed or carries the brand token, AND the body mentions some Italian city (any city), AND the domain stem coincides with the brand token. The semantic check then ALWAYS passes because:
- bodyRatio: very high (the page IS real estate).
- ownership anchor: the brand-stem-in-domain check (`isHighDomainSim`) trivially holds.

### 3.2 Wrong-sector homonyms (3 / 26)

| Lead | Domain | Real sector |
|---|---|---|
| "Immobiliare dalla Riva" | dallariva.it | Mechanical workshop |
| "Savim S.r.l." | savim.it | Industrial paint cabins |
| "Ufficio" | ufficio.com | Stationery e-commerce |

These slip through because:
- `dallariva.it` is the legitimate domain of a *different* company called "Dalla Riva" (mechanics).
- `ufficio.com` is the literal generic word; "Ufficio" as a company brand is essentially an SEO collision.
- The PreVerifyGate doesn't read the page sector; it only matches name tokens.

### 3.3 Single-token brand failures

`Bloom` (4 chars), `Ufficio` (7 chars), `Iniziative` (10 chars), `Area` (4 chars) all matched single-word generic domains. The current `PreVerifyGate.shortHost(url)` produces e.g. `bloom`, then `compactName.includes(domainStr)` → trivially true → ownership anchor accepted with no further evidence.

### 3.4 Wrong-region homonyms (4 of the 7 generic_homonym)

The single biggest precision lever: **none of these wrong-region matches would survive an RDAP check**. RDAP for `agenzialetorri.com` would show a Modena / Reggio Emilia registrant, not a Belluno one. Today the RDAP stage (`RdapBoostStage`) runs LAST in the ladder and only when no website was found, so it can't sanity-check a HyperGuesser hit.

### 3.5 Strong domain-token matches (the 11 TPs)

Successful matches share at least one of:
- **Surname embedded in domain** (Pierobon, Andreotta, Serafini → SG, Giacin, Pierobon).
- **City embedded in domain** (cortinaproperties, comelicoimmobiliare).
- **Long composite stem** matching the company's full normalized name (agenziaimmobiliareestimopierobon, gecoimmobili, ladecisa).
- **Phone digit-match** as a deterministic anchor (Pierobon, Gecoimmobili).

The TPs do not depend on sector keywords or city-anywhere-in-body; they depend on uncommon, lexically rich domain stems.

### 3.6 Where PIVA / address / phone evidence would have helped

- **Phone digit-match**: only 2 of 26 had a phone in the input lead (PG hides most phones behind click-to-reveal). When present, both produced TPs (#1, #12).
- **PIVA digit-match**: 0 of 26 had PIVA in the lead (PG never exposes PIVA on listing). PIVA-anchored verification is structurally unavailable on free PG-only ingest.
- **Address city in body**: 5 TPs would have been deterministic if `business_city` had been required to appear in the body (instead of "any" location signal). 4 wrong-region FPs (Le Torri/Modena, La Mia Casa/Cuneo, Immobiliare Appia/Roma, Area/Bergamo) would have been rejected because they explicitly mention the WRONG city.

## 4. Phase D recommendations (ranked by expected impact)

### D-1. Mandatory RDAP corroboration for semantic-only matches  *(eliminates 4-5 wrong-region FPs)*

Today `RdapBoostStage` runs at the end of the ladder, on `lead.official_website` if already set; it doesn't gate the HyperGuesser hit before it's accepted. Phase D change:

- When a `HyperGuesserStage` semantic match (no PIVA digit-match) has confidence ≤ 0.80, **synchronously** call `RdapValidator.checkDomainOwnership(domain, normalized)` before accepting.
- If RDAP confidence ≥ 0.4 (vCard fn/org match in same province) → confirm.
- If RDAP returns explicit registrant in a *different* province than the lead → reject (`SEMANTIC_REJECTED_BY_RDAP`).
- If RDAP returns nothing (most `.com` registrars hide vCard) → accept the original semantic verdict but downgrade confidence to 0.55.

Catches deterministically: #2 (Modena), #3 (Bergamo), #8 (Cuneo), #24 (Roma), and probably #5 (US registrant) and #15 (organisational blog).

### D-2. Domain-stem common-word denylist  *(eliminates 3-4 generic-homonym FPs)*

Maintain a small list of Italian common words that are NOT plausible standalone-brand domain stems for an SMB agency:

`bloom, ufficio, area, casa, progetto, gruppo, studio, decisa, iniziative, prestigio, qualità, ambiente, futuro`

When `HyperGuesser` resolves a candidate whose domain stem matches one of these AND the lead's name tokens reduce to that single common word, **require either PIVA evidence or RDAP-confirmed in-province registrant**. No semantic-only acceptance.

Catches: #14 (Iniziative), #15 (Bloom), #26 (Ufficio), partially #3 (Area), #20 (Agenzia Immobiliare), #10 (Progetto).

### D-3. Body must contain the lead's `business_city`, not "any city"  *(eliminates 3-4 wrong-region FPs)*

Current `PreVerifyGate` ownership anchor is satisfied by *any* of the lead's locality tokens appearing in the body. Strengthen:

- For semantic-only matches, REQUIRE `normalized.business_city || normalized.city || normalized.query_location` token to appear in the body (as a whole word, case-insensitive).
- If the body mentions a different Italian city than the lead's, downgrade confidence and trigger D-1 (RDAP).

Catches: #2 (body says Modena), #3 (Bergamo), #8 (Cuneo), #24 (Roma).

### D-4. Sector keyword cross-check  *(eliminates 2-3 wrong-sector FPs)*

When the requested category is `agenzie immobiliari` (or scraper-supplied category), the matched body must contain at least ONE sector-aligned keyword from a category-specific allowlist:

`immobiliare, agenzia, agente, real estate, vendita, locazione, affitto, compravendita`

AND must NOT be dominated by sector-conflicting keywords (`cartoleria, cancelleria, falegnameria, costruzioni meccaniche, fresatura, alesatura, tornitura, verniciatura industriale, ristorante, pizzeria, autosalone, farmacia`). 

Compute per-sector ratio. Reject when `conflict_ratio > 0.5 * sector_ratio`.

Catches: #4 (mechanical workshop), #6 (paint cabins), #26 (stationery).

### D-5. Tighter PreVerifyGate token policy  *(complements D-3)*

Currently the gate accepts when ≥ 2 brand tokens match in body, with body ratio ≥ 0.5 OR title/body combined. Tightening:

- Strip generic descriptors before counting: `agenzia, immobiliare, srl, sas, snc, spa, di, e, &, srls, scarl` (already in NER parser — reuse).
- Require ≥ 2 *distinctive* tokens (post-strip) of length ≥ 4.
- When the only distinctive token is itself a denylist word (D-2), reject without PIVA/RDAP.

### D-6. Reason-code split for SerpStage  *(operator clarity, no precision change)*

Replace the single `REJECTED_DIRECTORY` (168/194 in BL run) with:
- `SERP_EMPTY_ALL_PROVIDERS` — every SERP provider returned []
- `SERP_DIRECTORY_ONLY` — at least one provider returned results, all classified as directory by SerpDeduplicator
- `SERP_REJECTED_BY_VERIFY` — candidates fetched but all failed PreVerifyGate

Today an operator can't tell the difference. After the split, "we tried but no provider answered" becomes distinguishable from "we tried, providers answered, but the results were noise".

### D-7. Timeout policy  *(reliability, cost-neutral)*

`direct_fetch` was tripped open after 6 consecutive timeouts late in the BL run, on what looked like a single slow target. Patch the breaker policy:

- Treat `kind: 'timeout'` failures with **half-weight** (count as 0.5 toward the threshold) — slow targets shouldn't poison the breaker for all targets.
- Or: introduce per-target retry-budget so timeout on one URL doesn't propagate.

### D-8. HyperGuesser ranking re-prioritisation  *(small impact)*

Today `HyperGuesser` resolves candidates in generation order then takes the first 6. Bias generation order to prefer composite stems:

1. `<brand_compact><city_compact>.{it,com}` (highest)
2. `<brand_compact>-<city_compact>.{it,com}`
3. `<brand_compact><sector_keyword>.{it}` (e.g. `<brand>immobiliare.it`)
4. `<brand_compact>.{it,com}` (lowest priority of bare brand)

This pushes the bare-stem matches (where most FPs come from) to the bottom; if a more-specific composite resolves first, semantic verification has more material to work with.

### D-9. INCONCLUSIVE bucket handling

For status=200 + tiny-body or status=0, today the gate is REJECTED (so they wouldn't even appear here). The 3 INCONCLUSIVE in this audit (#13 CasaGroup, #17 MzCase, #19 Ariston) came through anyway because the body had enough text for the semantic match before the snapshot we audited. Phase D should add:
- A minimum body length of 800 bytes for semantic-only acceptance (parked / placeholder pages typically have <500 bytes of meaningful HTML).
- When body is too short, return `INPUT_WEBSITE_NOT_VERIFIED` instead of accepting the semantic match.

## 5. Expected Phase D outcome

Implementing D-1 + D-2 + D-3 + D-4 jointly should:

- Drop the FP-generic-homonym bucket from 7 → ~1
- Drop the FP-wrong-sector bucket from 3 → 0
- Drop the FP-portal bucket from 1 → 0 (D-2 covers `agenziaimmobiliare.it`)
- Drop the FP-parked bucket from 1 → 0 (D-9 covers `iniziative.org` "For Sale")
- Inconclusive may go up by a few (some current TPs would become inconclusive without RDAP); offset by cleaner signal

**Realistic post-Phase-D expectation on the 194 BL leads:**
- found ≈ 12-15 (down from headline 26 because aggressive rejection)
- precision ≥ 90% (from current ~48%)
- real recall: similar or slightly higher than today's 11/194, because most TPs already pass deterministic anchors (phone match, RDAP, city match)

Phase D is precision-first, recall-second. Recall recovery comes from Phase H (paid SERP) once the gate is trustable.

## 6. What Phase D should NOT do

- Do not introduce an LLM-based "is this the right site" check. The current LLM_ORACLE concept in pg3 was expensive and pg4's gate must work on free deterministic signals first.
- Do not raise `pivaMatchConfidence` or `semanticMatchConfidence` defaults blindly. Confidence numbers must reflect evidence quality after the new checks; we'll calibrate against this audit.
- Do not over-engineer the denylist (D-2). Keep ≤ 30 entries, focused on what the audit observed. Re-tune after Phase J / Phase K real runs.

## 7. Audit method (for reproducibility)

For each of the 26 leads:

1. `curl -sL --max-time 8 --max-filesize 100k -A 'Mozilla/5.0 (audit pg4 Phase C)' "$url"`
2. Extract `<title>` via regex.
3. Body signals:
   - `SECTOR_OK` if body contains `immobiliare | agenzia immob | real estate | vendita case | affitti | agente immob`.
   - `SECTOR_WRONG` if body contains `cartoler | cancelleria | toner | cartucce | medico | legno | arredamento | meccanica | lavanderia | restaurant | ristorante | autosalone | farmacia` (only if SECTOR_OK didn't fire).
   - `CITY_MATCH` if `business_city || city` (lowercased) is in body.
   - `PHONE_MATCH` if last-7-digits of lead phone are in body's digit-only projection.
   - `PARKED_OR_CONSTRUCTION` if body contains `domain is for sale | this domain is for sale | dominio è in vendita | sito in costruzione | under construction`.
   - `TINY_BODY` if response body < 200 bytes.
4. Classify based on signals + observed title:
   - All TP signals + plausible page title → TRUE_POSITIVE
   - Title mentions wrong city → FP_GENERIC_HOMONYM
   - Title mentions wrong sector → FP_WRONG_SECTOR
   - Title says "for sale" / "parked" → FP_PARKED
   - Title is the literal Italian sector portal → FP_DIRECTORY_OR_PORTAL
   - TINY_BODY / status=0 → INCONCLUSIVE

No LLM. No paid API. Single deterministic pass.

## 8. Files referenced

- `pg4/output/p43_provincia_bl.csv` — Phase 4.3 input (194 BL leads)
- `pg4/output/p50_bl_enriched_free.csv` — Phase B output (194 rows, 26 found)
- `pg4/output/p50_bl_enriched_free.jsonl` — full debug payload per lead
- `pg4/output/p50_bl_enriched_free.cost-ledger.jsonl` — 1246 ledger entries
- `pg4/docs/phase_b_free_enrichment_report.md` — Phase B baseline report
