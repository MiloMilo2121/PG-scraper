# PROMPT DI ANALISI APPROFONDITA — PG-Scraper / ANTIGRAVITY / OMEGA ENGINE v6

> **Versione**: 1.0.0 | **Data**: 2026-02-21
> **Target**: Analisi strutturale, funzionale, architetturale e operativa dell'intero sistema.

---

## ISTRUZIONI PER L'ANALISTA (IA o Umano)

Questo prompt va usato come input iniziale per qualsiasi sessione di analisi profonda del progetto PG-Scraper (composto da `pg1` e `pg3`). L'obiettivo e' produrre un report che copra **ogni singolo strato** del sistema, senza omissioni.

---

## SEZIONE A — CONTESTO E ARCHITETTURA

Analizza il progetto rispondendo a TUTTE le seguenti domande:

### A.1 — Identita' del Sistema
1. Qual e' lo scopo preciso del sistema? (Lead generation, enrichment, scraping, scoring?)
2. Quali sono i sotto-sistemi principali? (pg1 = Hunter/Seed, pg3 = Enricher/Discovery/Financial)
3. Come comunicano tra loro pg1 e pg3? (File CSV? API? Queue? Condivisione DB?)
4. Il sistema e' monolitico, a microservizi, o ibrido?

### A.2 — Mappa dei Componenti (pg3/src/)
Per OGNI modulo/file sorgente in `pg3/src/`, rispondi:
1. Qual e' la sua responsabilita' unica?
2. Da quali altri moduli dipende?
3. Quali sono i suoi input e output?
4. Gestisce errori internamente o li propaga?
5. Contiene logica duplicata rispetto ad altri moduli?

### A.3 — Data Flow End-to-End
Ricostruisci il flusso dati COMPLETO da input CSV a output arricchito:
```
CSV Input -> InputNormalizer -> ShadowRegistry -> PreVerifyGate
          -> HyperGuesser -> SERP Discovery -> CostRouter
          -> BrowserPool (WAF Bypass) -> LLM Validation
          -> Financial Enrichment -> LinkedIn Sniper
          -> Output CSV / SQLite / Redis
```
Per ogni passaggio:
1. Che dati entrano?
2. Che trasformazione avviene?
3. Che dati escono?
4. Cosa succede in caso di errore?

---

## SEZIONE B — ANALISI DELLA QUALITA' DEL CODICE

### B.1 — Type Safety
1. Quanti `any` sono usati nel codebase? Dove?
2. Ci sono cast forzati (`as unknown as T`, `as any`)? Sono giustificati?
3. Le interfacce TypeScript coprono tutti gli edge case?
4. Il sistema usa Zod/runtime validation in tutti i boundary?

### B.2 — Error Handling
1. Quanti `catch` vuoti (`catch {}`, `catch (e) {}`) esistono?
2. Quali errori vengono silenziosamente ingoiati?
3. Esiste una strategia uniforme di error propagation?
4. Gli errori vengono categorizzati correttamente? (NETWORK, BROWSER, AUTH, PARSING)
5. Ci sono punti dove un errore non-critico viene trattato come fatale o viceversa?

### B.3 — Concurrency & Race Conditions
1. Il `BackpressureValve` gestisce correttamente le race condition tra `drain()` e `adjustConcurrency()`?
2. Il `CostLedger.ringBuffer` ha problemi di concurrent read/write?
3. Il `MemoryFirstCache` L1 (Map) e' thread-safe in contesti di alta concorrenza?
4. Il pattern `Promise.all(records.map(...))` in RunnerV6 puo' causare memory pressure?
5. `BrowserPool.acquireInstance()` ha un busy-wait loop con `setTimeout(200ms)` — e' accettabile?

### B.4 — Resource Management
1. Tutti i `setInterval` vengono puliti correttamente in tutti i path di shutdown?
2. Le connessioni Redis vengono chiuse in modo graceful?
3. I browser Chrome zombie vengono terminati in tutti gli scenari?
4. I file temporanei in `/tmp/omega-browser-*` vengono sempre puliti?
5. Il `CostLedger.flush()` e' async-safe? (Usa `fs.appendFile` callback, non `await`)

### B.5 — Security
1. Le API key sono esposte nei log o negli output?
2. I comandi shell in `BrowserPool.recycleInstance()` (`ps aux | grep | kill`) sono iniettabili?
3. Il `QuerySanitizer` previene injection nelle query SERP?
4. L'URL sanitization in `PreVerifyGate` previene SSRF?
5. Le connessioni Redis sono autenticate in produzione?

---

## SEZIONE C — ANALISI DELLE PERFORMANCE

