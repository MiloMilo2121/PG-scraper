# THE OMEGA CODEX: TOOLS MANIFEST

> **STATUS 2026-04-28:** questo manifest descrive la vecchia superficie
> `src/agent_tools/*`. Il percorso ufficiale agent-first e ora
> `src/agent/agent_scraper.ts` con `runScraper(...)`, esposto anche da CLI
> `npm run agent` e dai tool MCP `agent_run` / `agent_inspect_run`. Usa
> `docs/AGENT_FIRST_CONTRACT.md` come contratto primario; questo file resta
> come riferimento storico per i micro-executors legacy.

Questo documento descrive le interfacce strettamente governate (Micro-Executors) che l'Agente deve invocare per interagire con l'infrastruttura di PG3. Ogni tool esposto maschera la logica complessa sottostante (i veri file in `src/foundation/`) garantendo output prevedibili tramite CLI.

Gli entrypoint in questo manifest si trovano nel path legacy `src/agent_tools/`.

> **⚠️ WIREUP NOTE:** Il futuro cablaggio dei micro-executors alla logica reale di PG3 DEVE passare per `createOmegaRuntime()` (definito in `src/enricher/runtime/runtime_factory.ts`). Non istanziare mai `MasterPipeline` manualmente: richiede 13 dipendenze iniettate, molte delle quali sono ancora stub.

---

## TOOL: discover_target

*   **Name:** `discover_target`
*   **Mode:** `DISCOVER`
*   **Implementation Status:** `PARTIAL` — V1 esegue normalizzazione + validazione URL. La discovery attiva (SERP, HyperGuesserVX) vive dentro `MasterPipeline` e non è ancora cablata a questo executor.
*   **Entrypoint:** `npx tsx src/agent_tools/discover_target.ts`
*   **Cost Tier:** `Free`
*   **Underlying Core:** `InputNormalizer.ts`, `InputWebsiteCandidate.ts`
*   **Description:** Normalizza nome azienda, P.IVA e URL in ingresso. Se viene fornito un URL, lo valida e genera varianti candidate (con/senza www, http/https). **Non esegue ricerca attiva di domini** — per discovery completa usare `run_pipeline_module` o il worker.
*   **Required Env:** Nessuna.
*   **Inputs:** `--query "Nome Azienda SPA"` `--url "azienda.it"` `--piva "01234567890"` (tutti opzionali, almeno uno richiesto tra query e url)
*   **Outputs (JSON):**
    ```json
    {
      "status": "SUCCESS",
      "normalizedInput": {
        "company_name": "Nome Azienda SPA",
        "company_name_variants": ["Nome Azienda", "Nome Azienda SRL", "Nome Azienda S.R.L."],
        "city": "",
        "website": "https://azienda.it",
        "vat_code": "01234567890",
        "quality_score": 0.85
      },
      "domainAssessment": {
        "classification": "VALID",
        "reasonCode": null,
        "candidates": ["https://azienda.it", "https://www.azienda.it"]
      }
    }
    ```
*   **Failure Modes:** `ERR_INVALID_ARGS` (nessun input), `ERR_INTERNAL_FAULT` (eccezione interna)
*   **Fallbacks:** Nessuno. Questo è il tool più primitivo, non ha dipendenze esterne.
*   **Safe to Parallelize:** `true`

---

## TOOL: enrich_target

*   **Name:** `enrich_target`
*   **Mode:** `ENRICH`
*   **Implementation Status:** `SCAFFOLDED` — Interfaccia CLI pronta, logica business non ancora cablata. Restituisce `status: "DEFERRED"`.
*   **Entrypoint:** `npx tsx src/agent_tools/enrich_target.ts`
*   **Cost Tier:** `Medium/High` (A seconda dei moduli richiesti)
*   **Underlying Core (futuro wireup):** `FatturatoItaliaProvider.ts`, `LinkedInSniper.ts`, `PecHunter.ts`, `BilancioHunter.ts` — tutti VERIFIED.
*   **Description:** Lancia l'arricchimento verticale di un'azienda. Non deve MAI essere usato senza un dominio/profilo verificato al round precedente.
*   **Required Env:** Chiavi provider/proxy in `.env`.
*   **Inputs:** `--url "https://azienda.it"` `--modules "financial,pec,social"`
*   **Outputs (JSON — futuro):** `{ "status": "SUCCESS", "revenue": "1.2M", "employees": 15, "pec": "azienda@pec.it", "social": { "linkedin": "...", "instagram": "..." } }`
*   **Failure Modes:** `ERR_PROXY_BLOCKED`, `ERR_TIMEOUT`, `NO_DATA`
*   **Fallbacks:** Ritorna i moduli parziali che hanno avuto successo e `null` sugli altri (No crash).
*   **Safe to Parallelize:** `false` (Richiede monitoraggio rate-limits).

---

## TOOL: run_pipeline_module

