# Audit Tecnico + Editoriale - `deep-research-report.md`

Data audit: 2026-02-17  
Documento analizzato: `/Users/marcomilanello/Downloads/deep-research-report.md`  
Codebase verificata: `/Users/marcomilanello/Documents/PG scraper ecc/PG`

## Executive verdict
Affidabilita` complessiva del report: **MEDIA**.

- La mappa architetturale generale (`pg1` + `pg3`, moduli core, rischi principali) e` in larga parte corretta.
- Alcuni claim sono **overstated** o datati: in particolare idempotenza coda e alcune parti di multi-pass/gating in `pg3` sono gia` presenti.
- I rischi tecnici piu` importanti sono reali e confermati (writer/backpressure in `pg1`, canonicalizzazione incoerente, cache senza eviction in `pg3`, flag browser aggressive).
- La qualita` editoriale e` bassa per produzione: il report contiene citazioni non risolte (`filecite`, `cite`, `turnX`, `entity`) che impediscono verificabilita` indipendente.
- La terminologia operativa non e` allineata al codice corrente (`reason_code` nel report vs `error_category`/`status` nel codice `pg3`).

## Matrice Tecnica Claim-by-Claim
| Riga report | Claim | Verdetto | Evidenza codice | Impatto | Correzione testuale consigliata |
|---:|---|---|---|---|---|
| 16 | `pg1` lavora in streaming CSV ma introduce non-determinismo/memoria/backpressure | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:29` (read full file), `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:34` (second read full), `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:41` (materializza tutte le righe), `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:170` (write concorrente senza drain) | Rischio di sovrastimare lo stato "streaming-safe" | Sostituire con: "`pg1` usa parsing stream ma effettua full-read iniziali e materializza righe in memoria; il writer non gestisce backpressure" |
| 17 | `pg3` ha scheduler/worker/server + config schema-validata + queue/DB/discovery | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/index.ts:3`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/index.ts:21`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/index.ts:35`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/config.ts:15` | Base architetturale corretta | Nessuna modifica sostanziale |
| 17 | In `pg3` cache in-memory senza eviction, canonicalizzazione incoerente, browser flags aggressive | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:116`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:723`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:731`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:577`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:606`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/browser/factory_v2.ts:205` | Rischio tecnico reale sottocarico | Nessuna modifica sostanziale |
| 39 | Script `finalize-results`/`prepare-retry` con dedup su chiave composita | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/scripts/finalize-results.ts:15`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/scripts/finalize-results.ts:21` | Possibili collisioni di merge | Aggiungere nota su collisioni e priorita` merge |
| 50 | `pg1` usa provider browser DDG HTML + cache search | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/miner/provider.ts:57`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/miner/provider.ts:62`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/miner/puppeteer-provider.ts:23`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/cache/search-cache.ts:13` | Il report omette fallback API Google Custom Search | Correggere in: "Provider primario API Google se key presenti, fallback DDG HTML via browser" |
| 58 | `CandidateDeduper` tiene 1 candidato per `root_domain`; `Decider` ha fallback AI | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/deduper/index.ts:14`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/decider/index.ts:56` | Descrizione tecnica allineata | Nessuna modifica sostanziale |
| 92 | `pg3` persiste in SQLite (`companies`, `enrichment_results`, `job_log`) con WAL | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:47`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:67`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:84`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:28` | Claim corretto | Nessuna modifica sostanziale |
| 137 | Righe perse in `pg1` ingest per filtri/silent skip | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:54`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:58`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:60`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:62` | Coverage reale inferiore al numero input | Nessuna modifica sostanziale |
| 138 | Rischio memoria in ingest per delimiter detection | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:29`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:34` | Rischio OOM su input grandi | Nessuna modifica sostanziale |
| 139 | Writer concorrente senza backpressure in `pg1` | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:53`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:170` | Rischio output incompleto/pressione memoria | Nessuna modifica sostanziale |
| 140 | Dedup/merge distruttivo sia `pg1` che `pg3` | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/deduper/index.ts:14`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:686`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/runner.ts:338` | Vero su dedup per dominio e merge finale first-write-wins | Specificare che `pg3` preserva anche segnali per record ma non implementa evidence-graph |
| 141 | Cache verifica `pg3` TTL senza limite dimensionale | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:116`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:117`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:731` | Crescita memoria non bounded | Nessuna modifica sostanziale |
| 142 | `normalizeUrl` calcolata ma `goto` usa URL originale | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:577`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:606` | Verifiche incoerenti e cache key disallineata | Nessuna modifica sostanziale |
| 144 | SQLite `single writer reality` in multi-process | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:28`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/worker.ts:157`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/worker.ts:220` | Rischio soprattutto con piu` processi worker; non c'e` writer service dedicato | Correggere in: "rischio potenziale in deployment multi-worker, non necessariamente bug attivo single-process" |
| 146 | Config split: uso diretto `process.env` in moduli | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/search_provider.ts:111`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:623` | Comportamenti variabili non centralizzati | Nessuna modifica sostanziale |
| 149 | `run_id` non coerente (per riga) | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:164`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:165` | Correlazione run-level compromessa | Nessuna modifica sostanziale |
| 153 | Robots/compliance non codificati | **Confermato** | Controllo testuale: nessuna policy robots/allowlist/denylist nei file core scanner (`rg robots|allowlist|denylist` su `pg1/src`, `pg3/src`) | Rischio operativo/compliance | Aggiungere riga esplicita: "assenza policy robots/host governance nel codice corrente" |
| 223 | BullMQ dedup via `deduplication id` ed eventi dedup | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/queue/index.ts:148` (usa `jobId` deterministico), `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/queue/index.ts:117` (eventi completed/failed/stalled, non dedup event) | Il report attribuisce meccanismo diverso da quello implementato | Sostituire con: "Dedup applicata tramite `jobId` deterministico, non via API BullMQ deduplication-id" |
| 262 | PR6 "Job idempotenti in coda" come lavoro futuro | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/scheduler.ts:76`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/scheduler.ts:104`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/queue/index.ts:148`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/worker.ts:61` | Priorita` roadmap distorta: base idempotenza gia` presente | Correggere in: "Hardening idempotenza (edge cases)" invece di "introduzione ex novo" |
| 263 | PR7 DB writer discipline come refactor futuro | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/worker.ts:157`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:269` | Gap reale in deployment con molti worker/processi | Nessuna modifica sostanziale |
| 264 | PR8 LRU cache unificata | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/ai/service.ts:59` (AI cache bounded), `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:116` (verification cache non bounded) | Stato non uniforme tra sottosistemi | Correggere in: "LRU gia` presente solo su AI cache, manca in verification cache" |
| 267 | PR11 Multi-pass gating come lavoro futuro | **Parzialmente confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:70`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:230`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:391` | Multi-pass gia` esiste; da migliorare governance costi | Correggere in: "rafforzare gating e budget" |
| 293 | Evidence Graph come modello centrale | **Non confermato** | `details: any` e assenza schema evidence centralizzato: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:56`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/types.ts:43` | Il report lo presenta come innovazione proposta, non stato attuale | Esplicitare: "non implementato nel codice corrente" |
| 341 | DeterministicCompanyId innovation | **Confermato (gia` implementato)** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/scheduler.ts:76` | Roadmap deve evitare duplicare lavoro gia` fatto | Cambiare tono da "innovazione da introdurre" a "componente gia` attiva" |
| 345 | Data contracts Zod per ogni stage, niente `any` | **Non confermato** | Uso esteso di `any`: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:56`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:133`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:730` | Contratti incompleti riducono affidabilita` | Correggere in: "target desiderato, non stato corrente" |
| 364 | In `pg1` esiste `checkLuhn` ma VAT IT richiede logica dedicata | **Confermato** | `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/extractor/index.ts:119`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/extractor/index.ts:139` | Validazione VAT potenzialmente inaccurata | Nessuna modifica sostanziale |
| 465-468 | Guardrail AI: "last resort" + cost cap per run obbligatorio | **Parzialmente confermato** | Esempi AI non solo last resort: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/nuclear_strategy.ts:58`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:623`; manca cap run-level esplicito in config: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/config.ts:15` | Rischio costo/variabilita` ancora aperto | Correggere in: "guardrail parziali presenti, cost cap run-level non implementato" |
| 549-556 | Logging strutturato con campi `run_id`, `company_id`, `stage`, `host`, `attempt`, `reason_code` | **Parzialmente confermato** | `pg3` usa logger strutturato e `error_category`: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/utils/logger.ts:17`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/utils/logger.ts:143`; job log DB: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:84`; `run_id`/`reason_code` non standardizzati come da report | KPI e troubleshooting non uniformi rispetto proposta report | Correggere lessico in `error_category`/`status` finche` non esiste taxonomy `reason_code` |

## Findings (ordinati per severita`)

