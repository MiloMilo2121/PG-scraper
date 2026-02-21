# LINEA GUIDA OPERATIVA — LIVELLO MASSIMO
# PG-Scraper / ANTIGRAVITY / OMEGA ENGINE v6

> **Classificazione**: OPERATIVA L5 (Massimo)
> **Versione**: 1.0.0 | **Data**: 2026-02-21
> **Scope**: Governo completo del ciclo di vita del sistema

---

## 0. PRINCIPI FONDAMENTALI (Le 10 Leggi)

```
LEG-001  ZERO SILENT DROPS    — Nessun record deve sparire senza un reason_code
LEG-002  COST CEILING         — Max 0.04 EUR/azienda. Superamento = BLEEDING MODE
LEG-003  GRACEFUL DEGRADATION — Se Redis muore, si degrada a L1. Se LLM muore, si usa regex.
LEG-004  FAIL FAST            — Configurazione invalida = exit(1) immediato. No ambiguita'.
LEG-005  IDEMPOTENZA          — Ogni run deve essere re-eseguibile senza danni.
LEG-006  NO MAGIC NUMBERS     — Ogni soglia, timeout, limite deve essere in config.ts
LEG-007  OBSERVE EVERYTHING   — Ogni chiamata API, ogni errore, ogni decisione: loggata.
LEG-008  FREE FIRST           — Usare risorse gratuite (DDG, Bing HTML) prima di quelle a pagamento
LEG-009  BROWSER AS LAST RESORT — Il browser e' la risorsa piu' costosa. Solo quando HTTP fallisce.
LEG-010  RECOVERY BY DEFAULT  — Ogni run deve riprendere da dove si e' interrotto.
```

---

## 1. ARCHITETTURA DEL SISTEMA

### 1.1 Componenti Principali

```
                    ┌──────────────────────────────────────┐
                    │           PG-SCRAPER MONO-REPO       │
                    ├──────────────────┬───────────────────┤
                    │      pg1         │       pg3          │
                    │   (HUNTER)       │   (ENRICHER)       │
                    │                  │                    │
                    │ - Google Maps    │ - OMEGA Engine v6  │
                    │ - PagineGialle   │ - BullMQ Worker    │
                    │ - Seed Processor │ - Discovery Svc    │
                    │ - Deduplicator   │ - Financial Svc    │
                    │ - CSV Output     │ - Browser Pool     │
                    │                  │ - LLM Router       │
                    │                  │ - CostRouter       │
                    └──────────────────┴───────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   INFRASTRUCTURE   │
                    ├────────────────────┤
                    │ Redis (L2 Cache)   │
                    │ SQLite (Shadow DB) │
                    │ Puppeteer-Real     │
                    │ Prometheus Metrics │
                    └────────────────────┘
```

### 1.2 Due Engine Paralleli

Il sistema ha **DUE pipeline distinte** che possono coesistere:

| Engine           | Entry Point              | Scopo                          | Stato       |
|-----------------|--------------------------|--------------------------------|-------------|
| **Enricher v5** | `pg3/src/enricher/runner.ts` | Pipeline 4-run (FAST/DEEP/AGGRESSIVE/NUCLEAR) | Produzione |
| **OMEGA v6**    | `pg3/src/foundation/RunnerV6.ts` | Pipeline unificata con CostRouter | In sviluppo |

**REGOLA OPERATIVA**: Non mischiare mai i due engine nella stessa sessione. Scegliere UNO e completare il batch.

### 1.3 Modalita' di Esecuzione

```
# Modalita' 1: Worker (BullMQ consumer - Produzione)
node dist/src/index.js worker

# Modalita' 2: Scheduler (Carica CSV -> BullMQ queue)
node dist/src/index.js scheduler path/to/input.csv

# Modalita' 3: Runner Diretto (Pipeline standalone senza BullMQ)
npx ts-node pg3/src/enricher/runner.ts input.csv

# Modalita' 4: OMEGA v6 (Pipeline sperimentale con CostRouter)
npx ts-node pg3/src/foundation/RunnerV6.ts input.csv

# Modalita' 5: Health Server
node dist/src/index.js server
```

---

## 2. CONFIGURAZIONE OPERATIVA

### 2.1 Variabili d'Ambiente Critiche

