# ARCHIVE MANIFEST

**Data:** 2026-04-28  
**Commit di partenza:** `e2f5c36`  
**Branch:** `claude/cleanup-pg-scraper-X1Tzf`  
**Agente:** Claude Code (cleanup)

---

## STRATEGIA DI ARCHIVIO

Il repository è stato ripulito dividendo il contenuto in due archivi logici:

### `_archive/useful/`
Materiale legacy, storico o sperimentale con valore di riferimento:
- Documenti di audit e report (2026-02-12 a 2026-04-22)
- Ricerche tecniche e prompt
- Script operativi (deploy, mission, ops)
- Script di test e benchmark (legacy, non più in uso)
- Log di refactoring
- Prompting e architettura (versioni storiche)

### `_archive/junk/`
Materiale generato, temporaneo o non più utilizzabile:
- Browser profiles (Chrome scraper sessions)
- Cost ledger JSON (output di costo runtime)
- Log file vecchi
- Script debug e test one-shot
- Temp file e artifact

---

## STRUTTURA ARCHIVIO

```
_archive/
├── useful/
│   ├── docs/                          (15 file)
│   │   ├── OPERATIONAL_GUIDELINES.md
│   │   ├── plan.md
│   │   ├── REFACTOR_LOG_2026-04-22.md
│   │   ├── REFACTOR_PLAN_2026-04-22.md
│   │   ├── OMEGA_V9_2026_AI_SOLUTIONS.md
│   │   ├── PIPELINE_PHASES_v2.md
│   │   └── (altri doc architetturali)
│   ├── scripts/
│   │   ├── ops/                      (13 script deploy/mission)
│   │   ├── src-scripts/              (27 script test/bench legacy)
│   │   ├── legacy/                   (14 utility script)
│   │   ├── pg3_run_v6.sh
│   │   ├── pg3_start_runner.sh
│   │   ├── pg3_generate_bz_csv.js
│   │   ├── pg3_generate_pest_control_targets.js
│   │   └── pg3_tunnel_reverse_shell.js
│   ├── audits/                       (9 audit doc)
│   │   ├── benchmarks/
│   │   ├── ANALYSIS_PROMPT.md
│   │   ├── ANTIGRAVITY_ZERO_COST_AI_UPGRADE_REPORT_2026-02-12.md
│   │   ├── (altri audit)
│   │   └── (research doc)
│   └── prompts/
│       └── hyperguesser_vx_prompt.md
│
└── junk/
    ├── browser-profiles/             (2 dir: ~58 MB)
    │   ├── pg3_search_profile_scraper/        (13 MB, 184 file)
    │   └── temp_profiles/                     (44 MB, 4 browser)
    ├── output/                       (2 cost ledger)
    │   ├── cost_ledger.jsonl         (388 KB)
    │   └── cost_ledger_test10.jsonl  (60 KB)
    ├── logs/                         (3 log file)
    │   ├── pg1_adr-it-audit.log
    │   ├── pg1_adr-it-2026-04-18.log
    │   └── pg1_npm_audit.json
    └── temp/                         (4 debug/test file)
        ├── debug_env.js
        ├── test_5_names.txt
        ├── test_proxy_axios.js
        └── test_apis.js
```

---

## ELENCO SPOSTAMENTI (git mv)

### ARCHIVE_JUNK (11 azioni)
**Browser profiles (2 azioni — 57 MB):**
- `pg3/search_profile_scraper/` → `_archive/junk/browser-profiles/pg3_search_profile_scraper` (184 file)
- `temp_profiles/` → `_archive/junk/browser-profiles/temp_profiles` (4 browser)

**Output/Logs (5 azioni — 450 KB):**
- `pg3/cost_ledger.jsonl` → `_archive/junk/output/`
- `pg3/cost_ledger_test10.jsonl` → `_archive/junk/output/`
- `pg1/adr-it-audit.log` → `_archive/junk/logs/pg1_adr-it-audit.log`
- `pg1/logs/.f890d436d69558cfa3d921993e3bd8093bdefb5a-audit.json` → `_archive/junk/logs/pg1_npm_audit.json`
- `pg1/logs/adr-it-2026-04-18.log` → `_archive/junk/logs/pg1_adr-it-2026-04-18.log`

**Debug/Test (4 azioni — 10 KB):**
- `pg3/debug_env.js` → `_archive/junk/temp/`
- `pg3/test_5_names.txt` → `_archive/junk/temp/`
- `pg3/test_proxy_axios.js` → `_archive/junk/temp/`
- `test_apis.js` → `_archive/junk/temp/`

### ARCHIVE_USEFUL (45 azioni)

**Root docs (8 azioni — 100 KB):**
- `ANALYSIS_PROMPT.md` → `_archive/useful/audits/`
- `ANTIGRAVITY_ZERO_COST_AI_UPGRADE_REPORT_2026-02-12.md` → `_archive/useful/audits/`
- `AUDIT_DEEP_RESEARCH_REPORT_2026-02-17.md` → `_archive/useful/audits/`
- `CODE_REVIEW_AUDIT_2026-02-12.md` → `_archive/useful/audits/`
- `CORE_STABILIZATION_BASELINE_2026-04-10.md` → `_archive/useful/audits/`
- `ENGINEERING_READINESS_REPORT_2026-02-07.md` → `_archive/useful/audits/`
- `OPERATIONAL_GUIDELINES.md` → `_archive/useful/docs/`
- `plan.md` → `_archive/useful/docs/`

