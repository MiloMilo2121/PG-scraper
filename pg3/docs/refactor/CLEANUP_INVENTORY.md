# CLEANUP INVENTORY

**Data:** 2026-04-28  
**Totale file tracciati da git:** 1375  
**File junk/legacy:** 922+ (dominati da browser profiles)

---

## TABELLA CLASSIFICAZIONE

| Path | Tipo | Dim | Stato | Motivo | Azione | Archivio | Rischio | Note |
|------|------|-----|-------|--------|--------|----------|---------|-------|
| **BROWSER PROFILES** |
| `pg3/search_profile_scraper/` | dir | 13M | ARCHIVE_JUNK | Chrome profile generato, non fixture | git mv → `_archive/junk/browser-profiles/pg3_search_profile_scraper` | junk | ALTO: 184 file binari | Creato da browser automation, inutilizzabile |
| `temp_profiles/browser_*` (4 dirs) | dir | 44M | ARCHIVE_JUNK | Browser temp profiles da cleanup | git mv → `_archive/junk/browser-profiles/temp_profiles` | junk | ALTO: 184 file binari | Non servono per runtime |
| **OUTPUT/LOG GENERATI** |
| `pg3/cost_ledger.jsonl` | file | 388K | ARCHIVE_JUNK | Output runtime generato | git mv → `_archive/junk/output/cost_ledger.jsonl` | junk | BASSO | Ledger di costi storico |
| `pg3/cost_ledger_test10.jsonl` | file | 60K | ARCHIVE_JUNK | Output test generato | git mv → `_archive/junk/output/cost_ledger_test10.jsonl` | junk | BASSO | Test cost ledger |
| `pg1/adr-it-audit.log` | file | 168K | ARCHIVE_JUNK | Audit log vecchio | git mv → `_archive/junk/logs/pg1_adr-it-audit.log` | junk | BASSO | Log storico pg1 |
| `pg1/logs/.f890d436d69558cfa3d921993e3bd8093bdefb5a-audit.json` | file | ~10K | ARCHIVE_JUNK | NPM audit JSON | git mv → `_archive/junk/logs/pg1_npm_audit.json` | junk | BASSO | JSON di audit npm |
| `pg1/logs/adr-it-2026-04-18.log` | file | ~5K | ARCHIVE_JUNK | Log vecchio | git mv → `_archive/junk/logs/pg1_adr-it-2026-04-18.log` | junk | BASSO | Log pg1 |
| **SCRIPT ONE-SHOT / DEBUG** |
| `pg3/debug_env.js` | file | 1K | ARCHIVE_JUNK | Debug env checker | git mv → `_archive/junk/temp/debug_env.js` | junk | BASSO | One-shot script |
| `pg3/test_5_names.txt` | file | 223B | ARCHIVE_JUNK | Test input file | git mv → `_archive/junk/temp/test_5_names.txt` | junk | BASSO | Ad-hoc test |
| `pg3/test_proxy_axios.js` | file | 543B | ARCHIVE_JUNK | Proxy test | git mv → `_archive/junk/temp/test_proxy_axios.js` | junk | BASSO | Test one-shot |
| `test_apis.js` | file | ~5K | ARCHIVE_JUNK | API tester root | git mv → `_archive/junk/temp/test_apis.js` | junk | BASSO | Root-level test |
| **DOCUMENTI CANONICI (KEEP)** |
| `pg3/docs/AGENT_RULES.md` | file | ~8K | KEEP_DOC_CANONICAL | Governance agenti | Nessuna azione | — | NESSUNO | Documento operativo fondamentale |
| `pg3/docs/TOOLS_MANIFEST.md` | file | ~15K | KEEP_DOC_CANONICAL | Micro-executor specs | Nessuna azione | — | NESSUNO | API contract |
| `pg3/docs/OBSERVABILITY.md` | file | ~5K | KEEP_DOC_CANONICAL | Telemetry setup | Nessuna azione | — | NESSUNO | Osservabilità |
| **DOCUMENTI RESEARCH/AUDIT (ARCHIVE USEFUL)** |
| `ANALYSIS_PROMPT.md` | file | ~8K | ARCHIVE_USEFUL | Prompt di analisi storico | git mv → `_archive/useful/audits/` | useful | BASSO | Reference |
| `ANTIGRAVITY_ZERO_COST_AI_UPGRADE_REPORT_2026-02-12.md` | file | 21K | ARCHIVE_USEFUL | Report audit 2026-02-12 | git mv → `_archive/useful/audits/` | useful | BASSO | Storico |
| `AUDIT_DEEP_RESEARCH_REPORT_2026-02-17.md` | file | 20K | ARCHIVE_USEFUL | Report audit 2026-02-17 | git mv → `_archive/useful/audits/` | useful | BASSO | Storico |
| `CODE_REVIEW_AUDIT_2026-02-12.md` | file | 26K | ARCHIVE_USEFUL | Code review audit | git mv → `_archive/useful/audits/` | useful | BASSO | Storico |
| `CORE_STABILIZATION_BASELINE_2026-04-10.md` | file | 1.3K | ARCHIVE_USEFUL | Stabilization baseline | git mv → `_archive/useful/audits/` | useful | BASSO | Storico |
| `ENGINEERING_READINESS_REPORT_2026-02-07.md` | file | 8K | ARCHIVE_USEFUL | Engineering report | git mv → `_archive/useful/audits/` | useful | BASSO | Storico |
| `OPERATIONAL_GUIDELINES.md` | file | ~20K | ARCHIVE_USEFUL | Guidelines L5 | git mv → `_archive/useful/docs/` | useful | BASSO | Reference architetturale |
| `plan.md` | file | ~7K | ARCHIVE_USEFUL | Planning doc | git mv → `_archive/useful/docs/` | useful | BASSO | Storico |
| `pg3/REFACTOR_LOG_2026-04-22.md` | file | 18K | ARCHIVE_USEFUL | Refactor log | git mv → `_archive/useful/docs/` | useful | BASSO | Storico |
| `pg3/REFACTOR_PLAN_2026-04-22.md` | file | 3.8K | ARCHIVE_USEFUL | Refactor plan | git mv → `_archive/useful/docs/` | useful | BASSO | Storico |
| `pg3/docs/OMEGA_V9_2026_AI_SOLUTIONS.md` | file | ~30K | ARCHIVE_USEFUL | Architecture doc V9 | git mv → `_archive/useful/docs/` | useful | BASSO | Reference |
| `pg3/docs/PIPELINE_PHASES_v2.md` | file | ~5K | ARCHIVE_USEFUL | Pipeline phases doc | git mv → `_archive/useful/docs/` | useful | BASSO | Reference |
| `pg3/docs/benchmarks/2026-03-22-pg-first-500.md` | file | ~5K | ARCHIVE_USEFUL | Benchmark report | git mv → `_archive/useful/audits/benchmarks/` | useful | BASSO | Storico |
| `pg3/docs/deep_research_stack_2026-04-03.md` | file | ~25K | ARCHIVE_USEFUL | Deep research | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/enrichment_bulletproof_research_2026-03-16.md` | file | ~20K | ARCHIVE_USEFUL | Enrichment research | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/enrichment_historical_falsification_2026-03-16.md` | file | ~18K | ARCHIVE_USEFUL | Falsification research | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/enrichment_tools_landscape_2026-03-16.md` | file | ~18K | ARCHIVE_USEFUL | Tools research | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/financial_decision_maker_deep_research_2026-03-26.md` | file | ~15K | ARCHIVE_USEFUL | Financial research | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/historical_logs_error_report_2026-03-16.md` | file | ~10K | ARCHIVE_USEFUL | Error report | git mv → `_archive/useful/audits/` | useful | BASSO | Research |
| `pg3/docs/hyperguesser_vx_prompt.md` | file | ~8K | ARCHIVE_USEFUL | Technical prompt | git mv → `_archive/useful/prompts/` | useful | BASSO | Prompt reference |
| **SCRIPT LEGACY (ARCHIVE USEFUL)** |
| `pg3/run_v6.sh` | file | ~300B | ARCHIVE_USEFUL | V6 runner script | git mv → `_archive/useful/scripts/` | useful | BASSO | Vecchio runner |
| `pg3/start_runner.sh` | file | ~400B | ARCHIVE_USEFUL | Runner launcher | git mv → `_archive/useful/scripts/` | useful | BASSO | Vecchio launcher |
| `pg3/generate_bz_csv.js` | file | 1.3K | ARCHIVE_USEFUL | CSV generator | git mv → `_archive/useful/scripts/` | useful | BASSO | Campaign generator |
| `pg3/generate_pest_control_targets.js` | file | 3.8K | ARCHIVE_USEFUL | Pest control targets | git mv → `_archive/useful/scripts/` | useful | BASSO | Campaign script |
| `pg3/tunnel/reverse_shell.js` | file | ~3K | ARCHIVE_USEFUL | Tunnel script | git mv → `_archive/useful/scripts/` | useful | BASSO | Ops tunnel |
| `pg3/ops/deploy*.sh` (7 script) | file | ~20K | ARCHIVE_USEFUL | Deployment scripts | git mv → `_archive/useful/scripts/ops/` | useful | BASSO | Legacy ops |
| `pg3/ops/mission*.sh` (5 script) | file | ~15K | ARCHIVE_USEFUL | Mission scripts | git mv → `_archive/useful/scripts/ops/` | useful | BASSO | Campaign missions |
| `pg3/ops/pull_data.sh` | file | ~2K | ARCHIVE_USEFUL | Data puller | git mv → `_archive/useful/scripts/ops/` | useful | BASSO | Data ops |
| `pg3/ops/run_*.sh` (3 script) | file | ~10K | ARCHIVE_USEFUL | Batch runners | git mv → `_archive/useful/scripts/ops/` | useful | BASSO | Batch ops |
| `pg3/scripts/*.ts` (14 file) | file | ~50K | ARCHIVE_USEFUL | Legacy utility scripts | git mv → `_archive/useful/scripts/legacy/` | useful | BASSO | Test/utility |
| `pg3/src/scripts/*.ts` (non-bench) | file | ~80K | ARCHIVE_USEFUL | Test/experiment scripts | git mv → `_archive/useful/scripts/src-scripts/` | useful | BASSO | Non referenced |
| **KEEP: CANONICAL SOURCE** |
| `pg3/src/agent_tools/` | dir | ~8K | KEEP_CANONICAL | Micro-executors | Nessuna azione | — | NESSUNO | API gateway |
| `pg3/src/enricher/` | dir | ~800K | KEEP_RUNTIME | Enrichment pipeline | Nessuna azione | — | NESSUNO | Active runtime |
| `pg3/src/foundation/` | dir | ~500K | KEEP_RUNTIME | Core foundation | Nessuna azione | — | NESSUNO | Active runtime |
| `pg3/src/shared-runtime/` | dir | ~150K | KEEP_RUNTIME | Shared runtime | Nessuna azione | — | NESSUNO | Active runtime |
| `pg3/src/scraper/` | dir | ~300K | KEEP_RUNTIME | Scraper module | Nessuna azione | — | NESSUNO | Active runtime |
| `pg3/src/mcp_server.ts` | file | ~10K | KEEP_CANONICAL | MCP server | Nessuna azione | — | NESSUNO | API interface |
| `pg3/src/index.ts` | file | ~5K | KEEP_RUNTIME | Main entry | Nessuna azione | — | NESSUNO | CLI entry |
| `pg3/src/server.ts` | file | ~3K | KEEP_RUNTIME | HTTP server | Nessuna azione | — | NESSUNO | Web server |
| `pg3/src/LANDING/` | dir | ~5K | KEEP_RUNTIME | Landing page | Nessuna azione | — | NESSUNO | Web UI |
| `pg3/src/utils/` | dir | ~5K | KEEP_RUNTIME | Utilities | Nessuna azione | — | NESSUNO | Helpers |
| `pg3/src/diagnostics/` | dir | ~2K | KEEP_RUNTIME | Diagnostics | Nessuna azione | — | NESSUNO | Health checks |
| `pg3/tests/` | dir | ~300K | KEEP_TEST | Test suite | Nessuna azione | — | NESSUNO | Unit + integration |
| `pg3/ops/oracle/` | dir | ~50K | KEEP_RUNTIME | Oracle sidecar | Nessuna azione | — | NESSUNO | Python microservice |
| `pg3/data/municipalities_cache.json` | file | ~100K | KEEP_RUNTIME | Runtime cache | Nessuna azione | — | NESSUNO | Cache data |
| `pg3/start_mcp.sh` | file | ~400B | KEEP_CANONICAL | MCP launcher | Nessuna azione | — | NESSUNO | Server launcher |
| `pg3/bootstrap_pg3.sh` | file | ~2K | KEEP_RUNTIME | Bootstrap | Nessuna azione | — | NESSUNO | Setup script |
| **BENCHMARK SCRIPTS (KEEP)** |
| `pg3/src/scripts/v8_benchmark.ts` | file | ~3K | KEEP_RUNTIME | Benchmark v8 | Nessuna azione | — | NESSUNO | npm run benchmark |
| `pg3/src/scripts/v8_benchmark_wave.ts` | file | ~4K | KEEP_RUNTIME | Benchmark wave | Nessuna azione | — | NESSUNO | npm run benchmark:wave |

---

## SUMMARY

**Totale ARCHIVE_JUNK:** 9 file + 2 dir = ~58 MB  
**Totale ARCHIVE_USEFUL:** 40+ file + 12 dir = ~400 KB  
**Totale KEEP:** ~2.5 MB (canonical + runtime + tests)

**Azioni:** 52+ git mv
