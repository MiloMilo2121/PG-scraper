import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export interface SampleCsvOptions {
  inputPath: string;
  outputPath?: string;
  limit?: number;
}

export interface SampleCsvResult {
  inputPath: string;
  outputPath: string;
  headers: string[];
  totalRows: number;
  sampledRows: number;
  limit: number;
}

export interface CliArgs {
  inputPath: string;
  outputPath?: string;
  limit: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let limit = 100;

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      inputPath = arg.slice('--input='.length).trim();
      continue;
    }
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length).trim();
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = parsed;
      continue;
    }

    positional.push(arg);
  }

  if (!inputPath && positional.length > 0) {
    inputPath = positional[0];
  }
  if (!outputPath && positional.length > 1) {
    outputPath = positional[1];
  }
  if (positional.length > 2) {
    const parsed = Number(positional[2]);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid positional limit: ${positional[2]}`);
    }
    limit = parsed;
  }

  if (!inputPath) {
    throw new Error('Missing input CSV path');
  }

  return { inputPath, outputPath, limit };
}

function detectDelimiter(csvText: string): ',' | ';' {
  const firstLine = csvText.split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function deriveOutputPath(inputPath: string, limit: number): string {
  const ext = path.extname(inputPath) || '.csv';
  const base = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  return path.join(dir, `${base}_sample_${limit}${ext}`);
}

export function sampleCsv(options: SampleCsvOptions): SampleCsvResult {
  const inputPath = path.resolve(options.inputPath);
  const limit = options.limit ?? 100;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid limit: ${limit}`);
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input CSV not found: ${inputPath}`);
  }

  const rawText = fs.readFileSync(inputPath, 'utf8');
  if (!rawText.trim()) {
    throw new Error(`Input CSV is empty: ${inputPath}`);
  }

  const delimiter = detectDelimiter(rawText);

  const headerRows = parse(rawText, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: [',', ';'],
    to_line: 1,
  }) as string[][];

  const headers = (headerRows[0] || []).map((header) => String(header));
  if (headers.length === 0) {
    throw new Error(`Input CSV has no headers: ${inputPath}`);
  }

  const allRows = parse(rawText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: [',', ';'],
  }) as Record<string, string>[];

  const sampledRows = allRows.slice(0, limit);

  const outputPath = path.resolve(options.outputPath || deriveOutputPath(inputPath, limit));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const outputCsv = stringify(sampledRows, {
    header: true,
    columns: headers,
    delimiter,
  });
  fs.writeFileSync(outputPath, outputCsv, 'utf8');

  return {
    inputPath,
    outputPath,
    headers,
    totalRows: allRows.length,
    sampledRows: sampledRows.length,
    limit,
  };
}

function printUsage(): void {
  console.error('Usage: npx ts-node scripts/sample_e2e_csv.ts <input.csv> [output.csv] [limit]');
  console.error('   or: npx ts-node scripts/sample_e2e_csv.ts --input=<input.csv> --output=<output.csv> --limit=100');
}

if (require.main === module) {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const result = sampleCsv({
      inputPath: cli.inputPath,
      outputPath: cli.outputPath,
      limit: cli.limit,
    });

    console.log(`Wrote sample CSV: ${result.outputPath}`);
    console.log(`Rows: ${result.sampledRows}/${result.totalRows} (limit=${result.limit})`);
  } catch (error) {
    const err = error as Error;
    console.error(`ERROR: ${err.message}`);
    printUsage();
    process.exit(1);
  }
}
