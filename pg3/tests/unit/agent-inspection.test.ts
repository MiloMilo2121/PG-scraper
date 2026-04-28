import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectAgentRun } from '../../src/agent/agent_inspection';
import { AgentRunRegistry } from '../../src/agent/agent_run_registry';
import { ensureRunDir, writeReportJson } from '../../src/agent/agent_artifacts';
import {
  AGENT_CONTRACT_VERSION,
  AgentScraperResult,
} from '../../src/agent/agent_contracts';
import { emptyCostSummary } from '../../src/agent/agent_costs';

describe('inspectAgentRun', () => {
  let tmpRoot: string;
  let originalCostLedgerPath: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-inspect-'));
    originalCostLedgerPath = process.env.COST_LEDGER_PATH;
  });

  afterEach(() => {
    if (originalCostLedgerPath === undefined) {
      delete process.env.COST_LEDGER_PATH;
    } else {
      process.env.COST_LEDGER_PATH = originalCostLedgerPath;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refreshes report costSummary from the runtime cost ledger by runId', () => {
    const runId = 'inspect-costs';
    const paths = ensureRunDir(runId, { rootDir: tmpRoot });
    const globalLedger = path.join(tmpRoot, 'runtime-costs.jsonl');
    process.env.COST_LEDGER_PATH = globalLedger;

    const result: AgentScraperResult = {
      runId,
      status: 'queued',
      input: {
        contractVersion: AGENT_CONTRACT_VERSION,
        runId,
        mode: 'enrichment',
        sourceCsv: '/tmp/input.csv',
        budget: {
          maxCostPerRun: 1,
        },
      },
      stats: {
        loaded: 2,
        discovered: 0,
        enriched: 2,
        failed: 0,
      },
      artifacts: {
        reportJson: paths.reportJson,
        logFile: paths.logFile,
        costLedger: paths.costLedger,
      },
      costSummary: emptyCostSummary({ maxCostPerRun: 1 }),
      startedAt: '2026-04-28T00:00:00.000Z',
      finishedAt: '2026-04-28T00:00:01.000Z',
      durationMs: 1000,
    };

    fs.writeFileSync(
      paths.costLedger,
      JSON.stringify({
        timestamp: result.startedAt,
        run_id: runId,
        module: 'agent_governance',
        provider: 'agent-runtime',
        tier: 0,
        task_type: 'agent.run.started',
        cost_eur: 0,
        cache_hit: false,
        cache_level: 'MISS',
        duration_ms: 0,
        success: true,
      }) + '\n',
      'utf-8'
    );
    fs.writeFileSync(
      globalLedger,
      [
        {
          timestamp: result.finishedAt,
          run_id: runId,
          correlation_id: `${runId}:company-1`,
          company_id: 'company-1',
          module: 'CostRouter',
          provider: 'TEST-SERP-1',
          tier: 1,
          task_type: 'SERP',
          cost_eur: 0.002,
          cache_hit: false,
          cache_level: 'MISS',
          duration_ms: 50,
          success: true,
        },
        {
          timestamp: result.finishedAt,
          run_id: 'other-run',
          company_id: 'company-x',
          module: 'CostRouter',
          provider: 'TEST-SERP-1',
          tier: 1,
          task_type: 'SERP',
          cost_eur: 99,
          cache_hit: false,
          cache_level: 'MISS',
          duration_ms: 50,
          success: true,
        },
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf-8'
    );

    writeReportJson(paths, result);
    const registry = new AgentRunRegistry({ rootDir: tmpRoot });
    registry.register(result.input, result.startedAt);
    registry.update(runId, { status: 'queued', finishedAt: result.finishedAt, result });

    const inspected = inspectAgentRun(runId, { rootDir: tmpRoot });
    expect('report' in inspected && inspected.report).toMatchObject({
      costSummary: {
        totalCostEur: 0.002,
        costPerCompanyEur: 0.001,
        externalCalls: 1,
        budgetStatus: 'within_budget',
      },
    });
  });
});