### BLOCKER
1. Citazioni non risolte nel report (65 marker) rendono il documento **non verificabile** come fonte autonoma.  
Evidenza: presenza di `filecite`, `cite`, `turnX`, `entity` in `/Users/marcomilanello/Downloads/deep-research-report.md`.
2. Il report tratta alcune capacita` gia` presenti come se fossero future (idempotenza queue), rischiando priorita` roadmap errate.  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/scheduler.ts:76`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/queue/index.ts:148`.

### MAJOR
1. Claim "streaming" di `pg1` incompleto: ingest fa full-read e pipeline materializza tutte le righe prima del processing.  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/modules/ingestor/index.ts:29`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:41`.
2. Writer `pg1` senza backpressure handling in contesto concorrente.  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:53`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg1/src/pipeline/index.ts:170`.
3. `pg3` verifica URL con canonicalizzazione incoerente (`normalizeUrl` vs `page.goto(url)` originale).  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:577`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:606`.
4. Cache verifica `pg3` TTL-only senza eviction/size cap.  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:116`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/core/discovery/unified_discovery_service.ts:731`.
5. Terminologia report non allineata al codice (`reason_code` vs `error_category`).  
Evidenza: `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/utils/logger.ts:22`, `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/src/enricher/db/index.ts:89`.

### MINOR
1. Claim BullMQ su "deduplication id" non coincide con implementazione reale (`jobId` deterministico).
2. Alcune sezioni roadmap mischiano stato attuale e target senza etichettatura chiara (`implemented` vs `planned`).
3. Logging/metriche proposte nel report sono valide ma parzialmente presenti con naming diverso.

## Findings Editoriali
- Il documento contiene citazioni placeholder non renderizzabili (`filecite`, `cite`, `turnX`, `entity`) e quindi non e` tracciabile in revisione esterna.
- In diversi punti usa formulazioni assolute ("non negoziabile", "obbligatori") senza distinguere "stato corrente" da "target".
- Il lessico di output/failure e` incoerente col codice: report orientato a `reason_code`, codice orientato a `status` + `error_category`.
- Alcuni item roadmap sono in ritardo rispetto alla codebase (es. idempotenza base queue) e necessitano riclassificazione.

## Patch Suggerita al Report (replacement puntuali)
1. **Riga 16**  
Da: "lavora in streaming CSV"  
A: "usa parsing stream ma effettua full-read iniziali e materializza righe in memoria in `Pipeline.run`".
2. **Riga 223**  
Da: "BullMQ deduplicazione basata su deduplication id"  
A: "Dedup implementata via `jobId` deterministico (`enrich-${company_id}`)".
3. **Righe 262-263 (Roadmap PR6)**  
Da: "Job idempotenti in coda"  
A: "Hardening idempotenza esistente (collisioni edge-case, metriche dedup, controlli multi-scheduler)".
4. **Riga 264 (Roadmap PR8)**  
Da: "LRU cache unificata"  
A: "Estendere LRU gia` presente in AI cache anche alla verification cache discovery".
5. **Riga 267 (Roadmap PR11)**  
Da: "Multi-pass gating"  
A: "Rafforzare gating multi-pass gia` presente con budget esplicito per costo/latency".
6. **Sezione Logging (549+)**  
Da: taxonomy centrata su `reason_code`  
A: allineare allo stato attuale: `status`, `error_category`, `attempt`, `duration_ms`, aggiungendo progressivamente `reason_code`.
7. **Sezione citazioni**  
Rimuovere tutti i marker `turnX`/`...` e sostituire con riferimenti file/linea locali verificabili.
8. **Sezione innovations**  
Etichettare ogni voce con uno stato: `implemented`, `partial`, `planned`.

## Copertura Audit vs Casi di Validazione
1. Ogni claim tecnico ad alto impatto nelle sezioni richieste (`System overview`, `Diagnostic findings`, `Implementation roadmap`, `Innovation catalog`, `Quality & observability`) e` stato classificato nella matrice.
2. Ogni finding `BLOCKER`/`MAJOR` include evidenza file/linea assoluta.
3. I claim "Parzialmente confermato" separano esplicitamente parte vera e parte non supportata/obsoleta.
4. La roadmap e` stata verificata rispetto allo stato attuale del codice (idempotenza queue, multi-pass, cache).
5. Le citazioni non risolte sono censite come difetto editoriale bloccante.