```bash
# === OBBLIGATORIE ===
OPENAI_API_KEY=sk-...          # Fallback LLM per classificazione
REDIS_URL=redis://host:6379    # Cache L2 + BullMQ

# === RACCOMANDATE ===
SERPER_API_KEY=...             # SERP primario (Google via Serper)
JINA_API_KEY=...               # Content reader (bypassa CF)
DEEPSEEK_API_KEY=...           # LLM economico per classificazione

# === OTTIMIZZAZIONE ===
CONCURRENCY_LIMIT=10           # Worker paralleli BullMQ
RUNNER_CONCURRENCY_LIMIT=25    # p-limit per runner diretto
MAX_CONCURRENCY=5              # Browser paralleli
DISCOVERY_DEFAULT_MODE=DEEP_RUN2
```

### 2.2 Gerarchia dei Provider (CostRouter)

```
Tier 0: BING-HTML   (Costo: 0.000 EUR) ← SEMPRE PRIMO
Tier 1: DDG-LITE    (Costo: 0.000 EUR) ← Fallback gratuito
Tier 2: SERPER      (Costo: 0.001 EUR) ← Google SERP via API
Tier 2: JINA        (Costo: 0.002 EUR) ← Content reader
Tier 3: OPENAI      (Costo: 0.005 EUR) ← GPT-4o-mini
Tier 4: PERPLEXITY  (Costo: 0.005 EUR) ← Sonar Reasoning
Tier 5: DEEPSEEK    (Costo: 0.002 EUR) ← deepseek-chat
Tier 6: KIMI        (Costo: 0.002 EUR) ← moonshot-v1-8k
Tier 7: Z.AI        (Costo: 0.002 EUR) ← z-chat
```

**REGOLA**: Il CostRouter scala automaticamente. Non saltare mai un tier.

### 2.3 Soglie di Discovery

```
WAVE 1 (Swarm/HyperGuesser):  0.70 confidence → ACCEPT
WAVE 2 (SERP Bing/DDG):       0.65 confidence → ACCEPT
WAVE 3 (LLM Judge):           0.80 confidence → ACCEPT
MINIMO ASSOLUTO:               0.55 confidence → ACCEPT
< 0.55:                        REJECT → passa al run successivo
```

---

## 3. DISCOVERY PIPELINE — FLUSSO OPERATIVO DETTAGLIATO

### 3.1 Pipeline Enricher v5 (4-Run)

```
RUN 1: FAST_RUN1
  ├── HyperGuesser (domain probe diretto)
  ├── Email domain check
  ├── SERP locale (DDG/Bing)
  └── Output: found_valid / found_invalid / not_found

RUN 2: DEEP_RUN2 (solo falliti da Run1)
  ├── SERP multi-query (3 varianti)
  ├── LLM classificazione URL
  ├── Browser validation (se CF detected)
  └── Registry lookup (registroimprese.it)

RUN 3: AGGRESSIVE_RUN3 (solo falliti da Run2)
  ├── Nuclear search strategies
  ├── Acronym expansion
  ├── Phonetic matching
  ├── Location-based strategies
  └── Sector-based strategies

RUN 4: NUCLEAR_RUN4 (solo falliti da Run3)
  ├── 20+ metodi combinati
  ├── Vision Extractor (screenshot -> LLM)
  ├── Identity Resolver (registry scraping)
  └── Google Dorking avanzato
```

### 3.2 Pipeline OMEGA v6 (MasterPipeline)

```
STAGE 0: InputNormalizer
  └── NFC encoding, legal suffix strip, province extraction, quality score

STAGE 1: ShadowRegistry
  └── SQLite readonly lookup (P.IVA, ragione_sociale, FTS5 fuzzy)

STAGE 2: Email Domain
  └── Se email non-generica → probe diretto su www.{domain}

STAGE 3: HyperGuesser
  └── company_name → domain probe su .it TLD

STAGE 4: SERP Company Search
  └── CostRouter waterfall (Bing → DDG → Serper → fallback)

STAGE 5: SERP Registry Search
  └── site:registroimprese.it OR site:informazione-aziende.it

ENRICHMENT PHASE (Parallelo):
  ├── BilancioHunter → fatturato via PDF/snippet
  └── LinkedInSniper → decision maker via SERP LinkedIn
```

---

## 4. GESTIONE ERRORI E RESILIENZA

### 4.1 Matrice degli Errori

| Errore                    | Categoria | Azione                    | Retry? |
|--------------------------|-----------|---------------------------|--------|
| Timeout HTTP             | NETWORK   | Fallback al provider next | Si x3  |
| 401/403 API              | AUTH      | Disabilita provider       | No     |
| 429 Rate Limit           | AUTH      | Backoff esponenziale      | Si x3  |
| Browser crash            | BROWSER   | Recycle istanza           | Si x1  |
| JSON parse error         | PARSING   | Return null + log         | No     |
| Redis down               | NETWORK   | Degrada a L1-only         | No     |
| Cloudflare challenge     | BROWSER   | Turnstile auto-solve      | Si x1  |
| Sito parcheggiato        | N/A       | Cache per 7 giorni        | No     |
| Provider esaurito        | AUTH      | Skip nel CostRouter       | No     |
| Memory > threshold       | SYSTEM    | Log warning (no exit)     | N/A    |