*   **Name:** `run_pipeline_module`
*   **Mode:** `ENRICH / QUALIFY`
*   **Implementation Status:** `SCAFFOLDED` — Interfaccia CLI pronta, logica business non ancora cablata. Restituisce `status: "DEFERRED"`.
*   **Entrypoint:** `npx tsx src/agent_tools/run_pipeline_module.ts`
*   **Cost Tier:** `Varies`
*   **Underlying Core (futuro wireup via `createOmegaRuntime()`):** `MasterPipeline.ts`, `PreVerifyGate.ts`
*   **Description:** Applica un batch ridotto o un run di pipeline complesso sfruttando il master pipeline esistente, filtrando i job invalidi in partenza. Usato per i CSV strutturati.
*   **Required Env:** Proxy stack, Redis (se configurato).
*   **Inputs:** `--source "path/to/batch.csv"` `--preset "B2B_Lombardia"`
*   **Outputs (Text/Log — futuro):** Conferma di trigger del job e path dei risultati generati.
*   **Failure Modes:** `ERR_GATE_REJECTED` (file malformato o già processato).
*   **Fallbacks:** Genera file logica limitata con mock data o ignora la wave fallita.
*   **Safe to Parallelize:** `false` (Innesca meccanismi di backpressure).

---

## TOOL: qualify_target

*   **Name:** `qualify_target`
*   **Mode:** `QUALIFY`
*   **Implementation Status:** `SCAFFOLDED` — Interfaccia CLI pronta, logica di scoring non ancora cablata. Restituisce `status: "DEFERRED"` con mock score.
*   **Entrypoint:** `npx tsx src/agent_tools/qualify_target.ts`
*   **Cost Tier:** `LLM Inference`
*   **Underlying Core (futuro wireup):** `LLMOracleGuard.ts` (VERIFIED). **`VisionExtractor.ts` è uno STUB** (~38 righe, ritorna `null` — non funzionale).
*   **Description:** Passa i payload di enrichment raccolti all'LLM per calcolare il "Visual-Product Score" e validare l'opportunità Lead.
*   **Required Env:** API Key Anthropic / OpenAI nel .env locale di pg3.
*   **Inputs:** `--data-path "path/to/enriched_lead.json"`
*   **Outputs (JSON — futuro):** `{ "score": 85, "tier": "Tier 1", "reason": "Prodotti ottimi ma reel di 1Mese fa." }`
*   **Failure Modes:** `ERR_LLM_TIMEOUT`, `ERR_LLM_HALLUCINATION`.
*   **Fallbacks:** Assegna Score = 0 automatico se l'input strutturale manca (Early rejection).
*   **Safe to Parallelize:** `true`

---

## TOOL: inspect_run

*   **Name:** `inspect_run`
*   **Mode:** `OBSERVE`
*   **Implementation Status:** `SCAFFOLDED` — Interfaccia CLI pronta, connessione a DB/Redis non ancora cablata. Restituisce `status: "DEFERRED"`.
*   **Entrypoint:** `npx tsx src/agent_tools/inspect_run.ts`
*   **Cost Tier:** `Free`
*   **Underlying Core (futuro wireup):** DB SQLite via `src/enricher/db/`, Redis queue state.
*   **Description:** Ispeziona lo stato di un job in corso o di un target specifico nel database locale.
*   **Required Env:** Nessuna per la V1 scaffolded.
*   **Inputs:** `--job-id "12345"`
*   **Outputs (JSON — futuro):** `{ "status": "SUCCESS", "job_id": "12345", "state": "COMPLETED", "records_processed": 45, "records_failed": 2 }`
*   **Failure Modes:** `ERR_INVALID_ARGS`, `ERR_DB_OFFLINE`
*   **Fallbacks:** Nessuno.
*   **Safe to Parallelize:** `true`

---

## ⚠️ PROPOSED / STUBS (Non disponibili all'agente in V1)

I seguenti concetti esistono nel codice base in forma embrionale ma **NON SONO** disponibili come tool operativi:

| Componente | File Size | Stato Reale | Note |
|---|---|---|---|
| `CostLedger.ts` | 53 bytes | Stub vuoto | L'agente deve vigilare manualmente sul Tier dei costi. |
| `CostRouter.ts` | 54 bytes | Stub vuoto | Il routing dei costi è gestito dall'agente esterno, non internamente. |
| `BackpressureValve.ts` | 61 bytes | Stub vuoto | La backpressure non è attiva nella V1 standalone. |
| `BrowserPool.ts` | 55 bytes | Stub vuoto | Il browser pooling è gestito dal runtime (`createOmegaRuntime()`). |
| `MemoryFirstCache.ts` | 58 bytes | Stub vuoto | Cache non attiva in V1. |
| `VisionExtractor.ts` | 1.5 KB | Placeholder | Ha una classe ma `extractPiva()` ritorna sempre `null`. Non funzionale. |
| `provider_adapter.ts` | 60 bytes | Stub vuoto | — |
| `runtime_factory.ts` (foundation) | 53 bytes | Stub vuoto | Non confondere con `src/enricher/runtime/runtime_factory.ts` che è REALE. |
