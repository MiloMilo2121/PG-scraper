import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAgentDoctor } from '../../src/agent/agent_doctor';

const projectRoot = path.resolve(__dirname, '../..');

const originalEnv = {
  AGENT_RUNS_ROOT: process.env.AGENT_RUNS_ROOT,
  COST_LEDGER_PATH: process.env.COST_LEDGER_PATH,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PG3_ENABLE_LEGACY_MCP_TOOLS: process.env.PG3_ENABLE_LEGACY_MCP_TOOLS,
  REDIS_URL: process.env.REDIS_URL,
  RUNTIME_DATA_DIR: process.env.RUNTIME_DATA_DIR,
};

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe('runAgentDoctor', () => {
  it('verifies the canonical agent-first surface without leaving temp files behind', async () => {
    const runsRoot = makeTempDir('pg3-doctor-runs-');
    const runtimeRoot = makeTempDir('pg3-doctor-runtime-');
    process.env.RUNTIME_DATA_DIR = runtimeRoot;
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      const result = await runAgentDoctor({ projectRoot, rootDir: runsRoot });

      expect(result.status).toMatch(/^(ok|warning)$/);
      expect(result.projectRoot).toBe(projectRoot);
      expect(result.runsRoot).toBe(runsRoot);
      expect(result.checks.find((check) => check.name === 'package:scripts')).toMatchObject({
        status: 'ok',
      });
      expect(result.checks.find((check) => check.name === 'artifacts:runs_root')).toMatchObject({
        status: 'ok',
      });
      expect(fs.readdirSync(runsRoot).filter((entry) => entry.startsWith('.doctor-'))).toEqual([]);
    } finally {
      fs.rmSync(runsRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('warns when deprecated legacy MCP actuator tools are enabled', async () => {
    const runsRoot = makeTempDir('pg3-doctor-legacy-runs-');
    const runtimeRoot = makeTempDir('pg3-doctor-legacy-runtime-');
    process.env.RUNTIME_DATA_DIR = runtimeRoot;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.PG3_ENABLE_LEGACY_MCP_TOOLS = 'true';

    try {
      const result = await runAgentDoctor({ projectRoot, rootDir: runsRoot });

      expect(result.status).toBe('warning');
      expect(result.checks.find((check) => check.name === 'mcp:legacy_tools')).toMatchObject({
        status: 'warning',
      });
    } finally {
      fs.rmSync(runsRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('fails the optional Redis check with a structured diagnostic', async () => {
    const runsRoot = makeTempDir('pg3-doctor-redis-runs-');
    const runtimeRoot = makeTempDir('pg3-doctor-redis-runtime-');
    process.env.RUNTIME_DATA_DIR = runtimeRoot;
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      const result = await runAgentDoctor({
        projectRoot,
        rootDir: runsRoot,
        checkRedis: true,
        redisUrl: 'redis://127.0.0.1:1/0',
      });

      expect(result.status).toBe('failed');
      expect(result.checks.find((check) => check.name === 'redis')).toMatchObject({
        status: 'failed',
      });
    } finally {
      fs.rmSync(runsRoot, { recursive: true, force: true });
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
