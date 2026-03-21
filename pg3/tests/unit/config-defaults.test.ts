import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const RESET_KEYS = [
  'OPENAI_API_KEY',
  'Z_AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'KIMI_API_KEY',
  'LLM_MODEL',
  'LLM_MODEL_FAST',
  'LLM_MODEL_SMART',
  'AI_MODEL_FAST',
  'AI_MODEL_SMART',
  'RUNTIME_DATA_DIR',
  'COST_LEDGER_PATH',
  'BROWSER_SESSION_DIR',
  'MAX_COST_PER_COMPANY_EUR',
  'LOCAL_BROWSER_NAV_COST_EUR',
  'LOCAL_ORACLE_FETCH_COST_EUR',
];
const NUMERIC_RESET_KEYS = new Set([
  'MAX_COST_PER_COMPANY_EUR',
  'LOCAL_BROWSER_NAV_COST_EUR',
  'LOCAL_ORACLE_FETCH_COST_EUR',
]);

async function loadConfig(overrides: Record<string, string>) {
  vi.resetModules();

  const nextEnv = { ...ORIGINAL_ENV };
  for (const key of RESET_KEYS) {
    if (NUMERIC_RESET_KEYS.has(key)) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = '';
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    nextEnv[key] = value;
  }

  process.env = nextEnv;

  return (await import('../../src/enricher/config')).config;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('config defaults', () => {
  it('falls back to the current OpenAI model defaults when only OPENAI_API_KEY is configured', async () => {
    const config = await loadConfig({
      OPENAI_API_KEY: 'test-openai-key',
    });

    expect(config.llm.fastModel).toBe('gpt-5-mini');
    expect(config.llm.smartModel).toBe('gpt-4o');
    expect(config.llm.model).toBe('gpt-4o');
  });

  it('resolves runtime state paths under the configured data directory', async () => {
    const config = await loadConfig({
      OPENAI_API_KEY: 'test-openai-key',
      RUNTIME_DATA_DIR: './tmp/runtime-state',
    });

    expect(config.runtime.dataDir).toBe(path.resolve('./tmp/runtime-state'));
    expect(config.runtime.costLedgerPath).toBe(path.resolve('./tmp/runtime-state/cost_ledger.jsonl'));
    expect(config.runtime.browserSessionDir).toBe(path.resolve('./tmp/runtime-state/browser-sessions'));
  });

  it('exposes coherent budget and local cost defaults', async () => {
    const config = await loadConfig({
      OPENAI_API_KEY: 'test-openai-key',
    });

    expect(config.budget.maxCostPerCompanyEur).toBe(0.01);
    expect(config.costing.localBrowserNavCostEur).toBe(0);
    expect(config.costing.localOracleFetchCostEur).toBe(0);
  });
});
