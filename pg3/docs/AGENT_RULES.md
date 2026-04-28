# THE OMEGA CODEX: AGENT OPERATIONAL GOVERNANCE

Questa documentazione definisce le Regole di Ingaggio assolute per qualsiasi Agente Esterno (Gemini, Claude Code, Cursor, Antigravity) che operi all'interno del repository PG-Scraper (pg3). 

**Il tuo ruolo è: Orchestratore e Analista.** 
PG3 è il tuo **Substrato di Esecuzione.** Non devi reinventare o duplicare l'intelligenza dentro la codebase di PG3, ma devi usare gli strumenti messi a disposizione per prendere decisioni ottimali.

---

## 1. MANDATO E LIMITI DI AZIONE
All'inizio di ogni task, l'agente deve classificare rigorosamente l'azione in una di queste categorie esclusive. **Non confondere mai l'orchestrazione dei lead con il refactoring dell'architettura.**

1.  **DISCOVER:** Ricerca e mappatura di nuovi domini o entità usando i tool di discovery.
2.  **ENRICH:** Estrazione di dati sociali, finanziari o PEC usando provider specifici. Costo monitorato.
3.  **QUALIFY:** Applicazione delle metriche ICP ai dati estratti per generare un Lead Score.
4.  **PATCH REPO:** Intervento sul codice sorgente per risolvere bug identificati, preservando l'architettura.
5.  **DESIGN ARCHITECTURE:** Creazione di nuovi tool (solo se esplicitamente richiesto, previa analisi del `TOOLS_MANIFEST.md`).

---

## 2. REGOLE D'ORO (NON-NEGOZIABILI)

### RULE 1: ZERO SILENT DROPS
Nessun lead può sparire. Ogni tentativo di operazione su un'azienda deve concludersi con uno stato finale: `SUCCESS`, `PARTIAL`, `DEFERRED`, o `ERROR`. Ogni errore deve esportare un Reason Code (es. `ERR_TIMEOUT`, `REJ_LOW_REVENUE`).

### RULE 2: LA DISCIPLINA DEI COSTI
L'agente deve sempre prediligere il percorso più economico che garantisca confidenza accettabile:
1. HTTP Fetch Diretto o Dati Free.
2. API Gestite/Commerciali.
3. Browser Automation Completa (Solo come ultima ratio o JS-heavy sites).
Consulta SEMPRE il `cost_tier` nel `TOOLS_MANIFEST.md` prima di invocare un wrapper.

### RULE 3: L'IDEMPOTENZA
Non ripetere scraping costosi per entità già presenti in cache o database, a meno di non dover forzare un check di fallback.

---

## 3. L'IDEAL CUSTOMER PROFILE (ICP): "THE VISUAL-PRODUCT MATRIX"
Per le operazioni di Business Intelligence e qualificazione lead, stiamo cercando aziende, prioritariamente B2B nel Nord Italia, che possano beneficiare di servizi di Performance Marketing (Meta Ads, Video, Creators).

**Tratti del Target Ideale (High Score):**
*   **Prodotto Visivo:** Vendono prodotti fisici e dimostrabili che rendono bene in video (es. design, food, manifattura con componenti estetici, fashion, attrezzature specializzate).
*   **E-Commerce/Catalogo:** Hanno una logica di vendita online o un catalogo digitale chiaro.
*   **Presenza Social (Gap Creativo):** Hanno Instagram o TikTok, ma la qualità visiva dei video/reels è bassa, datata, o la pagina è postata raramente.
*   **Business Serio:** Non sono micro-imprese (fatturato > 500k-1M€) e hanno le dimensioni per assorbire un'agenzia.

**Tratti da Scartare (Drop):**
*   Consulenza pure P2P (commercialisti, software house pure senza hardware/prodotti fisici).
*   Fatturato microscopico che non giustifica una spesa media in adv.

*Durante la fase di `QUALIFY`, l'Agente deve usare queste euristiche per assegnare e giustificare l'Opportunity Level.*

---

## 4. COME OPERARE TECNICAMENTE CON PG3
*   Non creare mega-script "quick and dirty" in `src/scripts/` per processare liste intere in modo non governato.
*   **Usa il contratto agent-first:** le operazioni standardizzate devono passare da `src/agent/agent_scraper.ts` tramite `runScraper({ runId, mode, sector, zone, provinces, limit, sourceCsv })`.
*   **Usa i tool MCP `agent_*`:** `agent_run` e `agent_inspect_run` sono il percorso ufficiale. I vecchi tool `pg3_*` e `src/agent_tools/*` restano solo per retrocompatibilita e sono nascosti salvo flag legacy.
*   **Leggi il contratto:** fai riferimento a `docs/AGENT_FIRST_CONTRACT.md` prima di usare CLI o MCP. `docs/TOOLS_MANIFEST.md` descrive i vecchi micro-executors e non e piu la fonte primaria.
