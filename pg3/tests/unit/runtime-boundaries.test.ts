import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');
const REPO_ROOT = path.resolve(__dirname, '../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('runtime boundaries', () => {
  it('keeps the active queue stack on BullMQ and Redis only', () => {
    const activeRuntimeFiles = [
      'index.ts',
      'server.ts',
      'enricher/worker.ts',
      'enricher/scheduler.ts',
      'enricher/queue/index.ts',
      'enricher/runtime/runtime_factory.ts',
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
    const runtimeFactoryTs = readSource('enricher/runtime/runtime_factory.ts');
    const legacyRuntimeShimTs = readSource('foundation/runtime_factory.ts');

    expect(indexTs).toContain("worker");
    expect(indexTs).toContain("scheduler");
    expect(indexTs).toContain("server");
    expect(serverTs).toContain("resolveRunnerLaunch");
    expect(serverTs).toContain("runner.ts");
    expect(workerTs).toContain('./runtime/runtime_factory');
    expect(runnerV6Ts).toContain('../enricher/runtime/runtime_factory');
    expect(workerTs).toContain('createOmegaRuntime');
    expect(runnerV6Ts).toContain('createOmegaRuntime');
    expect(runtimeFactoryTs).toContain('export async function createOmegaRuntime');
    expect(runtimeFactoryTs).toContain("from './provider_catalog'");
    expect(runtimeFactoryTs).not.toContain("shared-runtime/routing/provider_catalog");
    expect(legacyRuntimeShimTs).toContain("../enricher/runtime/runtime_factory");
    expect(schedulerTs).not.toContain('runtime_factory');
  });

  it('keeps Redis bootstrap scripts on noeviction', () => {
    const files = [
      'docker-compose.yml',
      'scripts/run_e2e_enrichment.zsh',
      'ops/mission_lombardia_manifattura_e2e.sh',
    ];

    const combined = files.map(readRepoFile).join('\n');

    expect(combined).toContain('maxmemory-policy noeviction');
    expect(combined).not.toContain('allkeys-lru');
  });

  it('keeps scraper-facing modules behind shared-runtime wrappers', () => {
    const categoryMatcherTs = readSource('scraper/ai/category_matcher.ts');
    const municipalitySplitterTs = readSource('scraper/ai/municipality_splitter.ts');
    const generateCampaignTs = readSource('scraper/generate_campaign_v2.ts');
    const proxyManagerTs = readSource('scraper/core/browser/proxy_manager_v9.ts');

    expect(categoryMatcherTs).toContain('shared-runtime/ai/LLMService');
    expect(categoryMatcherTs).not.toContain('enricher/core/ai/llm_service');
    expect(municipalitySplitterTs).toContain('shared-runtime/ai/LLMService');
    expect(municipalitySplitterTs).not.toContain('enricher/core/ai/llm_service');
    expect(generateCampaignTs).toContain('shared-runtime/security/CaptchaSolver');
    expect(generateCampaignTs).not.toContain('enricher/core/security/captcha_solver');
    expect(proxyManagerTs).toContain('shared-runtime/network/proxy_tier_v9');
    expect(proxyManagerTs).not.toContain('foundation/network/proxy_tier_v9');
  });

  it('keeps shared AI and config ownership out of enricher internals', () => {
    const llmServiceTs = readSource('shared-runtime/ai/LLMService.ts');
    const runtimeConfigTs = readSource('shared-runtime/config/runtime_config.ts');
    const stopTheBleedingTs = readSource('foundation/StopTheBleedingController.ts');

    expect(llmServiceTs).toContain("from '../config/runtime_config'");
    expect(llmServiceTs).toContain("from '../logging/Logger'");
    expect(llmServiceTs).not.toContain('enricher/config');
    expect(runtimeConfigTs).not.toContain('enricher/config');
    expect(stopTheBleedingTs).toContain("from '../shared-runtime/config/runtime_config'");
    expect(stopTheBleedingTs).not.toContain('enricher/config');
  });
});
