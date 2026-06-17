# Lead consolidation — unify + dedup di tutti i lead (pg1/pg3/pg4)

*Solo numeri e procedura — nessun dato lead qui (il corpus è in `leads/`, gitignored, PII).
Script: `src/scripts/consolidate_leads.ts`. Rigenerabile: `pnpm tsx src/scripts/consolidate_leads.ts`.*

## Cosa fa
Scansiona l'intera repo (pg1/pg3/pg4), raccoglie ogni file lead (CSV/JSONL), li mappa allo
schema `Lead` di pg4 e li deduplica con il `Deduplicator` esistente (franchise-safe:
telefono → nome+città → host → P.IVA). Output in `leads/_MASTER/` + copie organizzate in
`leads/_SOURCES/<client>/`. **Non-distruttivo**: legge gli originali, scrive nuovi file,
non sposta né cancella nulla.

## Risultato (run 2026-06-17)
| metrica | valore |
|---|---|
| file scansionati | 268 |
| file con lead | 223 |
| righe lorde | 167.885 |
| **aziende uniche** | **35.222** |
| duplicati collassati | 132.663 (**79,0%**) |
| righe scartate in ingest | 1.842 (nome mancante/malformato) |
| coppie near-dup flaggate | 3.541 (review, mai auto-merge) |

**Per client (uniche):** OTHER 31.004 (corpus B2B nazionale, dominato da agenzie immobiliari
IT) · GERIKO 3.237 · PG4_CURRENT 981 (scrape PD/TV reali).

**Fill-rate sul master:** telefono 79% · indirizzo 92% · sito 48% · email 6% · P.IVA 5%.
→ Corpus forte sul **contatto** (telefono+indirizzo), povero su email/P.IVA: quello è
esattamente il lavoro di **enrichment** di pg4 (cascade per-campo) e/o Openapi on-request.

## Riuso (niente reinventato)
`readCsvAsLeads` (alias pg1/pg3 + passthrough colonne extra: pec, employees, linkedin,
geriko_tier) · `readJsonlAsLeads` · `Deduplicator` · `CsvWriter`/`JsonlWriter`.

## Esclusioni
Dati sintetici esclusi dal master: `tests/ examples/ fixtures/ golden/ e2e_samples/
dropcontact_tests/` + file `*sample* *_seed* interrupt_test expected_ mock baseline` +
ledger/benchmark/healthcheck.

## Prossimi passi possibili (NON eseguiti)
- **Import nella dashboard pg4**: seed del dev-server da `leads/_MASTER/all_leads_master.jsonl`
  → vedi il corpus storico deduplicato nella UI (la "pg3 come dato" risolta).
- **Enrichment**: passare il master nella cascade per-campo per alzare email/P.IVA/fatturato.
- **Segmentazione**: filtrare per categoria/provincia/quadrante per le liste Cypher.