### 4.2 Circuit Breaker (StopTheBleedingController)

```
ATTIVAZIONE:
  - Costo medio/azienda > 0.04 EUR
  - Error rate globale > 25%
  - Concorrenza bloccata a 1 + coda > 50

EFFETTI:
  - Concorrenza forzata a 3
  - SERP limitato a Tier 1 (gratuito)
  - LLM Oracle disabilitato
  - Enrichment parallelo disabilitato

RECOVERY:
  - Automatico dopo 10 minuti di stabilita'
```

### 4.3 BackpressureValve — AIMD Algorithm

```
ADDITIVE INCREASE:  error_rate < 5% AND avg_ms < 3000 → concurrency++
MULTIPLICATIVE DEC: error_rate > 15% OR avg_ms > 8000 → concurrency /= 2
EMERGENCY MODE:     error_rate > 30% → concurrency = 1
```

---

## 5. CACHING STRATEGY

### 5.1 Architettura a Due Livelli

```
                    ┌────────────────┐
                    │   LOOKUP       │
                    │                │
                    │  1. L1 (Map)   │ ← In-memory, max 20K entries, 50MB, TTL max 300s
                    │  2. L2 (Redis) │ ← Persistent, TTL configurabile, auto-backfill L1
                    │  3. MISS       │ ← Nessun hit → chiamata reale
                    └────────────────┘

WRITE PATH:
  1. Scrivi L1 (sincrono)
  2. Scrivi L2 (fire-and-forget, non blocca)

DEGRADATION:
  - Redis down → L1-only mode (automatico)
  - L1 piena → eviction 20% delle entry piu' vecchie
```

### 5.2 Namespace delle Chiavi Redis

```
router_cache:*       → Risultati SERP cachati (TTL: 1h)
omega:parked:*       → Domini parcheggiati (TTL: 7d)
omega:cloudflare:*   → Domini con CF (TTL: 7d)
omega:oracle_guard:* → Cooldown LLM Oracle (TTL: 24h)
omega:runnerups:*    → Candidati secondari (TTL: 30d)
omega:ratelimit:*    → Sliding window rate limiting
enrichment:*         → Risultati enrichment BullMQ
```

---

## 6. MONITORING E OSSERVABILITA'

### 6.1 Metriche da Monitorare

```
# PIPELINE
pipeline_companies_processed_total
pipeline_companies_found_rate
pipeline_avg_cost_per_company_eur
pipeline_run_duration_seconds

# COST ROUTER
cost_router_provider_calls_total{provider, success}
cost_router_provider_latency_ms{provider}
cost_router_cache_hit_rate{level}
cost_router_provider_error_rate{provider}

# BROWSER POOL
browser_pool_instances_active
browser_pool_instances_recycled_total
browser_pool_errors_total
browser_pool_nav_duration_ms

# BACKPRESSURE
backpressure_current_concurrency
backpressure_queue_depth
backpressure_adjustments_total
backpressure_emergency_mode_active

# REDIS/CACHE
cache_l1_size
cache_l1_memory_bytes
cache_l1_evictions_total
cache_l2_hit_rate
redis_healthy
```

### 6.2 Alert Critici

```
ALERT bleeding_mode_active:
  WHEN StopTheBleedingController.isBleedingModeActive = true
  FOR  > 5 minuti
  ACTION: Telegram notification

ALERT provider_exhaustion:
  WHEN AllProvidersExhausted error count > 10 in 5 min
  ACTION: Telegram + pause scheduler

ALERT cost_runaway:
  WHEN avg_cost_per_company > 0.06 EUR
  ACTION: HALT pipeline, human intervention required

ALERT browser_crash_loop:
  WHEN browser_pool_errors_total > 40
  ACTION: Kill all Chrome, restart pool

ALERT redis_down:
  WHEN redis_healthy = false
  FOR  > 2 minuti
  ACTION: Log warning, monitor degradation
```

---

## 7. DEPLOYMENT E OPERAZIONI

### 7.1 Pre-flight Checklist

```
[ ] Redis raggiungibile e con < 70% memoria
[ ] Almeno 1 API key SERP valida (SERPER_API_KEY)
[ ] Almeno 1 API key LLM valida (OPENAI_API_KEY o Z_AI_API_KEY)
[ ] Chrome/Chromium installato e funzionante
[ ] Input CSV validato (colonne: company_name, city obbligatorie)
[ ] Spazio disco > 2GB per log + output
[ ] RAM disponibile > 2GB (4GB raccomandato per 25 concorrenti)
[ ] Output directory scrivibile
```

