import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
const queueName = 'enrichment';
const queuePrefix = `itest_${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-scheduler-smoke-'));
const sqlitePath = path.join(tempDir, 'scheduler-smoke.sqlite');
let redisAvailable = true;
let originalRedisPolicy: string | null = null;

describe('Scheduler smoke', () => {
  beforeAll(async () => {
    process.env.QUEUE_PREFIX = queuePrefix;
    process.env.SQLITE_PATH = sqlitePath;
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
      throw new Error(`Redis is required for scheduler smoke tests but is unreachable at ${redisUrl}`);
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads CSV, deduplicates deterministic ids, enqueues jobs and exits cleanly', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/scheduler-input.csv');
    const { runScheduler } = await import('../../src/enricher/scheduler');

    const summary = await runScheduler(fixturePath);

    expect(summary.loaded).toBe(3);
    expect(summary.skipped).toBe(1);
    expect(summary.enqueued).toBe(2);
    expect(summary.durationMs).toBeGreaterThan(0);

    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    await redis.connect();
    const queue = new Queue(queueName, { connection: redis, prefix: queuePrefix });

    try {
      const counts = await queue.getJobCounts();
      expect(counts.waiting).toBe(2);
      expect(counts.active).toBe(0);
    } finally {
      await queue.close();
      await redis.quit();
    }
  });
});
