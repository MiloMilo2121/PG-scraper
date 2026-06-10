import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { validateOutputs } from '../../src/scripts/validate_output';

/**
 * Phase B.2 — programmatic validator entry point + raw/enriched flavors.
 */

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pg4-valfn-'));
}

const RAW_HEADER = 'company_name,category,city,phone,website,source';
const ENR_HEADER = `${RAW_HEADER},status,reason_code,official_website`;

describe('validateOutputs — Phase B.2', () => {
  it('raw flavor: rows without status/reason_code pass', async () => {
    const dir = tmpDir();
    const csv = path.join(dir, 'raw.csv');
    const jsonl = path.join(dir, 'raw.jsonl');
    fs.writeFileSync(csv, `${RAW_HEADER}\nStudio Rossi,agenzie immobiliari,Padova,+390491234567,,PG\n`, 'utf8');
    fs.writeFileSync(jsonl, JSON.stringify({ company_name: 'Studio Rossi' }) + '\n', 'utf8');

    const summary = await validateOutputs({ csvPath: csv, jsonlPath: jsonl, flavor: 'raw' });
    expect(summary.errors).toEqual([]);
    expect(summary.ok).toBe(true);
    expect(summary.csv_rows).toBe(1);
  });

  it('enriched flavor (default): missing status/reason_code is an error', async () => {
    const dir = tmpDir();
    const csv = path.join(dir, 'enr.csv');
    const jsonl = path.join(dir, 'enr.jsonl');
    fs.writeFileSync(csv, `${ENR_HEADER}\nStudio Rossi,agenzie immobiliari,Padova,,,PG,,,\n`, 'utf8');
    fs.writeFileSync(jsonl, JSON.stringify({ company_name: 'Studio Rossi' }) + '\n', 'utf8');

    const summary = await validateOutputs({ csvPath: csv, jsonlPath: jsonl });
    expect(summary.ok).toBe(false);
    expect(summary.errors.some((e) => e.includes('missing status'))).toBe(true);
    expect(summary.errors.some((e) => e.includes('missing reason_code'))).toBe(true);
  });

  it('row count mismatch between CSV and JSONL is an error', async () => {
    const dir = tmpDir();
    const csv = path.join(dir, 'x.csv');
    const jsonl = path.join(dir, 'x.jsonl');
    fs.writeFileSync(csv, `${RAW_HEADER}\nA,c,Padova,,,PG\nB,c,Padova,,,PG\n`, 'utf8');
    fs.writeFileSync(jsonl, JSON.stringify({ company_name: 'A' }) + '\n', 'utf8');

    const summary = await validateOutputs({ csvPath: csv, jsonlPath: jsonl, flavor: 'raw' });
    expect(summary.ok).toBe(false);
    expect(summary.errors.some((e) => e.includes('Row count mismatch'))).toBe(true);
  });

  it('never exits the process — returns the summary even on missing files', async () => {
    const dir = tmpDir();
    const summary = await validateOutputs({
      csvPath: path.join(dir, 'absent.csv'),
      jsonlPath: path.join(dir, 'absent.jsonl'),
      flavor: 'raw',
    });
    expect(summary.ok).toBe(false);
    expect(summary.errors.length).toBeGreaterThanOrEqual(2);
  });
});