### 7.2 Procedura di Avvio Standard

```bash
# 1. Build
cd pg3 && npm run build

# 2. Verifica configurazione
npx ts-node src/scripts/debug_config.ts

# 3. Avvio Worker (opzione BullMQ)
node dist/src/index.js worker &

# 4. Carica batch
node dist/src/index.js scheduler ./input.csv

# 5. OPPURE: Avvio Runner Diretto (senza BullMQ)
npx ts-node src/enricher/runner.ts ./input.csv
```

### 7.3 Procedura di Shutdown

```bash
# Graceful (raccomandato)
kill -SIGTERM <worker_pid>
# Attende completamento job in corso, chiude browser, Redis, exit 0

# Emergency (se stuck)
kill -SIGINT <worker_pid>
# Se non risponde dopo 10s:
pkill -f "chrome.*omega-browser"
kill -9 <worker_pid>

# Cleanup manuale post-crash
rm -rf /tmp/omega-browser-*
```

### 7.4 Recovery da Crash

```bash
# Il runner e' idempotente. Rilancia lo stesso comando:
npx ts-node src/enricher/runner.ts ./input.csv
# Rileva automaticamente i record gia' processati e riprende.

# Per BullMQ worker: i job falliti vanno in DLQ.
# Verifica DLQ:
# redis-cli LLEN "bull:enrichment:failed"
```

---

## 8. PROBLEMI NOTI E FIX

### 8.1 Bug Critici Identificati

| # | Severita' | File | Problema | Fix |
|---|----------|------|----------|-----|
| 1 | CRITICO | `RunnerV6.ts:296-308` | `Promise.all(records.map(...))` lancia TUTTE le company in parallelo senza limite. Con 10K record = 10K promise simultanee = OOM | Sostituire con `p-limit` o il `BackpressureValve` gia' esistente che viene bypassato a livello di batch orchestration |
| 2 | ALTO | `CostRouter.ts:99-103` | I `TokenBucketQueue` (3 istanze con setInterval) non vengono MAI puliti. `CostRouter` non ha un metodo `cleanup()` | Aggiungere `cleanup()` a CostRouter che chiama `.cleanup()` su ogni bucket |
| 3 | ALTO | `RunnerV6.ts:100,120,123,127` | `require('axios')` e `require('cheerio')` dentro le funzioni execute dei provider = require sincrono ripetuto ad ogni chiamata | Spostare gli import a livello di modulo |
| 4 | ALTO | `BrowserPool.ts:163` | Comando shell non sanitizzato: `execSync('ps aux \| grep chrome \| grep ${instance.profilePath}')`. Se `profilePath` contiene metacaratteri shell = command injection | Usare `process.kill()` con PID tracciato, non shell pipe |
| 5 | MEDIO | `SerpDeduplicator.ts:98` | `domain.includes('linkedin.com/in/')` controlla il dominio, ma `.includes('/in/')` non matcha mai perche' `domain` e' solo hostname senza path | Controllare il full URL, non il domain |
| 6 | MEDIO | `PreVerifyGate.ts:130-133` | `performParkingCheck` ha sia handler `on('end')` che `on('close')`, entrambi chiamano `resolve()`. Double-resolve = la Promise risolve due volte (nessun crash, ma comportamento imprevisto) | Usare un flag `resolved` per evitare double-resolve |
| 7 | MEDIO | `MasterPipeline.ts:169` | `confidence: 0.95` hardcoded per ogni risultato trovato, indipendentemente dal metodo di discovery. Un risultato HyperGuesser non ha la stessa confidence di una PIVA match | Propagare la confidence reale dal layer di discovery |
| 8 | MEDIO | `MemoryFirstCache.ts:94-96` | `getL1Key` usa SHA256 troncato a 16 char. 16 hex char = 64 bit di spazio. Con 20K entries la probabilita' di collisione e' ~0.0001% — accettabile ma non ideale | Estendere a 32 char per sicurezza o usare full hash |
| 9 | BASSO | `BackpressureValve.ts:88` | Typo: "ACTIVED" dovrebbe essere "ACTIVATED" | Fix stringa |
| 10 | BASSO | `BrowserPool.ts:246` | `blocked_resources: 10` hardcoded come "Approx" — non riflette il conteggio reale | Tracciare il conteggio reale nelle request intercettate |
| 11 | BASSO | `StopTheBleedingController.ts:56` | La condizione di recovery richiede 10 minuti SENZA chiamare `evaluateStatus()` con `shouldBleed=false`. Ma `evaluateStatus` viene chiamata per OGNI company, quindi la recovery dipende dal throughput | La logica di recovery e' fragile: usare un timestamp di ultimo `shouldBleed=true` |
| 12 | MEDIO | `CostLedger.ts:69` | `fs.appendFile` con callback (non async). Se il processo crasha durante flush, le entry pendenti vengono perse | Usare `fs.promises.appendFile` con await, o almeno un buffer di recovery |
| 13 | MEDIO | `DistributedRateLimiter.ts:38` | `zadd` aggiunge entry ma non c'e' mai un `zremrangebyscore` per pulire le entry vecchie. Il sorted set cresce indefinitamente | Aggiungere cleanup delle entry scadute |
| 14 | ALTO | `runner.ts:354` | `mergeResults()` non include run4 nella merge finale dei valid se il file non esiste, MA il merge degli invalid/notfound di run3 ignora che run4 potrebbe averli risolti — possibili duplicati | Rivedere la logica di merge per essere fully composable |

