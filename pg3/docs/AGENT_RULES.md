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
*   **Usa il contratto agent-first:** le operazioni standardizzate devono passare da `src/agent/agent_scraper.ts` tramite `runScraper({ contractVersion, runId, mode, context, budget, sector, zone, provinces, limit, sourceCsv })`.
*   **Usa i tool MCP `agent_*`:** `agent_run` e `agent_inspect_run` sono il percorso ufficiale. I vecchi tool `pg3_*` e `src/agent_tools/*` restano solo per retrocompatibilita e sono nascosti salvo flag legacy.
*   **Leggi il contratto:** fai riferimento a `docs/AGENT_FIRST_CONTRACT.md` prima di usare CLI o MCP. `docs/TOOLS_MANIFEST.md` descrive i vecchi micro-executors e non e piu la fonte primaria.

---

## 5. AGENT-FIRST RUNBOOK (canale ufficiale da usare dal 2026-04-28)

### Entrypoint unico

Ogni campagna o arricchimento deve passare da `runScraper()`. Non usare runner, scheduler o script separati.

```ts
import { runScraper } from './src/agent/agent_scraper';

const result = await runScraper({
  contractVersion: 'agent.v1',
  runId: 'crm-2026-04-28',   // alfanumerico + trattini/underscore, max 128 car.
  mode: 'full',               // 'campaign' | 'enrichment' | 'full'
  sector: 'agenzie immobiliari',
  zone: 'Veneto',
  provinces: ['VR', 'VE', 'PD'],
  limit: 500,
  context: {
    workspaceId: 'workspace-prod',
    agentId: 'codex-cloud',
    sessionId: 'session-2026-04-28',
    actorType: 'agent',
    traceId: 'trace-2026-04-28-001',
  },
  budget: {
    maxCostPerRun: 1,
    maxCostPerCompany: 0.01,
    maxExternalCalls: 300,
    maxRunDurationMs: 600000,
  },
});
// result.status: 'completed' | 'queued' | 'running' | 'failed'
// result.error: { name, message, stack } oppure undefined
// result.artifacts: { inputCsv?, outputCsv?, reportJson, logFile, costLedger }
// result.costSummary: { totalCostEur, costPerCompanyEur, externalCalls, budgetStatus, warnings }
```

### Governance obbligatoria per agenti cloud/coworker

Ogni run avviato da un agente esterno deve includere:

| Campo | Regola |
|---|---|
| `contractVersion` | Sempre `agent.v1` finche il contratto non cambia. |
| `context.workspaceId` | Workspace, cliente o tenant proprietario del run. |
| `context.agentId` | Identita dell'agente chiamante. |
| `context.sessionId` | Sessione operativa collegata al task. |
| `context.actorType` | `agent` per Codex/Claude/Gemini, `human` per operatore manuale, `ci` per test. |
| `context.traceId` | Correlation id leggibile anche fuori dal repo. |
| `budget.*` | Sempre presente nei run non banali; usare limiti realistici invece di lasciare budget aperto. |

Se un budget configurato viene superato, `runScraper()` non lancia eccezioni:
ritorna `status='failed'`, `error.name='BudgetExceededError'`, aggiorna
`report.json`, registra `agent.budget.exceeded` in `run.log`, e scrive il ledger.

Nei run `enrichment` e `full`, il `runId` agent-first viene propagato nella
queue BullMQ come `run_id`. Ogni job mantiene anche `company_id` stabile e
`correlation_id = runId:companyId`. Le entry di costo prodotte da `CostRouter`,
`BrowserPool` e componenti runtime ereditano automaticamente questi ID.

### Modalità

| mode | Richiede | Restituisce | Status atteso |
|---|---|---|---|
| `campaign` | `sector` + (`provinces` o `zone`) | `outputCsv` con aziende trovate | `completed` |
| `enrichment` | `sourceCsv` (path assoluto esistente) | `inputCsv` copiato nel run dir | `queued` (worker BullMQ out-of-band) |
| `full` | `sector` + geo | campaign → enrichment chained | `queued` |

### CLI canonici

