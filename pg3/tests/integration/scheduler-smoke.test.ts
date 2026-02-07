import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { runScheduler } from '../../src/enricher/scheduler';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
const queueName = 'enrichment';
let redisAvailable = true;

async function flushRedisDb(): Promise<boolean> {
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 1000,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    await client.flushdb();
    return true;
  } catch {
    return false;
  } finally {
    await client.quit().catch(() => undefined);
  }
}

describe('Scheduler smoke', () => {
  beforeAll(async () => {
    redisAvailable = await flushRedisDb();
  });

  afterAll(async () => {
    if (redisAvailable) {
      await flushRedisDb();
    }
  });

  it('loads CSV, deduplicates deterministic ids, enqueues jobs and exits cleanly', async () => {
    if (!redisAvailable) {
      return;
    }

    const fixturePath = path.resolve(__dirname, '../fixtures/scheduler-input.csv');

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
    await redis.connect();
    const queue = new Queue(queueName, { connection: redis });

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
