import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CostLedger } from '../../src/runtime/cost_ledger';
import { readJsonlObjects } from '../../src/io/jsonl_writer';

const tmpFile = (name: string) =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg4-ledger-')), name);

describe('CostLedger — in-memory aggregation (legacy contract)', () => {
  it('totals cost', () => {
    const l = new CostLedger();
    l.record('a', 'serp', 0.001, true);
    l.record('a', 'serp', 0.001, false);
    l.record('b', 'http', 0.005, true);
    expect(l.getTotal()).toBeCloseTo(0.007, 6);
  });

  it('per-provider success rate + by_kind', () => {
    const l = new CostLedger();
    l.record('serper', 'serp', 0.001, true, { kind: 'success' });
    l.record('serper', 'serp', 0, false, { kind: 'empty' });
    l.record('serper', 'serp', 0, false, { kind: 'blocked' });
    const by = l.getByProvider();
    expect(by.serper.calls).toBe(3);
    expect(by.serper.success_rate).toBeCloseTo(1 / 3, 6);
    expect(by.serper.by_kind).toEqual({ success: 1, empty: 1, blocked: 1 });
  });

  it('costForLead sums entries with matching meta.lead_id', () => {
    const l = new CostLedger();
    l.record('a', 'serp', 0.001, true, { meta: { lead_id: 'L1' } });
    l.record('a', 'serp', 0.002, true, { meta: { lead_id: 'L1' } });
    l.record('a', 'serp', 0.005, true, { meta: { lead_id: 'L2' } });
    l.record('a', 'serp', 0.010, true);
    expect(l.costForLead('L1')).toBeCloseTo(0.003, 6);
    expect(l.costForLead('L2')).toBeCloseTo(0.005, 6);
  });
});

describe('CostLedger — JSONL persistence', () => {
  it('appends one line per record + a final summary line', async () => {
    const file = tmpFile('ledger.jsonl');
    const l = new CostLedger({ jsonlPath: file, runId: 'run-test' });
    l.record('serper', 'serp', 0.001, true, { kind: 'success' });
    l.record('bing_html', 'serp', 0, false, { kind: 'blocked' });
    l.record('direct_fetch', 'http', 0, true);
    l.flushSummary({ leads_processed: 1 });

    const lines = await readJsonlObjects<Record<string, unknown>>(file);
    expect(lines.length).toBe(4);
    // first three are records, last is summary
    expect((lines[0] as { provider: string }).provider).toBe('serper');
    expect((lines[1] as { kind: string }).kind).toBe('blocked');
    expect((lines[2] as { provider: string }).provider).toBe('direct_fetch');
    const summary = lines[3] as { kind: string; total_calls: number; total_cost_eur: number; run_id: string; leads_processed: number };
    expect(summary.kind).toBe('summary');
    expect(summary.total_calls).toBe(3);
    expect(summary.total_cost_eur).toBeCloseTo(0.001, 6);
    expect(summary.run_id).toBe('run-test');
    expect(summary.leads_processed).toBe(1);
  });

  it('flushSummary is idempotent', async () => {
    const file = tmpFile('idem.jsonl');
    const l = new CostLedger({ jsonlPath: file });
    l.record('a', 'serp', 0, true);
    l.flushSummary();
    l.flushSummary();
    l.flushSummary();
    const lines = await readJsonlObjects(file);
    expect(lines.length).toBe(2); // one record + one summary
  });

  it('survives without a jsonlPath (in-memory only mode)', () => {
    const l = new CostLedger();
    l.record('a', 'serp', 0.001, true);
    l.flushSummary(); // must not throw
    expect(l.getTotal()).toBeCloseTo(0.001, 6);
  });
});