```bash
# Campagna discovery
npm run agent -- --mode campaign --sector "dentisti" --zone "Lombardia" --run-id mio-run-001

# Enrichment da CSV esistente
npm run agent -- --mode enrichment --source-csv /path/to/input.csv --run-id enrich-001

# Full pipeline
npm run agent -- --mode full --sector "agenzie" --provinces "MI,BG" --run-id full-001

# Run agent-first con governance/costi
npm run agent -- \
  --mode enrichment \
  --source-csv /path/to/input.csv \
  --run-id enrich-governed-001 \
  --workspace-id crm-prod \
  --agent-id codex-cloud \
  --session-id session-001 \
  --actor-type agent \
  --trace-id trace-001 \
  --max-cost-per-run 1 \
  --max-cost-per-company 0.01 \
  --max-external-calls 300 \
  --max-run-duration-ms 600000

# Ispezione run precedente
npm run agent:inspect -- --run-id mio-run-001
```

### MCP tools canonici

| Tool | Uso |
|---|---|
| `agent_run` | Tutti i mode: campaign / enrichment / full |
| `agent_inspect_run` | Leggi stato + report.json di un runId, con `costSummary` ricalcolato dai ledger |

I tool `pg3_*` sono **DEPRECATED** — funzionano per back-compat (abilitati con `PG3_ENABLE_LEGACY_MCP_TOOLS=true`) ma non usarli per nuovi flussi.

### Runtime policy: dist vs tsx

`npm run build` produce il bundle production per worker/server sotto `dist/`.

MCP e i micro-executor legacy non fanno parte del bundle production:

- `src/mcp_server.ts` gira via `npm run mcp` come runtime stdio MCP.
- `src/mcp/**` contiene la registrazione testabile dei tool MCP ed e escluso dal build production.
- `src/agent_tools/*` gira solo via `tsx` per compatibilita legacy ed e escluso dal build production.

Questa separazione e intenzionale: il core agent-first e `runScraper`, mentre MCP e legacy sono superfici operative esterne al worker production.

### Dove vivono gli artifacts

```
output/runs/
  <runId>/
    input.csv      ← copia immutabile del CSV sorgente (mode=enrichment/full)
    output.csv     ← CSV risultato del campaign (mode=campaign/full)
    report.json    ← AgentScraperResult serializzato
    run.log        ← log stream del run
    cost_ledger.jsonl ← ledger costi/governance del run
  _registry.jsonl  ← append-only, tutti i run mai eseguiti
```

Override root: variabile `AGENT_RUNS_ROOT` (default: `output/runs/` relativa al cwd).

Il ledger provider/runtime globale vive in `COST_LEDGER_PATH`, oppure in
`RUNTIME_DATA_DIR/cost_ledger.jsonl`. Dopo che i worker hanno processato i job,
usa sempre `npm run agent:inspect -- --run-id <id>` o `agent_inspect_run`: il
report letto in inspect ricalcola `costSummary` da entrambi i ledger.

### Come avviare Redis per i test smoke

Redis è necessario per `npm run test:smoke` (BullMQ). Opzioni:

```bash
# Opzione A: redis-server locale (se installato)
redis-server --port 6379 --daemonize yes --maxmemory-policy noeviction --save ""

# Opzione B: Docker (quando il daemon è disponibile)
docker compose up -d redis   # usa il docker-compose.yml in pg3/

# Verifica connessione
redis-cli ping   # → PONG
```

Poi esegui lo smoke:

```bash
OPENAI_API_KEY=test-key REDIS_URL=redis://127.0.0.1:6379/15 npm run test:smoke
```

### Quality gate (ordine raccomandato)

```bash
npm run typecheck          # tsc strict, zero errori
npm run test:unit          # unit deterministici
npm run test:smoke         # richiede Redis
npm run build              # produce dist/
```

### Cosa NON usare

- `src/scraper/runner.ts` — legacy Veneto cluster, non governato
- `src/scraper/scrape_immobiliare_agencies.ts` — script one-shot
- `src/agent_tools/*.ts` — CLI deprecati (exec-based), usare i backend diretti
- `LANDING/` endpoint `/launch` — chiama RunnerV6 legacy, verrà migrato in PR successiva
- Qualsiasi `process.exit()` dentro `src/agent/` — vietato, tutti gli errori finiscono in `result.error`

Stato di migrazione di ogni modulo: vedi `docs/refactor/LEGACY_EXTRACTION_MAP.md`.
