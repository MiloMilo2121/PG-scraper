# Cypher — ICP roadmap (ATECO 2025)

*Target selection for the Cypher engine run. ATECO 2025 (operativo dal 1° aprile 2025,
3.257 codici / 6 livelli). The score measures FIT FOR CYPHER as a first market — not the
sector's quality. Source: Marco's strategic analysis (Stato=Parzialmente verificato,
Conf 90/100; punteggi = valutazioni strategiche, da validare commercialmente).*

## The bridge to the pg4 engine (read first)
pg4 discovers by **category text + province** (PG/Maps), not by ATECO directly. Two paths
to turn an ATECO code into leads:
1. **FREE now** — map each ATECO to PG/Maps search terms + the FILTER/keyword in the table
   (e.g. 43.21.01 → "fotovoltaico"; serramenti → "vendita diretta"). Needs a per-vertical
   category calibration (pg4's profile is tuned for real-estate; new verticals get a quick
   calibration pass — see INSTRUCTIONS.md §3).
2. **OFFICIAL (later)** — Openapi `IT-search` by ATECO+province (the registry enumerator,
   built but DISABLED; activation layer pending) → exact ATECO universe + official VAT.
**Cypher ICP ≙ pg4's A+B- quadrant**: strong business (A) + weak digital expression (B) =
the company that NEEDS Cypher. pg4's B-axis (weak digital) works TODAY; the A-axis (is the
business actually strong) is maturing — so the judgment is a partial-but-useful ICP filter
now, sharper as A-sources land (see next_steps.md).

## TOP-20 priority codes (rank · code · sector · score · cluster · FILTER · decision)
| # | ATECO | sector | score | cluster | filter / keyword | decision |
|---|---|---|---|---|---|---|
| 1 | 20.42.00 | Profumi e cosmetici | 91 | C2 brand | solo brand già validati | TENERE — max |
| 2 | 43.21.01 | Fotovoltaico/illuminazione | 90 | C1 home | keyword "fotovoltaico" | TENERE — max |
| 3 | 16.25.00 | Serramenti in legno | 89 | C1 home | solo produttori-venditori | TENERE — max |
| 4 | 43.22.07 | HVAC/climatizzazione | 89 | C1 home | — | TENERE — max |
| 5 | 11.02.10 | Vino fermo | 88 | C2/C3 | cantine con shop/degustazioni/location | TENERE — max |
| 6 | 22.23.00 | Serramenti PVC | 88 | C1 home | produttori-installatori | TENERE — max |
| 7 | 31.00.20 | Cucine | 87 | C1 home | showroom / produttori B2C | TENERE — alta |
| 8 | 32.12.20 | Gioielleria preziosa | 86 | C2 brand | brand con e-commerce | TENERE — alta |
| 9 | 55.10.00 | Hotel | 86 | C3 hosp | indipendenti premium | TENERE — alta |
| 10 | 11.02.20 | Vini spumanti | 85 | C2 brand | DTC + corporate gifting | TENERE |
| 11 | 86.23.00 | Odontoiatria | 85* | (compliance) | verticale dedicata + compliance sanitaria | TENERE se compliance |
| 12 | 32.13.00 | Bigiotteria | 84 | C2 brand | brand con margine | TENERE — alta |
| 13 | 15.12.00 | Borse/pelletteria | 83 | C2 brand | brand prodotto validato | TENERE |
| 14 | 10.82.00 | Cioccolato/confetteria | 82 | C2 brand | premium + corporate | TENERE — alta |
| 15 | 55.30.02 | Glamping/villaggi | 82 | C3 hosp | ABM turistico | TENERE — nicchia |
| 16 | 96.23.10 | Centri termali | 82 | C3 hosp | key-account Colli/Euganei | TENERE — ABM |
| 17 | 11.01.00 | Distillati/liquori | 81 | C2 brand | brand artigianali premium | TENERE |
| 18 | 31.00.32 | Arredo esterno | 80 | — | B2C + contract selettivo | TENERE |
| 19 | 31.00.31 | Arredo interno | 78 | — | filtrare showroom/brand B2C | TENERE |
| 20 | 86.22.01 | Chirurgia estetica | 78* | (compliance) | solo con compliance dedicata | MONITORARE |

\* score corretto per compliance sanitaria/pubblicitaria.

## Launch plan — 3 test clusters (different economic models, not all 20 at once)
- **Cluster 1 — Lead-gen locale high-ticket (fastest ROI, measurable case studies):**
  43.21.01 fotovoltaico · 43.22.07 HVAC · 16.25.00 serramenti legno · 22.23.00 serramenti PVC
  · 31.00.20 cucine. Offerta: *sistema acquisizione preventivi* (Ads + landing + tracking +
  CRM + automazione + reporting).
- **Cluster 2 — Brand premium territoriali / DTC (max differenziazione, Full System):**
  11.02.10 vino · 11.02.20 spumanti · 11.01.00 distillati · 10.82.00 cioccolato · 20.42.00
  cosmetici · 32.12.20/32.13.00 gioielli/bigiotteria. Offerta: *Premium Brand Growth System*.
- **Cluster 3 — Esperienze/hospitality (cluster territoriale Veneto, partnership incrociate):**
  55.10.00 hotel · 55.30.02 glamping · 96.23.10 termali · cantine 11.02.10 con degustazioni.
  Offerta: *Direct Booking & Experience System*.

## Secondary (after ≥2 case studies)
10.41.10 olio · 31.00.31 arredo interno · 31.00.32 outdoor · 43.23.00 isolamento · 56.11.91
ristorazione agricola · 68.31.00 immobiliare · 79.12.00 tour operator · 85.59.20 formazione
(privato/non-finanziato) · 62.20.10 consulenza IT (GTM/B2B, non Ads-first) · 96.22.09 beauty.

## AVOID as a first market
- Too small / low budget: 55.20.41 B&B · 56.11.11 ristoranti generici · 10.71.20 pasticceria
  fresca · 93.13.09 fitness generico · 86.95.00 fisioterapia indipendente.
- Too generic (big lists, low predictive quality): 10.89.09 food n.c.a. · 62.10.00 senza
  filtri · categorie "altre attività n.c.a." · commercio non specializzato.
- Hard to monetize via performance: produttori agricoli puri senza trasformazione/vendita
  diretta · terzisti industriali senza brand · artigiani senza stock · dipendenti da grossisti
  · ticket basso senza riacquisto.

## Compliance flags (→ pg4 Gate-A + legal posture)
Alcohol advertising (vino/spumanti/distillati/birra) + sanitario (odontoiatria/estetica/
fisio) carry advertising/communication restrictions. pg4 already gates outreach behind
consent (Gate-A) + keeps provenance + opt-out; these verticals stay account-based / compliant.

## Prossimo passo (operatore — NON ancora eseguito)
Costruire la **matrice prospect su 100 aziende** dei 10 codici prioritari e validare 4
metriche su call qualificate (non sul tasso di apertura): **accessibilità del decisore ·
problema osservabile · budget plausibile · conversione a call**. Test controllato:
**50 home-service (C1) · 30 cantine/brand premium (C2) · 20 hospitality/experience (C3)**.
Il vincitore si decide su willingness-to-pay, non su metriche vanity.
