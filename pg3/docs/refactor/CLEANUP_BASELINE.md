# CLEANUP BASELINE — Pre-Archivio

**Data:** 2026-04-28  
**Branch:** `claude/cleanup-pg-scraper-X1Tzf`  
**Commit di partenza:** `e2f5c36`  
**Eseguito da:** Claude Code (cleanup agent)

---

## Stato Git

```
Branch: claude/cleanup-pg-scraper-X1Tzf
Last commits:
  e2f5c36 feat: OMEGA-VENETO mass-extraction engine industrialization & CaptchaSolver integration
  f980a27 refactor: M0-M4 pipeline stabilization — audit, security, patchright flag, oracle port
  5612f37 chore(scraper): update runner and remove stale checkpoints
```

Worktree pulito al momento del baseline (nessuna modifica staged/unstaged).

---

## Risultati Baseline

### `npm run typecheck`
**PASS** — nessun errore TypeScript.

### `npm run build`
**FAIL (PRE-ESISTENTE)** — errori in `src/mcp_server.ts`:
- `Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'`
- Parametri implicitamente `any` in più handler MCP
- Causa: il pacchetto `@modelcontextprotocol/sdk` non è nel `package.json`.
- Questa failure NON è causata dalla pulizia.

### `npm run test:unit`
**FAIL PARZIALE (PRE-ESISTENTE)** — 1 file su 73 fallisce:
- `tests/unit/preverify-gate.test.ts` — 4 test falliscono:
  - `gate.checkSemanticNameMatch is not a function`
  - `gate.checkJinaForPiva is not a function`
- 72 file test passano, 247 test passano.
- Questa failure NON è causata dalla pulizia.

### `npm run test:smoke`
**FAIL (PRE-ESISTENTE)** — Redis non disponibile su `redis://127.0.0.1:6379/15`.
- Il test richiede Redis locale che non è avviato nell'ambiente CI.
- Questa failure NON è causata dalla pulizia.

---

## File Canonici Verificati

I seguenti file sono il nucleo agent-first e sono stati confermati presenti e funzionanti:
- `src/agent_tools/discover_target.ts`
- `src/agent_tools/enrich_target.ts`
- `src/agent_tools/inspect_run.ts`
- `src/agent_tools/qualify_target.ts`
- `src/agent_tools/run_pipeline_module.ts`
- `src/mcp_server.ts` (build fail pre-esistente per MCP SDK mancante)
- `docs/AGENT_RULES.md`
- `docs/TOOLS_MANIFEST.md`
- `docs/OBSERVABILITY.md`

**Nota:** I file `pg3/src/agent/agent_scraper.ts`, `agent_contracts.ts`, `agent_inspection.ts`, `agent_doctor.ts` e gli script `agent`, `agent:inspect`, `agent:doctor` menzionati nel task description NON esistono in questo repository. La superficie canonica attuale è `src/agent_tools/`.

---

## Dipendenze Mancanti (Pre-esistenti)

- `@modelcontextprotocol/sdk` — non nel `package.json`, richiesto da `src/mcp_server.ts`

---

## Dimensioni Pre-Pulizia

| Area | Dimensione stimata |
|------|-------------------|
| `pg3/search_profile_scraper/` | 13 MB (184 file) |
| `temp_profiles/` | ~44 MB (4 browser profile) |
| `pg3/cost_ledger.jsonl` | 388 KB |
| `pg3/cost_ledger_test10.jsonl` | 60 KB |
| `pg1/adr-it-audit.log` | 168 KB |
| Root MD docs (audit/report) | ~100 KB |
| `pg3/scripts/` (legacy) | ~50 KB |
| `pg3/src/scripts/` (bench/test) | ~80 KB |
| `pg3/ops/` (mission scripts) | ~20 KB |
| `pg3/docs/` (research docs) | ~200 KB |

**Totale stimato da archiviare: ~58 MB** (dominato dai browser profiles)
