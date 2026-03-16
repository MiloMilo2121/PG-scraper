import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { parseCliArgs, sampleCsv } from '../../scripts/sample_e2e_csv';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('sample_e2e_csv', () => {
  it('creates a fresh CSV with the first N rows and preserved headers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-e2e-csv-'));
    const input = path.join(tmpDir, 'input.csv');
    const output = path.join(tmpDir, 'out.csv');

    writeFile(
      input,
      [
        'company_name,city,phone,vat_code',
        'ACME SRL,Milano,021111111,12345678901',
        'Beta SNC,Bergamo,022222222,12345678902',
        'Gamma SPA,Brescia,023333333,12345678903',
      ].join('\n')
    );

    const result = sampleCsv({ inputPath: input, outputPath: output, limit: 2 });
    expect(result.totalRows).toBe(3);
    expect(result.sampledRows).toBe(2);
    expect(result.limit).toBe(2);

    const outputText = fs.readFileSync(output, 'utf8');
    const rows = parse(outputText, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ',',
    }) as Record<string, string>[];

    expect(rows).toHaveLength(2);
    expect(rows[0].company_name).toBe('ACME SRL');
    expect(rows[1].company_name).toBe('Beta SNC');

    const header = outputText.split('\n', 1)[0];
    expect(header).toBe('company_name,city,phone,vat_code');
  });

  it('supports header-only CSV input and writes only headers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-e2e-csv-'));
    const input = path.join(tmpDir, 'input_header_only.csv');
    const output = path.join(tmpDir, 'out_header_only.csv');

    writeFile(input, 'company_name,city,phone,vat_code\n');
    const result = sampleCsv({ inputPath: input, outputPath: output });

    expect(result.totalRows).toBe(0);
    expect(result.sampledRows).toBe(0);
    expect(result.limit).toBe(100);

    const outputText = fs.readFileSync(output, 'utf8').trim();
    expect(outputText).toBe('company_name,city,phone,vat_code');
  });

  it('parses positional and flag-based CLI arguments with default limit', () => {
    expect(parseCliArgs(['input.csv'])).toEqual({
      inputPath: 'input.csv',
      outputPath: undefined,
      limit: 100,
    });

    expect(parseCliArgs(['--input=in.csv', '--output=out.csv', '--limit=25'])).toEqual({
      inputPath: 'in.csv',
      outputPath: 'out.csv',
      limit: 25,
    });
  });
});
