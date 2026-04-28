# PG3 Enrichment Pipeline

## Agent-First Entrypoint (official path)

A single contract drives every campaign and enrichment run. Agents and humans
both call `runScraper()` — there is no need to choose between runner, scheduler,
mission, benchmark or manual scripts.

```ts
import { runScraper } from './src/agent/agent_scraper';

const result = await runScraper({
  runId: 'crm-2026-04-28',
  mode: 'full',                // 'campaign' | 'enrichment' | 'full'
  sector: 'agenzie immobiliari',
  zone: 'Veneto',
  provinces: ['VR', 'VE', 'PD'],
  limit: 500,
});
// → { runId, status, stats, artifacts: { outputCsv, reportJson, logFile } }
```

Equivalent CLI commands:

```bash
npm run agent:campaign -- --sector "agenzie immobiliari" --provinces "VR,VE"
npm run agent:enrich   -- --source-csv output/runs/<id>/output.csv
npm run agent:full     -- --sector "dentisti"            --zone "Lombardia"
npm run agent:inspect  -- --run-id <id>
```

MCP tools exposing the same path: `agent_scrape_target`, `agent_run_campaign`,
`agent_enrich_campaign`, `agent_inspect_run`. Legacy `pg3_*` MCP tools are kept
for back-compat and marked `[DEPRECATED]`.

Run artifacts live under `output/runs/{runId}/` (override with
`AGENT_RUNS_ROOT`):

- `output/runs/{runId}/input.csv` — the source CSV (enrichment / full)
- `output/runs/{runId}/output.csv` — discovered / combined CSV (campaign / full)
- `output/runs/{runId}/report.json` — final `AgentScraperResult`
- `output/runs/{runId}/run.log` — log stream
- `output/runs/_registry.jsonl` — append-only registry of every run

Migration status of legacy modules is tracked in
[`docs/refactor/LEGACY_EXTRACTION_MAP.md`](docs/refactor/LEGACY_EXTRACTION_MAP.md).

## Overview

PG3 is the active production runtime for campaign scraping support plus enrichment/discovery.

The queue layer is `BullMQ` backed by `Redis`; there is no RabbitMQ runtime in this repo.

The actual runtime surface in use is:

- `src/index.ts`
- `src/enricher/**`
- `src/foundation/**`
- `src/server.ts`
- `src/scraper/**` when server mode launches campaign collection

`pg1` is the legacy resolver pipeline and is no longer the canonical runtime surface.

## Prerequisites

- Node.js 20+
- Redis (local or remote, as the `BullMQ` backend)
- `OPENAI_API_KEY` configured

## Setup

1. Install dependencies:
   - `npm ci`
2. Create environment file:
   - `cp .env.example .env`
3. Start Redis (local example):
   - `docker compose up -d redis`

## Runtime Commands

- Development worker:
  - `npm run dev:worker`
- Development scheduler:
  - `npm run dev:scheduler -- output/campaigns/BOARD_FINAL_SANITISED.csv`
- Production worker (built):
  - `npm run start:worker`
- Production scheduler (built):
  - `npm run start:scheduler -- output/campaigns/BOARD_FINAL_SANITISED.csv`

`src/index.ts` accepts only explicit commands:

- `worker`
- `scheduler <csv-path>`
- `server`

## Quality Gates

- Typecheck:
  - `npm run typecheck`
- Unit tests:
  - `npm run test:unit`
- BullMQ/Redis smoke integration:
  - `npm run test:smoke`
- Full test gate:
  - `npm test`
- Build:
  - `npm run build`

## Test Strategy

Automated tests are split into:

- `tests/unit`: deterministic pure-module checks
- `tests/integration`: BullMQ/Redis scheduler smoke checks without browser/network crawling

Manual audits and operational scripts live under `scripts/` and are not part of CI quality gates.

## Fixtures

Minimal versioned fixtures are kept in:

- `examples/fixtures`
- `tests/fixtures`

Runtime debug artifacts (`output`, temporary PNG/CSV/log dumps, browser profiles) are intentionally excluded from git.
