# pg4 — Production Readiness Report (pass del 2026-06-10)

Esito di un singolo pass autonomo di hardening (Fasi A–F). Obiettivo:
pg4 operabile non presidiato da un singolo operatore, **zero modalità di
fallimento silenzioso**. Baseline di partenza: `c5a3778` (gap audit +
operator playbook).

## Verdetto

**Obiettivo raggiunto per il perimetro dichiarato.** Un run scrape+enrich
oggi: fa preflight sui selettori, logga su file, lascia un record di audit,
notifica completamento/anomalie/cost-cap, valida i propri output, applica
suppression GDPR, esce con codici deterministici e — se interrotto — drena
in ~2 secondi lasciando output parziali coerenti e checkpoint resume-ready.
Le decisioni che restano aperte sono operative/legali, non tecniche
(elenco in fondo).

---

## Cosa è cambiato, per fase

### Phase A — Observability (commit `78dd581`)
- **Log per-run** `<out>.log.jsonl` (default-on; `LOG_FILE` override/off).
- **Run history** `<outdir>/_runs.jsonl`: un record per run (id, comando,
  conteggi, costo, esito, yields per comune). Latch: una sola scrittura
  anche quando path normale e signal-path corrono.
- **Preflight selettori** (canary "agenzie immobiliari/Padova") prima di
  ogni scrape live; fallimento → exit 3 con messaggio azionabile.
  `--skip-preflight` per opt-out.
- **Yield anomaly**: resa per comune < 30% della media storica → warn +
  `suspect:true` nel record + notifica. Advisory, mai bloccante.
- **Notifier** pluggable (`NOTIFY=local|off`): log strutturato + notifica
  macOS best-effort. Eventi: run complete/failed/interrupted, preflight
  failed, cost-cap (per-lead once-per-run; run-ceiling latched nel router),
  yield anomaly, validation failed.

### Phase B — Operational hardening (commit `714ee2d`)
- **`pnpm run run` cablato**: scrape → enrich, un run_id condiviso, un
  record, lock per-stage. Output `<base>_raw.*` / `<base>_enriched.*`.
- **Validazione automatica post-run** (warn-only) in scrape/enrich/run;
  `validateOutputs()` esportata, flavor `raw|enriched`.
- **Exit code deterministici**: 0 ok · 1 partial · 2 fatal · 3 preflight ·
  130 interrupted. Esempi scheduler (launchd/cron/GHA commentato) in
  `docs/scheduling_examples.md` — nessuno attivo.
- **Secrets**: `assertPaidSecrets()` fallisce fast nominando la variabile
  mancante quando `--enable-paid` non ha provider usabili. Scan working
  tree + history git: pulito, `.env` mai committato.
- **Graceful shutdown**: drain naturale con watchdog 45 s; secondo segnale
  = uscita forzata immediata.

### Phase C — Data quality / schema v1 (commit `8e01cd1`)
- **`_schema_version=1`** ultima colonna di entrambi i flavor + campo
  JSONL; basi colonne congelate + appendix v1 (struttura che rende
  impossibile re-inserire colonne a metà dell'enriched). Validator la
  pretende.
- **E.164** conservativo (`+39…`, originale in `phone_raw`).
- **Near-duplicate review**: nomi token-riordinati stesso comune →
  `<out>.dedup-review.jsonl`, mai auto-merge.
- **Business chiusi**: "Chiuso definitivamente" → `permanently_closed`;
  enrich li SKIPpa di default (`--include-closed` override), zero
  provider call.

### Phase D — Compliance (commit `079702d`)
- **Suppression list** (flag/env/auto-discovery; phone format-tolerant +
  P.IVA; lead DROPPATI e contati).
- **Retention** `--retention-days`/env, default OFF; `_runs.jsonl`,
  `suppression.csv`, `*.lock` mai toccati.
- **`pnpm run lookup`** — right-to-access/deletion: riporta file:riga.
- **`docs/gdpr_posture.md`** — implementato vs decisioni pendenti.

### Phase E — Quality gate (commit `48bc227`)
- **Coverage baseline: 70.44% lines / 83.76% branches / 81.79% functions**
  (nessuna soglia: il numero è la baseline). CI ora esegue
  typecheck + lint + test:coverage.
- **ESLint** (ts-eslint recommended, no formatting): 8 errori fixati
  (incl. rimozione dead-code in paid_evidence_gate), 0 errori/0 warning.
- **pnpm audit**: 3 finding, TUTTI nella catena dev-tooling
  vitest→vite→esbuild, non sfruttabili nell'uso pg4 (mai dev/UI server
  in ascolto). Zero finding su dipendenze di produzione.

### Phase F — Verifica finale + 2 bug REALI trovati e fixati (questo commit)

I test live hanno scovato due bug latenti che nessun unit test vedeva:

1. **RateLimiter mai cablato** — istanziato dal Phase 1 ma `acquire()`
   aveva zero call site. Un input senza website degenerava l'enrich in un
   burst SERP (~3.7 req/s vs ~0.27 dei run validati): Bing ha soft-bloccato
   lo smoke con 185/185 risposte vuote — IN SILENZIO. Fix: il router ora
   fa pacing per-provider (bing_html/ddg_lite a 0.5 req/s, capacity 2;
   provider non configurati invariati). Senza il preflight/observability
   di questo pass, quella era una campagna cliente persa senza allarme.
