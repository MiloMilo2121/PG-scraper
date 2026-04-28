# Agent-First Contract

This is the canonical surface for agents. Do not start from `src/scripts`,
`src/agent_tools`, old `pg3_*` MCP tools, or one-off shell wrappers unless a
human explicitly asks for a legacy path.

## Canonical API

```ts
import { runScraper } from '../src/agent';

await runScraper({
  contractVersion: 'agent.v1',
  runId: 'stable-id-for-this-job',
  mode: 'campaign',
  sector: 'agenzie immobiliari',
  zone: 'Veneto',
  limit: 500,
  context: {
    workspaceId: 'customer-or-workspace-id',
    agentId: 'codex-cloud-1',
    sessionId: 'operator-session-id',
    actorType: 'agent',
    traceId: 'distributed-trace-id',
  },
  budget: {
    maxCostPerRun: 1.5,
    maxCostPerCompany: 0.01,
    maxExternalCalls: 500,
    maxRunDurationMs: 600000,
  },
});
```

`runId` is mandatory and must match `[a-zA-Z0-9_-]{1,128}`. It is the stable
handle for artifacts, registry inspection, retry decisions, and user-facing
handoff.

`contractVersion` defaults to `agent.v1` and is the compatibility boundary for
agent callers. New automation should pass it explicitly.

`context` is optional but strongly recommended for cloud/coworker agents:

| Field | Meaning |
|---|---|
| `workspaceId` | Tenant, customer, or workspace that owns the run. |
| `agentId` | Calling agent identity. |
| `sessionId` | Human or automation session that initiated the work. |
| `actorType` | `human`, `agent`, `system`, or `ci`. |
| `traceId` | Cross-system trace/correlation id. |

`budget` is optional but becomes the run guardrail when present:

| Field | Meaning |
|---|---|
| `maxCostPerRun` | Maximum total EUR cost allowed for the run. |
| `maxCostPerCompany` | Maximum EUR cost per loaded/discovered/enriched company. |
| `maxExternalCalls` | Maximum counted provider calls allowed. |
| `maxRunDurationMs` | Maximum wall-clock runtime before the run is marked failed. |

## Modes

| Mode | Required fields | Result |
|---|---|---|
| `campaign` | `runId`, `sector`, one of `zone` / `provinces` | Discovers companies and writes a campaign CSV. |
| `enrichment` | `runId`, `sourceCsv` | Queues an existing CSV through the enrichment scheduler. |
| `full` | `runId`, `sector`, one of `zone` / `provinces` | Runs discovery, then queues the generated CSV for enrichment. |

`zone` accepts an Italian region, province name, or province code. `provinces`
accepts province codes or names. Optional field: `limit`.

## Canonical CLI

```bash
npm run agent -- --run-id veneto-agencies --mode campaign --sector "agenzie immobiliari" --provinces "VR,VE"
npm run agent -- --run-id veneto-enrich --mode enrichment --source-csv output/runs/veneto-agencies/output.csv
npm run agent -- --run-id lombardia-dentisti --mode full --sector "dentisti" --zone "Lombardia"
npm run agent:inspect -- --run-id lombardia-dentisti
```

For structured callers, pass a full JSON payload:

```bash
npm run agent -- --json '{"contractVersion":"agent.v1","runId":"job-001","mode":"campaign","sector":"dentisti","zone":"Lombardia","limit":100,"context":{"workspaceId":"crm","agentId":"codex","actorType":"agent","traceId":"trace-001"},"budget":{"maxCostPerRun":1,"maxCostPerCompany":0.01,"maxExternalCalls":300,"maxRunDurationMs":600000}}'
```

The same fields are also exposed as CLI flags:

```bash
npm run agent -- \
  --run-id job-001 \
  --mode enrichment \
  --source-csv /absolute/input.csv \
  --workspace-id crm \
  --agent-id codex \
  --session-id session-001 \
  --actor-type agent \
  --trace-id trace-001 \
  --max-cost-per-run 1 \
  --max-cost-per-company 0.01 \
  --max-external-calls 300 \
  --max-run-duration-ms 600000
```

## Canonical MCP Tools

| Tool | Use |
|---|---|
| `agent_run` | Canonical campaign, enrichment, or full run. |
| `agent_inspect_run` | Read registry/report by `runId`. |

The legacy `pg3_*` MCP tools are hidden unless `PG3_ENABLE_LEGACY_MCP_TOOLS=true`.

MCP is intentionally a `tsx` runtime, not part of the production `dist` bundle:

```bash
npm run mcp
```

`src/mcp_server.ts`, `src/mcp/**`, and `src/agent_tools/**` are excluded from
`tsconfig.build.json`. The production build is for worker/server runtime; the
agent contract remains `runScraper(...)`.

## Artifacts

Default root: `output/runs/{runId}/`.

| File | Meaning |
|---|---|
| `input.csv` | Copied source CSV for enrichment/full runs. |
| `output.csv` | Campaign or combined discovery output. |
| `report.json` | Final `AgentScraperResult`. |
| `run.log` | JSONL agent lifecycle log. |
| `cost_ledger.jsonl` | Append-only cost/governance ledger for the run. |
| `_registry.jsonl` | Append-only registry under `output/runs/`. |

Override the root with `AGENT_RUNS_ROOT`.

`report.json` includes `costSummary`:

```json
{
  "totalCostEur": 0,
  "costPerCompanyEur": 0,
  "externalCalls": 0,
  "budgetStatus": "within_budget",
  "warnings": []
}
```

`budgetStatus` is one of `not_configured`, `within_budget`, `warning`, or
`exceeded`. If a configured budget is exceeded, the run is marked `failed` with
`error.name = "BudgetExceededError"`.

## Golden Smoke

Redis is required for integration smoke tests:

```bash
redis-server --port 6379 --daemonize yes --maxmemory-policy noeviction --save ""
npm run test:smoke
```

The canonical fixture is `tests/fixtures/agent-enrichment-input.csv`. It is
small, deterministic, and drives the agent enrichment smoke without browser or
external API calls.

## Non-Goals

- Do not create new one-off scripts for standard campaign/enrichment work.
- Do not choose between historical V6/V7/V8 runners manually.
- Do not write runtime browser profiles, logs, or output folders into git.
- Do not use `src/agent_tools/*` for new automation unless maintaining legacy
  behavior.
