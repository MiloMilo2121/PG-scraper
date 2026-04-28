import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScraper } from '../../src/agent/agent_scraper';

describe('runScraper error handling', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg3-agent-errors-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns a failed result when the request fails Zod validation', async () => {
    const result = await runScraper(
      { runId: 'run-bad', mode: 'campaign' },
      { rootDir: tmpRoot }
    );
    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('ZodError');
    expect(result.costSummary?.budgetStatus).toBe('not_configured');
  });

  it('preserves the user-supplied mode in the failed result for diagnostics', async () => {
    const result = await runScraper(
      { runId: 'run-bad-enrich', mode: 'enrichment' },
      { rootDir: tmpRoot }
    );
    expect(result.status).toBe('failed');
    expect(result.input.mode).toBe('enrichment');
    expect(result.input.runId).toBe('run-bad-enrich');
  });

  it('returns a failed result when the runId is unsafe', async () => {
    const result = await runScraper(
      {
        runId: 'a/b',
        mode: 'enrichment',
        sourceCsv: '/tmp/x.csv',
      },
      { rootDir: tmpRoot }
    );
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/runId/);
  });

  it('captures synchronous throws from the campaign backend', async () => {
    const campaignRunner = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await runScraper(
      {
        runId: 'run-throw',
        mode: 'campaign',
        sector: 'dentisti',
        provinces: ['VR'],
      },
      { rootDir: tmpRoot, campaignRunner }
    );
    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('boom');
    expect(fs.existsSync(result.artifacts.reportJson!)).toBe(true);
  });

  it('captures Promise rejections from the enrichment backend', async () => {
    const sourceCsv = path.join(tmpRoot, 'in.csv');
    fs.writeFileSync(sourceCsv, 'company_name\nAcme\n', 'utf-8');

    const enrichmentRunner = vi.fn(() =>
      Promise.reject(new Error('redis down'))
    );
    const result = await runScraper(
      {
        runId: 'run-reject',
        mode: 'enrichment',
        sourceCsv,
      },
      { rootDir: tmpRoot, enrichmentRunner }
    );
    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('redis down');
  });

  it('never throws even when the backend throws a non-Error value', async () => {
    const campaignRunner = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-thrown';
    });
    const result = await runScraper(
      {
        runId: 'run-non-error',
        mode: 'campaign',
        sector: 'dentisti',
        provinces: ['VR'],
      },
      { rootDir: tmpRoot, campaignRunner }
    );
    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('UnknownError');
  });

  it('marks the run failed when a configured runtime budget is exceeded', async () => {
    const campaignCsv = path.join(tmpRoot, 'budget.csv');
    fs.writeFileSync(campaignCsv, 'company_name\nFoo\n', 'utf-8');
    const campaignRunner = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        count: 1,
        combinedCsv: campaignCsv,
        perProvinceCsvs: [campaignCsv],
        byProvince: { VR: 1 },
        droppedInvalid: 0,
        droppedLowSignal: 0,
      };
    });

    const result = await runScraper(
      {
        runId: 'run-budget-exceeded',
        mode: 'campaign',
        sector: 'dentisti',
        provinces: ['VR'],
        budget: {
          maxRunDurationMs: 1,
        },
      },
      { rootDir: tmpRoot, campaignRunner }
    );

    expect(result.status).toBe('failed');
    expect(result.error?.name).toBe('BudgetExceededError');
    expect(result.costSummary?.budgetStatus).toBe('exceeded');
    expect(result.costSummary?.warnings[0]).toContain('maxRunDurationMs exceeded');
  });
});
