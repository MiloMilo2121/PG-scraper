import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('runtime boundaries', () => {
  it('keeps the active queue stack on BullMQ and Redis only', () => {
    const activeRuntimeFiles = [
      'index.ts',
      'server.ts',
      'enricher/worker.ts',
      'enricher/scheduler.ts',
      'enricher/queue/index.ts',
      'foundation/runtime_factory.ts',
    ];

    const combined = activeRuntimeFiles.map(readSource).join('\n');

    expect(combined.toLowerCase()).not.toMatch(/rabbitmq|amqp/);
    expect(combined).toContain('bullmq');
    expect(combined).toContain('ioredis');
  });

  it('routes the worker through the shared runtime composition root and keeps the scheduler separate', () => {
    const indexTs = readSource('index.ts');
    const serverTs = readSource('server.ts');
    const workerTs = readSource('enricher/worker.ts');
    const schedulerTs = readSource('enricher/scheduler.ts');
    const runnerV6Ts = readSource('foundation/RunnerV6.ts');

    expect(indexTs).toContain("worker");
    expect(indexTs).toContain("scheduler");
    expect(indexTs).toContain("server");
    expect(serverTs).toContain("resolveRunnerLaunch");
    expect(serverTs).toContain("runner.ts");
    expect(workerTs).toContain('createOmegaRuntime');
    expect(runnerV6Ts).toContain('createOmegaRuntime');
    expect(schedulerTs).not.toContain('runtime_factory');
  });
});