### C.1 — Bottleneck Identification
1. Qual e' il componente piu' lento nel pipeline? (Browser? LLM? SERP?)
2. Il `CostRouter` serializza le request o le parallelizza?
3. La cache L1 (MemoryFirstCache) ha una politica di eviction efficiente?
4. Il `DistributedRateLimiter` usa sorted set senza cleanup — puo' crescere indefinitamente?
5. Il `BilancioHunter` e `LinkedInSniper` vengono eseguiti in parallelo? Come?

### C.2 — Cost Optimization
1. Il `CostRouter` usa il tier corretto per tipo di task?
2. Le chiamate LLM sono minimizzate tramite caching?
3. Quante chiamate API vengono sprecate su aziende non trovabili?
4. Il `LLMOracleGuard` filtra efficacemente i casi dove l'LLM non aggiungerebbe valore?
5. La strategia "free-first, paid-fallback" e' rispettata ovunque?

### C.3 — Scalability
1. Il sistema scala orizzontalmente? (Workers multipli?)
2. Il `ShadowRegistry` (SQLite readonly) e' un collo di bottiglia?
3. Redis e' configurato per gestire 100K+ chiavi con TTL?
4. Il `BrowserPool` con max 3 istanze e' sufficiente per batch di 10K+ aziende?

---

## SEZIONE D — ANALISI FUNZIONALE

### D.1 — Discovery Pipeline Efficacy
1. Il `HyperGuesser` (`.it` TLD only) copre abbastanza casi?
2. La `SerpDeduplicator` filtra correttamente i domini rumorosi?
3. La `PreVerifyGate` identifica correttamente i siti parcheggiati?
4. Le query SERP sono ottimizzate per il mercato italiano?
5. Il fallback da Bing -> DDG -> Serper -> Jina -> OpenAI e' robusto?

### D.2 — LLM Usage Quality
1. I prompt template in `prompt_templates.ts` sono strutturati per minimizzare hallucination?
2. Il sistema usa few-shot examples dove necessario?
3. Le risposte LLM vengono validate con schema JSON?
4. Il sistema gestisce risposte LLM malformate/parziali?
5. I modelli usati (glm-5, gpt-4o-mini, deepseek-chat) sono appropriati per i task?

### D.3 — Data Quality
1. L'`InputNormalizer` gestisce tutti i formati di input italiani? (encoding, accenti, province)
2. La validazione P.IVA e' robusta? (11 cifre, IT prefix, checksum?)
3. I numeri di telefono vengono normalizzati correttamente? (+39 prefix)
4. Le email PEC vengono riconosciute e separate dalle email normali?
5. Il `LeadScorer` produce punteggi calibrati e consistenti?

---

## SEZIONE E — PROBLEMI CRITICI IDENTIFICATI

Elenca OGNI problema trovato con:
- **Severita'**: CRITICO / ALTO / MEDIO / BASSO
- **Tipo**: BUG / INEFFICIENZA / DESIGN FLAW / SECURITY / MISSING FEATURE
- **File**: path del file
- **Riga**: numero di riga approssimativo
- **Descrizione**: cosa succede
- **Impatto**: cosa causa in produzione
- **Fix suggerito**: come risolvere

Formato:
```
| # | Severita' | Tipo         | File                  | Descrizione                   | Fix                          |
|---|-----------|--------------|----------------------|-------------------------------|------------------------------|
| 1 | CRITICO   | BUG          | RunnerV6.ts:296      | Promise.all senza backpressure| Usare p-limit o batch        |
| 2 | ALTO      | INEFFICIENZA | CostRouter.ts:99     | TokenBucket leak su cleanup   | clearInterval in destroy()   |
```

---

## SEZIONE F — RACCOMANDAZIONI STRATEGICHE

1. **Architettura**: Cosa cambieresti nella struttura generale?
2. **Testing**: Quali test mancano? Quali sono i gap di copertura?
3. **Monitoring**: Cosa monitoreresti in produzione? (Metriche, alert)
4. **CI/CD**: Il sistema e' deployabile automaticamente? Cosa manca?
5. **Documentazione**: Cosa documenteresti che oggi non lo e'?
6. **Roadmap tecnica**: Quali sono le 5 cose piu' urgenti da fare?

---

## SEZIONE G — DELIVERABLE ATTESO

L'output finale dell'analisi deve essere:

1. **Executive Summary** (max 500 parole) — per stakeholder non tecnici
2. **Technical Deep Dive** (illimitato) — con code references `file:line`
3. **Bug List** — tabella con tutti i problemi
4. **Priority Matrix** — urgenza vs impatto per ogni issue
5. **Action Plan** — step ordinati per risolvere tutto

---

## NOTE PER L'UTILIZZO

- Questo prompt funziona con qualsiasi LLM di livello frontier (Claude, GPT-4o, Gemini Ultra)
- Fornisci il codebase completo come contesto (o usa una sessione con accesso ai file)
- Per risultati ottimali, processa una sezione alla volta e valida ogni output prima di procedere
- Il prompt e' progettato per essere **idempotente**: lanciato piu' volte produce risultati consistenti
