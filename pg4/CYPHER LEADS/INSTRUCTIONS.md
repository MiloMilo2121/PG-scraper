# Cypher engine run — step-by-step playbook

*Come usare pg4 per generare lead Cypher, passo per passo. Questo è la GUIDA —
l'esecuzione vera la lanci tu (free-first, €0; niente push/invio senza i gate). Roadmap
target: `roadmap_ateco.md`. Motore: `../pg4`. Forward-plan: `../pg4/docs/next_steps.md`.*

## §0 — Stato del motore (cosa è pronto vs in folle — onestà)
- ✅ **Discovery free** (PagineGialle + Maps per categoria-testo + provincia) — calibrata
  per real-estate; le verticali Cypher chiedono una mini-calibrazione (§3).
- ✅ **Enrich free-gold €0** (email same-domain ~100% preciso · VAT VIES-confermata/footer ·
  PEC on-site · fatturato+dipendenti da fatturatoitalia per i depositanti · social) —
  rate-limited, entity-guard anti-franchise attivo.
- ✅ **Judgment a due assi** (A forza intrinseca · B espressione digitale → quadrante/target)
  + **vista UI** (clic sulla cella verdetto → drawer) + **eval per-blocco**.
- ⚠️ **Asse A legge `unknown`** finché non colleghiamo le fonti-A (gare/Accredia/recensioni —
  vedi next_steps.md). Quindi oggi il giudizio è forte su **B** (digitale debole) e provvisorio
  su A. Per Cypher va bene per iniziare: vedi §5.
- ⛔ **Openapi / registro per-ATECO**: client costruito ma DISABILITATO (serve activation
  layer + key). Discovery per-ATECO oggi = mappatura categoria-testo (§2).
- 💶 Tutto **€0**; paid `enabled:false`; **niente è ancora stato eseguito**.

## §1 — Scegli il cluster di partenza
Parti da **Cluster 1 (home-services high-ticket)** — ROI più rapido e misurabile (vedi
`roadmap_ateco.md`). Non lanciare tutti i 20 codici insieme: il test controllato è
**50 C1 · 30 C2 · 30→20 C3**.

## §2 — ATECO → discovery (il bridge)
pg4 cerca per **categoria-testo**, non per ATECO. Per ogni codice del cluster, definisci i
termini di ricerca + il FILTRO della roadmap. Esempi C1:
- `43.21.01` → "installatori fotovoltaico", "impianti fotovoltaici" (keyword **fotovoltaico**)
- `43.22.07` → "climatizzazione", "impianti riscaldamento", "pompe di calore"
- `16.25.00` → "serramenti legno", "infissi legno" (filtro **produttore-venditore**)
- `22.23.00` → "serramenti pvc", "infissi pvc"
- `31.00.20` → "cucine su misura", "showroom cucine" (filtro **B2C/showroom**)
(Quando l'activation layer Openapi sarà attivo → `IT-search` per ATECO+provincia diretto.)

## §3 — Calibrazione verticale (una volta per nuova categoria)
La discovery è tarata su real-estate. Per una verticale nuova: lancia un giro piccolo (1
provincia, ~30-50), **misura il yield** (quante aziende reali, quanti siti trovati), e
verifica i selettori. Se il yield è basso → aggiusta i termini §2. Output di calibrazione →
`evidence/`. (È la stessa disciplina dei recalibration report di pg4.)

## §4 — Discovery + Enrich (free, €0)
Per provincia/categoria: lancia la discovery → grezzi in `output/`. Poi arricchisci
free-gold (dashboard: seleziona righe → "+ Email/+ P.IVA/+ Fatturato/+ Dipend./+ Social";
o CLI). **Attenzione volume fatturato**: rate-limit ~1/4s, una selezione grande è
*lenta-ma-vera* (vedi operator_playbook §27). Tieni la **provenienza** per cella.

## §5 — Judgment = il filtro ICP Cypher
Gira il giudizio (dashboard: seleziona → **L4 Giudizio** → clic sulla cella verdetto → drawer).
**Cypher ICP ≙ quadrante A+B-**: business forte + digitale debole = chi ha bisogno di Cypher.
- Oggi **B (digitale debole)** si misura bene → pg4 sa già dirti chi ha un'espressione
  digitale carente (sito povero/assente, no presidio) = il gap che Cypher vende.
- **A (il business è davvero forte?)** è provvisorio finché non colleghiamo le fonti-A. Per
  ora compensa con: (a) i FILTRI della roadmap (es. "produttore-venditore", "brand validato"),
  (b) la tua eval umana sul drawer, (c) la priorità-ATECO (i codici sono già pre-qualificati).
- Le tue eval sul drawer (A/B/quadrante/target giusti?) → diventano **golden** (`golden/`).

## §6 — Eval per-blocco (la metro)
Per ogni cluster, costruisci un golden stratificato (~6-8 aziende × 4 quadranti, etichettate
ALLA CIECA con la rubrica di quella categoria) → `golden/<cluster>.json` → `judge:eval` dà
**precision/recall + A-agreement PER BLOCCO** (mai un numero globale). È ciò che dice se il
giudizio generalizza sulla verticale Cypher. (Vedi `../pg4/tests/fixtures/judgment_golden.example.json`.)

## §7 — Prospect matrix (il prossimo passo di Marco)
Costruisci la **matrice 100 aziende** dei 10 codici prioritari (`output/prospect_matrix.csv`)
e valida 4 metriche **su call qualificate** (non sul tasso di apertura):
1. accessibilità del decisore · 2. problema osservabile · 3. budget plausibile · 4. conversione a call.
Split: 50 C1 · 30 C2 · 20 C3. Il vincitore si decide su **willingness-to-pay**.

## §8 — Export + GATE legali (NON saltare)
Output per lead (schema): azienda · dominio · provincia · ATECO · dimensione · fatturato (se
legittimo) · servizi · decisore · email · certificazioni · fiere · gare · trigger · **fonte** ·
data raccolta · score · motivazione. Prima di qualunque outreach:
- **Gate-A consenso** — "scrapabile ≠ usabile"; email marketing richiede base giuridica
  (Garante). Privilegia dato d'impresa, non personale.
- **Separa** scrape / enrichment / invio. Mai invio automatico senza verifica. Opt-out +
  suppression list. **robots.txt + ToS + licenza verificati per-dominio** prima di automatizzare.
- Verticali con vincoli (alcol, sanitario) → solo compliant/account-based.

## §9 — Struttura del work-area
```
CYPHER LEADS/
  INSTRUCTIONS.md      ← questo file
  roadmap_ateco.md     ← i codici target, cluster, filtri, ranking
  output/              ← grezzi + arricchiti + prospect_matrix (PII → gitignored)
  golden/              ← golden set per blocco per judge:eval (etichette cieche)
  evidence/            ← calibrazioni, sample-vs-source, note di yield
```

## §10 — Cadenza
1 cluster alla volta → calibra → discovery+enrich → giudica (filtro A+B-) → eval per-blocco →
prospect matrix → call. Decidi il mercato vincente sui dati di call, non vanity.
**Niente è ancora eseguito: questo file è la guida; il "vai" lo dai tu.**