### 8.2 Inefficienze Architetturali

1. **Duplicazione Engine**: `enricher/runner.ts` e `foundation/RunnerV6.ts` fanno la stessa cosa in modi diversi. Unificare.
2. **Duplicazione Browser**: `enricher/core/browser/factory_v2.ts` e `foundation/BrowserPool.ts` sono due implementazioni del browser management.
3. **Duplicazione Rate Limiter**: `enricher/core/rate_limiter.ts`, `enricher/utils/rate_limit.ts`, `enricher/core/ai/rate_limiter.ts`, `foundation/DistributedRateLimiter.ts` — 4 implementazioni diverse.
4. **Config Sprawl**: `enricher/config.ts` (Zod-validated) coesiste con `foundation/RunnerV6.ts` (hardcoded `process.env`). L'OMEGA v6 non usa la config validata.
5. **Logger Disconnesso**: `enricher/utils/logger.ts` (strutturato) vs `foundation/*.ts` (usa `console.log` diretto). L'OMEGA v6 non beneficia del logger strutturato.

---

## 9. PROMPT OPERATIVO PER SESSIONI DI LAVORO

Quando inizi una sessione di lavoro su questo progetto, usa questo prompt come contesto iniziale:

```
Sei un ingegnere senior che lavora su PG-Scraper, un sistema di lead enrichment
per aziende italiane. Il sistema:

1. Riceve un CSV con nomi aziende + citta'
2. Cerca il sito web ufficiale tramite SERP multi-provider
3. Valida il sito con LLM + P.IVA matching
4. Arricchisce con dati finanziari e decision maker
5. Produce un CSV pulito con tutti i dati

Stack: TypeScript, Node.js, Puppeteer-Real-Browser, Redis, BullMQ, SQLite, OpenAI/GLM-5

Regole operative:
- LEG-001: Zero silent drops
- LEG-002: Max 0.04 EUR/azienda
- LEG-008: Free providers first
- LEG-009: Browser as last resort
- LEG-010: Ogni run e' riprendibile

File chiave:
- pg3/src/enricher/runner.ts — Pipeline principale (4-run)
- pg3/src/enricher/worker.ts — BullMQ worker
- pg3/src/foundation/RunnerV6.ts — OMEGA v6 (sperimentale)
- pg3/src/foundation/MasterPipeline.ts — Core logic v6
- pg3/src/foundation/CostRouter.ts — Provider waterfall con caching
- pg3/src/enricher/config.ts — Configurazione validata
- pg3/src/enricher/core/discovery/unified_discovery_service.ts — Discovery engine
- pg3/src/enricher/core/ai/prompt_templates.ts — Prompt LLM
```

---

## 10. CHECKLIST QUALITA' PRE-RELEASE

```
[ ] npm run typecheck passa senza errori
[ ] npm run test:unit passa (tutti i test unitari)
[ ] npm run test:smoke passa (test integrazione con Redis)
[ ] Nessun `any` non giustificato nel codice nuovo
[ ] Nessun catch vuoto nel codice nuovo
[ ] Ogni nuova API key e' in .env.example
[ ] Ogni nuova soglia/timeout e' in config.ts (non hardcoded)
[ ] Logger strutturato usato (non console.log diretto)
[ ] reason_code presente per ogni percorso di errore/not-found
[ ] Graceful shutdown testato manualmente
[ ] Output CSV verificato con campione di 100 record
[ ] Costo medio verificato < 0.04 EUR/azienda su campione
```
