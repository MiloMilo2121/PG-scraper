# Engineering Readiness Report

Data: 2026-02-07  
Progetto: PG (pg1 + pg3)  
Obiettivo: portare la piattaforma a uno stato affidabile, osservabile e manutenibile per uso continuativo.

## 1. Stato attuale sintetico

- `pg3` ha ricevuto hardening concreto su configurazione, cache, gestione errori, queue health, DB bootstrap e memory safety.
- `pg1` compila (`tsc --noEmit`), ma non ha pipeline test attiva in `package.json`.
- I test unitari `pg3` passano. Lo smoke test integration fallisce in questo ambiente per Redis non raggiungibile (`EPERM 127.0.0.1:6379`), non per errore logico del codice.

## 2. Lavoro prodotto in questa sessione (eseguito)

### 2.1 Config e runtime centralizzati
- Estesi parametri in `pg3/src/enricher/config.ts`:
  - Redis timeout/retries
  - Scheduler lock TTL
  - Runner concurrency/memory/progress interval
  - Discovery thresholds
  - AI cache limits (TTL + max entries)
  - Deduplicator max size
  - Proxy cooldown
  - Captcha max attempts
  - Health port

### 2.2 Memory safety e stabilità
- Cache AI ora bounded + TTL in `pg3/src/enricher/core/ai/service.ts`.
- Deduplicator con limite massimo in `pg3/src/enricher/utils/deduplicator.ts`.
- Proxy failure timers con cleanup e `dispose()` in `pg3/src/enricher/core/browser/proxy_manager.ts`.

### 2.3 Error handling e logging
- Rimozione dei catch silenti nei moduli core `pg3/enricher`.
- Sostituzione di vari `console.*` con logger strutturato in moduli critici:
  - browser factory
  - captcha solver
  - runner
  - discovery scanners
  - domain guesser
  - selector healer
  - rate limiter

### 2.4 Correttezza flussi
- Queue health ora include dettaglio errore in `pg3/src/enricher/queue/index.ts`.
- CSV export con escaping corretto in `pg3/src/enricher/db/index.ts`.
- Financial flow: rimosse attese cieche, introdotto fallback con `waitForNavigation` + timeout in `pg3/src/enricher/core/financial/service.ts`.
- Discovery request interception cleanup in `pg3/src/enricher/core/discovery/unified_discovery_service.ts`.

### 2.5 Database bootstrap senza side-effect
- Rimosso auto-init schema su import in `pg3/src/enricher/db/index.ts`.
- Init DB reso esplicito in bootstrap:
  - `pg3/src/enricher/worker.ts`
  - `pg3/src/enricher/scheduler.ts`
  - `pg3/src/enricher/health.ts`

### 2.6 Hygiene repository
- Aggiornato `.gitignore` con `pg3/data` (artefatti locali di test).

## 3. Verifiche eseguite

- `pg3`: `npm run typecheck` -> OK
- `pg3`: `npm run test:unit` -> OK (14/14)
- `pg3`: `npm run test:smoke` -> FAIL ambiente (Redis non accessibile)
- `pg1`: `npx tsc --noEmit -p tsconfig.json` -> OK

## 4. Backlog per “readiness elevata” (residuo)

## P0 (bloccanti per hardening completo)

1. **Riduzione duplicazione core browser/fingerprint (pg1 + pg3 enricher + pg3 scraper)**  
   - Estrarre package condiviso `ninja-core` o modulo comune monorepo.
   - Accettazione: una sola implementazione sorgente per factory/fingerprinter/proxy behavior.

2. **Test di integrazione ripetibili in CI con Redis isolato**  
   - Docker compose di test o Redis embedded nei job.
   - Accettazione: smoke/integration verdi in CI senza dipendenze manuali.

3. **Policy di idempotenza end-to-end enrichment**  
   - Regola unica per skip/merge quando job duplicato o azienda già arricchita.
   - Accettazione: due run identiche non alterano output finale in modo divergente.

## P1 (alta priorità)

1. **Copertura test su moduli core ancora fragili**
   - `financial/service`, `unified_discovery_service`, `browser/factory_v2`.
   - Accettazione: suite con casi di timeout, captcha, fallback, retry.

2. **Hardening `pg1` logging/error style**
   - Allineare `pg1` a logging strutturato + rimozione catch silenti residui.
   - Accettazione: nessun catch vuoto in `pg1/src/modules`.

3. **Definizione SLO/SLA operativi**
   - Metrics target: success rate discovery, latency p95, error budget.
   - Accettazione: dashboard + alert soglia con runbook.

## P2 (ottimizzazione continua)

1. **Standardizzazione i18n messaggi log/error** (IT/EN coerente).  
2. **Riduzione ulteriori `any` non essenziali** nei moduli legacy.  
3. **Pulizia periodica `temp_profiles` con watchdog indipendente dal close()**.

## 5. Criteri oggettivi per dichiarare “ready for production”

Si dichiara pronto quando sono veri tutti i seguenti:

1. `typecheck` e test unit/integration passano in CI su branch principale.
2. Nessun catch silente nei moduli runtime critici.
3. Parametri runtime solo da config validata (no magic numbers hardcoded critici).
4. Osservabilità attiva: log strutturati + metriche + alerting.
5. Recovery verificata: retry, graceful shutdown, dead letter handling.
6. Re-run idempotenti dimostrati su dataset campione.

## 6. Nota di realismo tecnico

Un sistema software non può garantire matematicamente “0 errori assoluti” in produzione reale (rete, provider esterni, input non controllati).  
Quello che si può garantire è: **rilevazione rapida, isolamento dei guasti, retry controllato, dati consistenti e rollback operativo**.

Questo report imposta quel percorso in modo misurabile e verificabile.
