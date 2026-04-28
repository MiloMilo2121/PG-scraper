import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScraper } from '../../src/agent/agent_scraper';

describe('runScraper dispatch', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-dispatch-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("routes mode='campaign' to the campaign runner and maps stats", async () => {
    const campaignRunner = vi.fn(async () => ({
      count: 12,
      combinedCsv: path.join(tmpRoot, 'campaign.csv'),
      perProvinceCsvs: [],
      byProvince: { VR: 12 },
      droppedInvalid: 1,
      droppedLowSignal: 0,
    }));
    fs.writeFileSync(path.join(tmpRoot, 'campaign.csv'), 'name\nfoo\n', 'utf-8');

    const result = await runScraper(
      {
        runId: 'run-campaign',
        mode: 'campaign',
        sector: 'agenzie immobiliari',
        provinces: ['VR'],
      },
      { rootDir: tmpRoot, campaignRunner }
    );

    expect(campaignRunner).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(result.stats.discovered).toBe(12);
    expect(result.stats.failed).toBe(1);
    expect(result.artifacts.outputCsv).toContain('campaign.csv');
    expect(fs.existsSync(result.artifacts.logFile!)).toBe(true);
    expect(fs.existsSync(result.artifacts.costLedger!)).toBe(true);
    expect(result.costSummary?.budgetStatus).toBe('not_configured');
  });

  it("routes mode='enrichment' to the enrichment runner and reports queued", async () => {
    const sourceCsv = path.join(tmpRoot, 'input.csv');
    fs.writeFileSync(sourceCsv, 'company_name\nAcme\n', 'utf-8');

    const enrichmentRunner = vi.fn(async () => ({
      loaded: 10,
      enqueued: 8,
      skipped: 2,
      durationMs: 5,
    }));

    const result = await runScraper(
      {
        runId: 'run-enrich',
        mode: 'enrichment',
        sourceCsv,
        context: {
          workspaceId: 'workspace-a',
          agentId: 'codex-a',
          sessionId: 'session-a',
          actorType: 'agent',
          traceId: 'trace-a',
        },
        budget: {
          maxExternalCalls: 0,
          maxCostPerRun: 0,
        },
      },
      { rootDir: tmpRoot, enrichmentRunner }
    );

    expect(enrichmentRunner).toHaveBeenCalledTimes(1);
    expect(enrichmentRunner).toHaveBeenCalledWith(
      result.artifacts.inputCsv,
      { runId: 'run-enrich' }
    );
    expect(result.status).toBe('queued');
    expect(result.stats).toEqual({ loaded: 10, discovered: 0, enriched: 8, failed: 2 });
    expect(result.artifacts.inputCsv).toBeTruthy();
    expect(result.input.context?.traceId).toBe('trace-a');
    expect(result.costSummary).toMatchObject({
      totalCostEur: 0,
      externalCalls: 0,
      budgetStatus: 'within_budget',
    });
  });

  it("routes mode='full' through campaign then enrichment", async () => {
    const combinedCsv = path.join(tmpRoot, 'combined.csv');
    fs.writeFileSync(combinedCsv, 'company_name\nFoo\n', 'utf-8');

    const campaignRunner = vi.fn(async () => ({
      count: 3,
      combinedCsv,
      perProvinceCsvs: [combinedCsv],
      byProvince: { VR: 3 },
      droppedInvalid: 0,
      droppedLowSignal: 0,
    }));
    const enrichmentRunner = vi.fn(async () => ({
      loaded: 3,
      enqueued: 3,
      skipped: 0,
      durationMs: 7,
    }));

    const result = await runScraper(
      {
        runId: 'run-full',
        mode: 'full',
        sector: 'dentisti',
        provinces: ['VR'],
      },
      { rootDir: tmpRoot, campaignRunner, enrichmentRunner }
    );

    expect(campaignRunner).toHaveBeenCalledTimes(1);
    expect(enrichmentRunner).toHaveBeenCalledTimes(1);
    expect(enrichmentRunner).toHaveBeenCalledWith(
      result.artifacts.inputCsv,
      { runId: 'run-full' }
    );
    expect(result.status).toBe('queued');
    expect(result.stats.discovered).toBe(3);
    expect(result.stats.enriched).toBe(3);
  });

  it("expands region zone values before calling the campaign runner", async () => {
    const combinedCsv = path.join(tmpRoot, 'veneto.csv');
    fs.writeFileSync(combinedCsv, 'company_name\nFoo\n', 'utf-8');

    const campaignRunner = vi.fn(async () => ({
      count: 1,
      combinedCsv,
      perProvinceCsvs: [combinedCsv],
      byProvince: { VR: 1 },
      droppedInvalid: 0,
      droppedLowSignal: 0,
    }));

    await runScraper(
      {
        runId: 'run-veneto',
        mode: 'campaign',
        sector: 'agenzie immobiliari',
        zone: 'Veneto',
      },
      { rootDir: tmpRoot, campaignRunner }
    );

    expect(campaignRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        provinceCodes: ['BL', 'PD', 'RO', 'TV', 'VE', 'VR', 'VI'],
      })
    );
  });
});
