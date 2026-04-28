import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
const queuePrefix = `itest_agent_${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-smoke-'));
const sqlitePath = path.join(tempDir, 'agent-smoke.sqlite');
const runsRoot = path.join(tempDir, 'runs');
let redisAvailable = true;
let originalRedisPolicy: string | null = null;

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
    const fixturePath = path.resolve(__dirname, '../fixtures/scheduler-input.csv');
    const { runScraper } = await import('../../src/agent/agent_scraper');

    const runId = `agent-smoke-${Date.now()}`;
    const result = await runScraper(
      {
        runId,
        mode: 'enrichment',
        sourceCsv: fixturePath,
      },
      { rootDir: runsRoot }
    );

    expect(result.status).toBe('queued');
    expect(result.stats.loaded).toBe(3);
    expect(result.stats.enriched).toBe(2);
    expect(result.stats.failed).toBe(1);

    expect(result.artifacts.inputCsv).toBeTruthy();
    expect(result.artifacts.reportJson).toBeTruthy();

    expect(fs.existsSync(result.artifacts.inputCsv!)).toBe(true);
    expect(fs.existsSync(result.artifacts.reportJson!)).toBe(true);

    const reportContent = JSON.parse(fs.readFileSync(result.artifacts.reportJson!, 'utf-8'));
    expect(reportContent.runId).toBe(runId);
    expect(reportContent.status).toBe('queued');

    const { AgentRunRegistry } = await import('../../src/agent/agent_run_registry');
    const registry = new AgentRunRegistry({ rootDir: runsRoot });
    const entry = registry.get(runId);
    expect(entry?.status).toBe('queued');
    expect(entry?.result?.stats.enriched).toBe(2);
  });
});