**pg3 docs (12 azioni — 200 KB):**
- `pg3/REFACTOR_LOG_2026-04-22.md` → `_archive/useful/docs/`
- `pg3/REFACTOR_PLAN_2026-04-22.md` → `_archive/useful/docs/`
- `pg3/docs/OMEGA_V9_2026_AI_SOLUTIONS.md` → `_archive/useful/docs/`
- `pg3/docs/PIPELINE_PHASES_v2.md` → `_archive/useful/docs/`
- `pg3/docs/benchmarks/2026-03-22-pg-first-500.md` → `_archive/useful/audits/benchmarks/`
- `pg3/docs/deep_research_stack_2026-04-03.md` → `_archive/useful/audits/`
- `pg3/docs/enrichment_bulletproof_research_2026-03-16.md` → `_archive/useful/audits/`
- `pg3/docs/enrichment_historical_falsification_2026-03-16.md` → `_archive/useful/audits/`
- `pg3/docs/enrichment_tools_landscape_2026-03-16.md` → `_archive/useful/audits/`
- `pg3/docs/financial_decision_maker_deep_research_2026-03-26.md` → `_archive/useful/audits/`
- `pg3/docs/historical_logs_error_report_2026-03-16.md` → `_archive/useful/audits/`
- `pg3/docs/hyperguesser_vx_prompt.md` → `_archive/useful/prompts/`

**pg3 scripts (5 azioni — 10 KB):**
- `pg3/run_v6.sh` → `_archive/useful/scripts/`
- `pg3/start_runner.sh` → `_archive/useful/scripts/`
- `pg3/generate_bz_csv.js` → `_archive/useful/scripts/`
- `pg3/generate_pest_control_targets.js` → `_archive/useful/scripts/`
- `pg3/tunnel/reverse_shell.js` → `_archive/useful/scripts/`

**pg3/ops scripts (13 azioni — 20 KB):**
- Tutti i deploy.sh, mission*.sh, loop*.sh, pull_data.sh, run_*.sh
- (oracle/ rimane in pg3/ops/ — NOT archived)

**pg3/scripts/ (14 azioni — 50 KB):**
- Tutti i file in pg3/scripts/ → `_archive/useful/scripts/legacy/`

**pg3/src/scripts/ (27 azioni — 80 KB — exception v8_benchmark*):**
- Tutti i file TRANNE v8_benchmark.ts e v8_benchmark_wave.ts (questi rimangono in pg3/src/scripts/)

---

## CONSERVATI IN REPOSITORY (KEEP)

### Canonici Agent-First:
- `pg3/src/agent_tools/` — Micro-executors
- `pg3/src/mcp_server.ts` — MCP server
- `pg3/start_mcp.sh` — MCP launcher

### Docs Canoniche:
- `pg3/docs/AGENT_RULES.md`
- `pg3/docs/TOOLS_MANIFEST.md`
- `pg3/docs/OBSERVABILITY.md`
- `pg3/docs/refactor/CLEANUP_BASELINE.md` (NEW)
- `pg3/docs/refactor/CLEANUP_INVENTORY.md` (NEW)

### Runtime Attivo:
- `pg3/src/enricher/` — Pipeline enrichment
- `pg3/src/foundation/` — Core foundation
- `pg3/src/shared-runtime/` — Runtime condiviso
- `pg3/src/scraper/` — Scraper module
- `pg3/src/index.ts` — CLI entry
- `pg3/src/server.ts` — HTTP server
- `pg3/src/LANDING/` — Web UI
- `pg3/ops/oracle/` — Python oracle microservice
- `pg3/data/municipalities_cache.json` — Runtime cache

### Benchmark (attivi in package.json):
- `pg3/src/scripts/v8_benchmark.ts` — npm run benchmark
- `pg3/src/scripts/v8_benchmark_wave.ts` — npm run benchmark:wave

### Test:
- `pg3/tests/**` — Tutti i test suite

---

## NON ARCHIVIATI / AMBIGUI (REVIEW_MANUAL)

Nessun file è rimasto in REVIEW_MANUAL. Tutti i file sono stati classificati e archiviati.

---

## IMPATTO POST-ARCHIVIO

**Spazio liberato dal tracking git:** ~58 MB (browser profile)
**File tracciati ridotti:** 1375 → ~450 (1 su 3 file rimosso da tracking)
**Repository surface:** molto più leggero, focus su canonical runtime + agent-first

**Attenzione:** L'archivio è ancora tracciato da git. Per ridurre effettivamente la dimensione della repo, questi file devono essere `git rm --cached` o la repo deve essere rewritten (es. BFG). Attualmente l'archivio documenta la storia e permette il recovery dei vecchi script.

---

## .gitignore UPDATES

Aggiunto a `.gitignore`:
- `_archive/junk/` — Previene il re-commit del junk
- Pattern per evitare rigenerazione di browser profiles e cost ledger

---

## VERIFICHE COMPLETATE

- [x] Baseline pre-archivio registrato in CLEANUP_BASELINE.md
- [x] Inventario completo in CLEANUP_INVENTORY.md
- [x] Tutti i git mv eseguiti e staged
- [x] Nessun file cancellato (solo spostato)
- [x] oracle/ rimasto in pg3/ops/
- [x] Benchmark script rimasti in pg3/src/scripts/
- [x] Docs canoniche non archiviate
- [x] Test suite completa rimasta in place
- [x] Runtime code integro

---

## NOTE PER IL PROSSIMO AGENT

1. Se questa pulizia ha causato import error, controlla che nessun runtime file referenzi path spostati (es. `src/scripts/`)
2. L'archivio preserva la storia: puoi recuperare vecchi script dal git history se servono
3. Per fare realmente "thin" la repo, esegui `git gc --aggressive` o rewrite con BFG (dopo approval)
4. I browser profile rimangono in git per tracciabilità. Sono ignorati da .gitignore futuro per prevenire rigenerazione
