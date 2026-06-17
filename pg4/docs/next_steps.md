# pg4 — Next steps (live forward-plan)

*The single forward-plan after the judgment layer + per-block eval + the judgment UI.
Consolidates the source-expansion analysis. €0, nothing enabled/pushed until the
operator says. Companion: judgment_layer.md, openapi_layer_rules.md, ontology v2.*

## THE #1 PRIORITY — close the A-axis (the thesis bottleneck)
Measured on real companies (Lorello → `A?B+`, B=0.83 high, **A=unknown 0/7**): the
pipeline runs and the WEBSITE/B-axis works, but **axis A reads `unknown`** because the
free A-sources don't deliver. The A-collector (`collect_a.ts`) already has the SLOTS —
`RegistrySourceAdapter`, `PlacesSourceAdapter`, and free-SERP queries for §2.1–2.7
(2.2 brevetti/marchi, 2.3 marchio storico, 2.7 premi/stampa) — but in the free run all
three return nothing. **Until a real A-source feeds them, the A+B- "silent-gem" thesis
cannot be validated** (the §17 reminder the system prints itself). Every A-source we wire
raises `A-agreement` in the per-block `judge:eval`. THIS is the work that matters next.

## Source matrix (the operator's requested "prossimo passo", anchored to pg4)
Tiers (Marco's three): **S**=scrapable · **R**=legally reusable · **U**=commercially useful.
"Feeds" = the pipeline slot. Adapters plug into `harvestSource(adapter, lead, bundle, ctx)`,
stamp the axis + a §2.x subdim, and pass the §5.3.5 firewall + entity-guard — so each is an
ADAPTER behind a defined interface, NOT a rewrite.

| source | feeds | pg4 slot / adapter | tier | viability | priority |
|---|---|---|---|---|---|
| **ANAC + TED (gare/appalti)** | **A** — "contracts won / qualified supplier" (strongest A: a third party bought) | new A-adapter "contratti" (§2.x / new) | **open data → R clean** | high (public datasets/API) | **P1** |
| **Accredia** (ISO/qualifiche) | **A** — third-party-validated structured capability | new A-adapter "certificazioni" | public, likely S+R | high | **P1** |
| **Registro Imprese / Openapi** | firmographic + **decisore** + bilanci | `RegistrySourceAdapter` (slot exists; Openapi client built, DISABLED) | official API | high (key + activation layer) | **P2** |
| **Fiere/espositori** (MECSPE, Vinitaly, Marmomac…) | **A** (active+budget+sector) **+ discovery** | A-adapter + discovery, per-fair | S yes · R per-fair ToS | med-high | **P2** |
| **Bandi/beneficiari incentivi** (4.0/5.0, POR/FESR) | **A** — investing, has budget | A-adapter "investimenti" | often public | med | P3 |
| **Google Places API** (reviews/rating) | **A** — reputation (the ristorazione A-signal!) | `PlacesSourceAdapter` (slot, no API) | official API (paid) | med (cost) | P3 (hospitality blocks) |
| **News/comunicati locali** | **A** — premi/acquisizioni/nuove sedi (trigger §2.7) | free-SERP (exists) — improve matching | per-site | med | P3 |
| **Albi fornitori pubblici / SOA / albo gestori** | **A** — qualified for X (verticals) | A-adapter | mostly public | med | P3 |
| **Associazioni/consorzi/distretti** | A (membership, mild) + discovery | adapter (verify per-site) | mixed (many riservati) | low-med | P4 |
| **Siti aziendali** | **B** (done) + some A (case study/clienti) | `WebsiteSourceAdapter` ✓ wired | S+R | — | DONE |
| Directory commerciali (ReportAziende, Kompass, Europages…) | enrichment/discovery | — | **R risky (ToS often forbid)** | S yes | avoid-automate |
| Marketplace B2B / portali immobiliari | export/category / growth signal | adapter (later) | per-site | low | P4 |
| Cataloghi PDF (espositori, annuari) | A + discovery | PDF extractor (pdf skill) | S | med | P3 |
| **LinkedIn** | decisore/ruoli | — | **forbidden (scrape) → API/Sales Nav manual** | — | NO scrape |
| **Google Maps (scrape) / FB-IG** | discovery / social | — | **forbidden → Places API / official / manual** | — | NO scrape |
| Portali con login/CAPTCHA/paywall | varies | — | **do not bypass → account/API/agreement** | — | NO bypass |

## Prioritized wiring sequence (what actually moves the A-needle, cleanest first)
1. **P1 — ANAC/TED gare (open data).** "Contracts won" is the strongest A signal and is
   openly licensed → zero grey zone. Wire as an A-adapter → §2.x. Turns `A?` into a
   measured A on companies that have won public tenders → first real A+B- validation.
2. **P1 — Accredia certifications.** Public, structured, clean A signal of capability.
   (Ontology check: map to an existing §2.x or add a "certificazioni" subdim.)
3. **P2 — Registro Imprese via Openapi** (client already built, DISABLED): firmographic +
   the **decision-maker** + bilanci. Needs the key + the activation layer (top-on-request).
4. **P2 — Fiere/espositori**: A (active+budget) + discovery; per-fair ToS check.
5. **P3** — Places API (ristorazione reviews), bandi/incentivi, news-trigger matching, PDF.

Each step: write the adapter → it feeds the §2.x slot → re-run per-block `judge:eval` →
watch `A-agreement` rise on that block. The adapter is the unit of work.

## Legal discipline (operator's 7 rules — already pg4's posture, AFFIRMED)
"Scrapable ≠ usable." The Garante: email marketing needs consent (save specific bases).
pg4 ALREADY: separates **scrape / enrich / send**; prefers company-data not personal;
keeps **provenance per cell**; minimizes; has **opt-out / suppression**; holds outreach
behind **Gate-A** (consent); never auto-sends. So source expansion adds adapters, NOT a
new legal model. **Per-domain `robots.txt` + ToS + license are verified LIVE at execution,
source by source** (not assumed here) — the matrix sets priority; execution gates each domain.

## Open items carried over (offered, awaiting the operator)
- **3rd golden block** — food/design artigianale veneto (B2C own-brand: A from reviews +
  awards + retail; the model where "fuffa" is richest). I source real companies + the
  4-quadrant recipe; the SILENT targets you pick from Maps (rating high, site dead);
  A/B labelled BLIND by you. Heterogeneity then tests generalization across 3 models.
- **CSV→fixture loader** — `golden_set_SEED_eterogeneo.csv` (with `categoria` + the
  `*_DA_TAGGARE` columns) → read directly by `judge:eval`. Needs the final column names
  confirmed.
- **Openapi activation layer** — the "only TOP companies, on request" gate on top of the
  built-but-disabled client: `isTopCompany` predicate + on-request action + € ceiling +
  the first-real-call golden (finalise the per-VAT response shapes). 2 decisions pending
  (what is "top", the ceiling) — openapi_layer_rules.md.
- **Per-block eval on a filled golden** — once a block is labelled, run `judge:eval` to
  get per-block precision/recall + A-agreement (the metro that says the judge generalizes).

## Status
Judgment layer + per-block eval + judgment UI shipped (commits 4fb5ca3, acf53bc). €0.
Nothing enabled, nothing pushed (owner holds push behind his source-check). The eval is the
metro: no A-source counts until `A-agreement` rises on a real block.
