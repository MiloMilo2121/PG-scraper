# Legacy Inventory

Status date: 2026-04-28

Purpose: classify PG3 files so agents can distinguish active runtime from
legacy compatibility, generated artifacts, and future delete candidates.

## Categories

| Category | Meaning |
|---|---|
| `ACTIVE_RUNTIME` | Production worker/server runtime. Do not move without migration tests. |
| `AGENT_FIRST_RUNTIME` | Canonical agent contract, CLI, artifacts, registry, and backends. |
| `MCP_RUNTIME` | Tooling runtime executed via `tsx`, not compiled into production `dist`. |
| `LEGACY_COMPAT` | Supported only for backwards compatibility. Hidden or deprecated. |
| `OBSOLETE_DOC` | Historical doc. Useful for context but not operational guidance. |
| `GENERATED_ARTIFACT` | Runtime output/cache/log/profile. Must not be tracked. |
| `DELETE_CANDIDATE` | Can be removed in a future cleanup after final reference check. |
| `KEEP_FOR_NOW` | Not canonical, but removal risk is still too high. |

## Active Runtime

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/src/index.ts` | `ACTIVE_RUNTIME` | npm `start:*`, Docker, production worker/server | Breaks production process entrypoint | Keep |
| `pg3/src/enricher/**` | `ACTIVE_RUNTIME` | worker, scheduler, agent enrichment backend | Breaks queue, DB, enrichment stages | Keep |
| `pg3/src/scraper/generate_campaign_v2.ts` | `ACTIVE_RUNTIME` | agent campaign backend | Breaks `mode='campaign'` and `mode='full'` | Keep until campaign backend is replaced |
| `pg3/src/shared-runtime/**` | `ACTIVE_RUNTIME` | scraper, enricher, agent, tests | Breaks shared config/routing/browser contracts | Keep |

## Agent-First Runtime

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/src/agent/agent_scraper.ts` | `AGENT_FIRST_RUNTIME` | CLI, MCP `agent_run`, tests | Removes canonical contract | Keep |
| `pg3/src/agent/agent_contracts.ts` | `AGENT_FIRST_RUNTIME` | `runScraper`, tests, public export | Removes strict request/result schema | Keep |
| `pg3/src/agent/agent_artifacts.ts` | `AGENT_FIRST_RUNTIME` | `runScraper`, artifact tests | Removes `report.json`/`run.log` path contract | Keep |
| `pg3/src/agent/agent_run_registry.ts` | `AGENT_FIRST_RUNTIME` | inspect CLI, MCP inspect | Removes run lookup | Keep |
| `pg3/src/agent/backends/*.ts` | `AGENT_FIRST_RUNTIME` | `runScraper` dispatch | Breaks campaign/enrichment/full modes | Keep |
| `pg3/src/agent/agent_scraper_cli.ts` | `AGENT_FIRST_RUNTIME` | npm `agent`, CLI smoke | Removes human/agent CLI | Keep |
| `pg3/src/agent/agent_inspect_cli.ts` | `AGENT_FIRST_RUNTIME` | npm `agent:inspect`, CLI smoke | Removes artifact inspection CLI | Keep |
| `pg3/src/agent/index.ts` | `AGENT_FIRST_RUNTIME` | public import barrel | Removes stable import surface | Keep |

## MCP Runtime

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/src/mcp_server.ts` | `MCP_RUNTIME` | `npx tsx src/mcp_server.ts`, `start_mcp.sh` | Removes MCP stdio server | Keep, excluded from production build |
| `pg3/src/mcp/mcp_tools.ts` | `MCP_RUNTIME` | MCP server, MCP registration tests | Removes testable MCP registration | Keep, excluded from production build |
| `pg3/start_mcp.sh` | `MCP_RUNTIME` | manual MCP startup | Breaks existing local MCP workflow | Keep |

## Legacy Compatibility

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/src/agent_tools/discover_target.ts` | `LEGACY_COMPAT` | legacy MCP `pg3_discover_target`, docs | Breaks legacy users only | Move/archive after one release cycle |
| `pg3/src/agent_tools/enrich_target.ts` | `LEGACY_COMPAT` | legacy MCP `pg3_enrich_target`, docs | Breaks legacy users only | Move/archive after one release cycle |
| `pg3/src/agent_tools/qualify_target.ts` | `LEGACY_COMPAT` | legacy MCP `pg3_qualify_target`, docs | Breaks scaffolded legacy flow only | Delete candidate after MCP legacy sunset |
| `pg3/src/agent_tools/inspect_run.ts` | `LEGACY_COMPAT` | legacy MCP `pg3_inspect_run`, docs | Breaks legacy job-id inspect only | Delete candidate after MCP legacy sunset |
| `pg3/src/agent_tools/run_pipeline_module.ts` | `LEGACY_COMPAT` | legacy MCP `pg3_run_pipeline_module`, docs | Breaks scaffolded legacy flow only | Delete candidate after MCP legacy sunset |
| `pg3/docs/TOOLS_MANIFEST.md` | `LEGACY_COMPAT` | human docs | Could remove historical tool context | Keep as explicitly marked historical |

## Keep For Now

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/src/scraper/runner.ts` | `KEEP_FOR_NOW` | old operational scripts/docs may still reference it | Could break manual legacy campaigns | Keep until references are fully retired |
| `pg3/src/scraper/scrape_immobiliare_agencies.ts` | `KEEP_FOR_NOW` | unit test/provider workflow context | Could remove useful provider-specific extractor | Keep, not canonical |
| `pg3/src/LANDING/**` | `KEEP_FOR_NOW` | build copies to `dist/src/` | Build assumes directory exists | Keep until server surface is audited |
| `pg3/ops/*.sh` | `KEEP_FOR_NOW` | deployment/manual ops | Could break local operational workflows | Keep, document as non-agent-first |

## Historical Docs

| Path | Category | Called by | Risk if removed | Action |
|---|---|---|---|---|
| `pg3/docs/historical_logs_error_report_2026-03-16.md` | `OBSOLETE_DOC` | human research | Low | Archive later under `docs/archive/` |
| `pg3/docs/enrichment_historical_falsification_2026-03-16.md` | `OBSOLETE_DOC` | human research | Low | Archive later under `docs/archive/` |
| `pg3/docs/enrichment_bulletproof_research_2026-03-16.md` | `OBSOLETE_DOC` | human research | Low | Archive later under `docs/archive/` |
| `pg3/docs/enrichment_tools_landscape_2026-03-16.md` | `OBSOLETE_DOC` | human research | Low | Archive later under `docs/archive/` |
| `pg3/docs/deep_research_stack_2026-04-03.md` | `OBSOLETE_DOC` | human research | Low | Archive later under `docs/archive/` |

## Generated Artifacts

| Pattern | Category | Current tracked status | Action |
|---|---|---|---|
| `pg3/search_profile_scraper/**` | `GENERATED_ARTIFACT` | Removed from git in `5a66d42` | Keep ignored |
| `temp_profiles/**` | `GENERATED_ARTIFACT` | Removed from git in `5a66d42` | Keep ignored |
| `pg3/cost_ledger*.jsonl` | `GENERATED_ARTIFACT` | Removed from git in `5a66d42` | Runtime path now under configured runtime data dir |
| `pg3/data/municipalities_cache.json` | `GENERATED_ARTIFACT` | Removed from git in `5a66d42` | Keep ignored |

`git ls-files -ci --exclude-standard` must remain empty.

## Delete Candidates

No source file should be deleted in the next commit without a final reference
check. The first real deletion batch should target only:

| Candidate | Prerequisite |
|---|---|
| `src/agent_tools/qualify_target.ts` | Legacy MCP flag removed or a deprecation release note exists |
| `src/agent_tools/inspect_run.ts` | All docs point to `agent:inspect` / `agent_inspect_run` |
| Historical docs listed above | `docs/archive/` convention agreed and links updated |
