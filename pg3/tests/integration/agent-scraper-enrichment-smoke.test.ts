import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';

const execFileAsync = promisify(execFile);
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
const queuePrefix = `itest_agent_${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-smoke-'));
const sqlitePath = path.join(tempDir, 'agent-smoke.sqlite');
const runsRoot = path.join(tempDir, 'runs');
const projectRoot = path.resolve(__dirname, '../..');
let redisAvailable = true;
let originalRedisPolicy: string | null = null;

function parseCliJson(stdout: string): any {
  const clean = stdout.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  const lastObject = clean.lastIndexOf('\n{');
  const start = lastObject >= 0 ? lastObject + 1 : clean.indexOf('{');
  if (start < 0) {
    throw new Error(`CLI did not emit JSON: ${stdout}`);
  }
  return JSON.parse(clean.slice(start));
}

describe('runScraper enrichment smoke', () => {
  beforeAll(async () => {
    process.env.QUEUE_PREFIX = queuePrefix;
    process.env.SQLITE_PATH = sqlitePath;
    process.env.AGENT_RUNS_ROOT = runsRoot;

    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);

    try {
      await client.connect();
      redisAvailable = true;
      const configGet = await client.config('GET', 'maxmemory-policy');
      originalRedisPolicy = Array.isArray(configGet) ? String(configGet[1] || '') : null;
      if (originalRedisPolicy && originalRedisPolicy !== 'noeviction') {
        await client.config('SET', 'maxmemory-policy', 'noeviction');
      }
    } catch {
      redisAvailable = false;
    } finally {
      await client.quit().catch(() => undefined);
    }

    if (!redisAvailable) {
      throw new Error(`Redis is required for the agent smoke test but is unreachable at ${redisUrl}`);
    }
  });

  afterAll(async () => {
    if (redisAvailable && originalRedisPolicy && originalRedisPolicy !== 'noeviction') {
      const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 1000,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      try {
        await client.connect();
        await client.config('SET', 'maxmemory-policy', originalRedisPolicy);
      } finally {
        await client.quit().catch(() => undefined);
      }
    }

    delete process.env.QUEUE_PREFIX;
    delete process.env.SQLITE_PATH;
    delete process.env.AGENT_RUNS_ROOT;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs an enrichment via runScraper and produces tracked artifacts', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/agent-enrichment-input.csv');
    const { runScraper } = await import('../../src/agent/agent_scraper');

    const runId = `agent-smoke-${Date.now()}`;
    const result = await runScraper(
      {
        runId,
        mode: 'enrichment',
        sourceCsv: fixturePath,
        context: {
          workspaceId: 'smoke-workspace',
          agentId: 'vitest-agent',
          sessionId: 'smoke-session',
          actorType: 'ci',
          traceId: `trace-${runId}`,
        },
        budget: {
          maxCostPerRun: 0,
          maxExternalCalls: 0,
        },
      },
      { rootDir: runsRoot }
    );

    expect(result.status).toBe('queued');
    expect(result.stats.loaded).toBe(3);
    expect(result.stats.enriched).toBe(2);
    expect(result.stats.failed).toBe(1);

    expect(result.artifacts.inputCsv).toBeTruthy();
    expect(result.artifacts.reportJson).toBeTruthy();
    expect(result.artifacts.logFile).toBeTruthy();
    expect(result.artifacts.costLedger).toBeTruthy();

    expect(fs.existsSync(result.artifacts.inputCsv!)).toBe(true);
    expect(fs.existsSync(result.artifacts.reportJson!)).toBe(true);
    expect(fs.existsSync(result.artifacts.logFile!)).toBe(true);
    expect(fs.existsSync(result.artifacts.costLedger!)).toBe(true);

    const reportContent = JSON.parse(fs.readFileSync(result.artifacts.reportJson!, 'utf-8'));
    expect(reportContent.runId).toBe(runId);
    expect(reportContent.status).toBe('queued');
    expect(reportContent.input.context.traceId).toBe(`trace-${runId}`);
    expect(reportContent.costSummary).toMatchObject({
      totalCostEur: 0,
      externalCalls: 0,
      budgetStatus: 'within_budget',
    });

    const runLog = fs
      .readFileSync(result.artifacts.logFile!, 'utf-8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(runLog.map((entry) => entry.event)).toEqual([
      'agent.run.started',
      'agent.run.finished',
    ]);
    expect(runLog[0].payload.context.agentId).toBe('vitest-agent');

    const costLedger = fs
      .readFileSync(result.artifacts.costLedger!, 'utf-8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(costLedger.map((entry) => entry.task_type)).toEqual([
      'agent.run.started',
      'agent.run.finished',
    ]);

    const { AgentRunRegistry } = await import('../../src/agent/agent_run_registry');
    const registry = new AgentRunRegistry({ rootDir: runsRoot });
    const entry = registry.get(runId);
    expect(entry?.status).toBe('queued');
    expect(entry?.result?.stats.enriched).toBe(2);
  });

  it('runs the canonical CLI and inspects the generated run', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/agent-enrichment-input.csv');
    const runId = `agent-cli-smoke-${Date.now()}`;
    const env = {
      ...process.env,
      AGENT_RUNS_ROOT: runsRoot,
      OPENAI_API_KEY: 'test-key',
      QUEUE_PREFIX: `${queuePrefix}_cli`,
      REDIS_URL: redisUrl,
      SQLITE_PATH: sqlitePath,
    };

    const { stdout } = await execFileAsync(
      'npm',
      [
        'run',
        '--silent',
        'agent',
        '--',
        '--mode',
        'enrichment',
        '--source-csv',
        fixturePath,
        '--run-id',
        runId,
        '--workspace-id',
        'cli-workspace',
        '--agent-id',
        'cli-agent',
        '--session-id',
        'cli-session',
        '--actor-type',
        'agent',
        '--trace-id',
        `trace-${runId}`,
        '--max-cost-per-run',
        '0',
        '--max-external-calls',
        '0',
      ],
      { cwd: projectRoot, env }
    );
    const result = parseCliJson(stdout);

    expect(result.status).toBe('queued');
    expect(result.stats).toMatchObject({
      loaded: 3,
      enriched: 2,
      failed: 1,
    });
    expect(fs.existsSync(result.artifacts.inputCsv)).toBe(true);
    expect(fs.existsSync(result.artifacts.reportJson)).toBe(true);
    expect(fs.existsSync(result.artifacts.logFile)).toBe(true);
    expect(fs.existsSync(result.artifacts.costLedger)).toBe(true);
    expect(result.input.context).toMatchObject({
      workspaceId: 'cli-workspace',
      agentId: 'cli-agent',
      sessionId: 'cli-session',
      actorType: 'agent',
      traceId: `trace-${runId}`,
    });
    expect(result.costSummary).toMatchObject({
      totalCostEur: 0,
      externalCalls: 0,
      budgetStatus: 'within_budget',
    });

    const inspect = await execFileAsync(
      'npm',
      [
        'run',
        '--silent',
        'agent:inspect',
        '--',
        '--run-id',
        runId,
        '--root-dir',
        runsRoot,
      ],
      { cwd: projectRoot, env }
    );
    const inspected = parseCliJson(inspect.stdout);

    expect(inspected.entry.runId).toBe(runId);
    expect(inspected.entry.status).toBe('queued');
    expect(inspected.report.runId).toBe(runId);
    expect(inspected.report.stats.enriched).toBe(2);
    expect(inspected.report.costSummary.budgetStatus).toBe('within_budget');
  });
});
