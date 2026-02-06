# PG3 Enrichment Pipeline

## Overview

PG3 is the production enrichment runtime for discovery + financial enrichment.

The supported runtime surface is:

- `src/index.ts`
- `src/enricher/**`

Legacy modules and ad-hoc tests were removed from the active build/test path.

## Prerequisites

- Node.js 20+
- Redis (local or remote)
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

## Quality Gates

- Typecheck:
  - `npm run typecheck`
- Unit tests:
  - `npm run test:unit`
- Redis smoke integration:
  - `npm run test:smoke`
- Full test gate:
  - `npm test`
- Build:
  - `npm run build`

## Test Strategy

Automated tests are split into:

- `tests/unit`: deterministic pure-module checks
- `tests/integration`: Redis/scheduler smoke checks without browser/network crawling

Manual audits and operational scripts live under `scripts/` and are not part of CI quality gates.

## Fixtures

Minimal versioned fixtures are kept in:

- `examples/fixtures`
- `tests/fixtures`

Runtime debug artifacts (`output`, temporary PNG/CSV/log dumps, browser profiles) are intentionally excluded from git.
