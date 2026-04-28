import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRunRegistry } from '../../src/agent/agent_run_registry';
import {
  AGENT_CONTRACT_VERSION,
  AgentScraperRequest,
} from '../../src/agent/agent_contracts';

describe('AgentRunRegistry', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-registry-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function sampleRequest(runId: string): AgentScraperRequest {
    return {
      contractVersion: AGENT_CONTRACT_VERSION,
      runId,
      mode: 'enrichment',
      sourceCsv: '/tmp/x.csv',
    };
  }

  it('register + get round-trip', () => {
    const reg = new AgentRunRegistry({ rootDir: tmpRoot });
    reg.register(sampleRequest('run-a'), '2026-01-01T00:00:00.000Z');
    const entry = reg.get('run-a');
    expect(entry?.status).toBe('running');
    expect(entry?.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('update produces the latest entry while preserving append-only history', () => {
    const reg = new AgentRunRegistry({ rootDir: tmpRoot });
    reg.register(sampleRequest('run-b'), '2026-01-01T00:00:00.000Z');
    reg.update('run-b', { status: 'completed', finishedAt: '2026-01-01T00:01:00.000Z' });

    const entry = reg.get('run-b');
    expect(entry?.status).toBe('completed');
    expect(entry?.finishedAt).toBe('2026-01-01T00:01:00.000Z');

    const lines = fs
      .readFileSync(path.join(tmpRoot, '_registry.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(lines.length).toBe(2);
  });

  it('list returns entries newest-first and respects status filter', () => {
    const reg = new AgentRunRegistry({ rootDir: tmpRoot });
    reg.register(sampleRequest('run-c'), '2026-01-01T00:00:00.000Z');
    reg.register(sampleRequest('run-d'), '2026-01-02T00:00:00.000Z');
    reg.update('run-c', { status: 'completed' });

    const all = reg.list();
    expect(all[0].runId).toBe('run-d');

    const completed = reg.list({ status: 'completed' });
    expect(completed.map((e) => e.runId)).toEqual(['run-c']);
  });

  it('rebuilds index from disk after a fresh instance is created', () => {
    const reg1 = new AgentRunRegistry({ rootDir: tmpRoot });
    reg1.register(sampleRequest('run-e'), '2026-01-01T00:00:00.000Z');

    const reg2 = new AgentRunRegistry({ rootDir: tmpRoot });
    expect(reg2.get('run-e')?.runId).toBe('run-e');
  });

  it('tolerates malformed lines in the registry file', () => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, '_registry.jsonl'),
      'not-json\n{"runId":"ok","status":"running","mode":"campaign","startedAt":"x","request":{"runId":"ok","mode":"campaign"}}\n',
      'utf-8'
    );
    const reg = new AgentRunRegistry({ rootDir: tmpRoot });
    expect(reg.get('ok')?.runId).toBe('ok');
  });
});