2. **Playwright pre-emptava il graceful shutdown** — il suo handler SIGINT
   di default chiude il browser e fa `process.exit(130)` PRIMA del drain
   pg4: niente output parziali, lock lasciato su disco. Fix:
   `handleSIGINT/handleSIGTERM: false` al launch (il lifecycle pg4
   possiede lo shutdown) + abort check per-PAGINA in pg_live (un comune
   denso superava il watchdog da 45 s).

---

## Evidenza di verifica (run reali, 2026-06-10)

### Smoke E2E (`pnpm run run`, comune Limena, free-only)
- preflight PASSED in ~10 s (PG canary 25+ card)
- 185 lead raw; CSV 186 righe = 185 + header (parity ✓)
- **colonne v1 verificate live**: 185/185 `_schema_version=1`;
  21/21 telefoni E.164 con originale in `phone_raw`
- validazione automatica: PASSED ×2 (raw + enriched)
- record in `_runs.jsonl`: command "run", run_id condiviso tra gli stage,
  status ok, exit 0, `comuni_yield {Limena: 200}`
- log file `smoke_f.log.jsonl` creato; nessun lock residuo; exit code 0
- NOTA: il primo smoke ha esposto il bug RateLimiter (sopra); re-enrich
  post-fix: vedi sezione finale.

### Interruption test (scrape 3 comuni, SIGINT singolo mid-run)
Sequenza osservata (1.7 s totali dal segnale all'uscita):
```
[lifecycle] interrupt received — draining gracefully
[pg_live] abort signal — stopping before next page
[scrape] aborted by signal — emitting partial outputs
[scrape] complete
[notify] Scrape interrupted: Partial outputs on disk (25 leads)
```
- output parziali coerenti: CSV 26 = 25 + header
- lock RILASCIATO; checkpoint resume-ready (page 1 done)
- record: status "interrupted", exit_code 130, leads_out 25,
  comuni_yield popolato
- doppio-SIGINT verificato separatamente: uscita forzata immediata con
  record fallback (by design)

### Suite
- typecheck: OK · lint: 0 errori/0 warning
- test: 74 file, 719 passed / 1 skipped (baseline pre-pass: 658)
- +61 test in questo pass

---

## Riepilogo decision log (default conservativi)

Dettagli completi in `docs/decision_log.md`. In sintesi: log file
default-on accanto agli output; `_runs.jsonl` per directory di output;
canary preflight fisso (Padova) finché non c'è una seconda categoria
validata; soglia yield 30% advisory; NOTIFY=local; exit code stabili;
suppression auto-discovery; retention default OFF; lookup è reader-only;
coverage senza soglia; ESLint senza regole di stile; pacing SERP 0.5/s
solo per bing_html/ddg_lite.

## DECISIONI OPERATORE RICHIESTE

1. **Deploy target** (laptop/Docker/hosted) → sblocca il deploy story.
2. **Secrets manager** (resta `.env` o 1Password/SOPS/Doppler).
3. **Attivazione scheduler** (launchd/cron/GHA — esempi pronti).
4. **GDPR**: base giuridica + balancing test; periodo retention
   (`RETENTION_DAYS`); DPIA sì/no; DPA Serper (query paid trasmettono
   nomi a processor extra-UE); informativa Art. 14; RPO se telemarketing.
5. **Canale alert** (Slack/Telegram/email — interfaccia Notifier pronta).
6. **SLA verso i clienti** ("best effort 7 gg" è sostenibile oggi;
   "hourly fresh 99%" no).
7. **Prossime categorie Maps** da curare in `maps_coverage.ts` (oggi solo
   "agenzie immobiliari").
8. **vitest 2→3 major bump** (chiude i 3 finding audit dev-tooling).

## Limitazioni note / fuori scope (dichiarate)

- Maps full-coverage curato per UNA categoria; altre degradano a
  single-query con warn.
- Province curate 12/110; altrove serve `--comuni` esplicito.
- Cache in-memory only (re-run = re-fetch); invariante stateless rispettata.
- Nessun delivery-log (a chi è stato consegnato quale file) — processo
  operatore.
- Output non cifrati a riposo (mitigazione: FileVault).
- La cadenza SERP 0.5/s allunga l'enrich su lead-set senza website
  (~2 s/lead extra worst case); è il prezzo del non farsi soft-bloccare.
- Force-exit path (watchdog/doppio segnale) può lasciare un CSV troncato
  e il lock su disco — il lock è auto-reclamato al run successivo
  (pid morto); escape hatch accettato.
- Smoke yield: la verifica del recupero yield post-pacing-fix è il punto
  finale di questo report (sotto).

## Re-enrich post-fix (pacing 0.5 req/s) — VERIFICA CHIUSA

Stesso input (185 lead raw Limena), stessa macchina, stesso IP:

| metrica | pre-fix (burst) | post-fix (paced) |
|---|---:|---:|
| bing_html success rate | **0%** (185/185 empty) | **100%** (152/152) |
| direct_fetch success | 0% (16/16 transport) | 55% (86/157) |
| with_website | 0 / 185 | **33 / 185 (17.8%)** |
| durata | 53 s | 5.5 min |
| errori | 0 (silenziosi!) | 0 |

Il 17.8% è in linea con la baseline PG-only validata (R11: 20.9% su PD).
Il fallimento silenzioso era interamente l'assenza di pacing; il fix lo
elimina al costo di ~3 s/lead sui lead-set SERP-bound. Caso chiuso.
