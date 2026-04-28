import * as crypto from 'crypto';
import { runScraper } from './agent_scraper';
import { AgentRunMode } from './agent_contracts';

interface ParsedFlags {
  mode?: AgentRunMode;
  runId?: string;
  sector?: string;
  zone?: string;
  provinces?: string[];
  cities?: string[];
  limit?: number;
  sourceCsv?: string;
  outputDir?: string;
  json?: string;
}

function parseArgs(argv: string[]): ParsedFlags {
  const out: ParsedFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const consume = () => {
      i++;
      return next;
    };
    switch (arg) {
      case '--mode':
        out.mode = consume() as AgentRunMode;
        break;
      case '--run-id':
        out.runId = consume();
        break;
      case '--sector':
        out.sector = consume();
        break;
      case '--zone':
        out.zone = consume();
        break;
      case '--provinces':
        out.provinces = (consume() ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--cities':
        out.cities = (consume() ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--limit': {
        const value = consume();
        if (value !== undefined) {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0) out.limit = parsed;
        }
        break;
      }
      case '--source-csv':
        out.sourceCsv = consume();
        break;
      case '--output-dir':
        out.outputDir = consume();
        break;
      case '--json':
        out.json = consume();
        break;
      default:
        break;
    }
  }
  return out;
}

function buildRequest(flags: ParsedFlags): Record<string, unknown> {
  if (flags.json) {
    try {
      return JSON.parse(flags.json) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`--json payload is not valid JSON: ${(err as Error).message}`);
    }
  }
  return {
    runId: flags.runId ?? `cli-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    mode: flags.mode ?? 'campaign',
    sector: flags.sector,
    zone: flags.zone,
    provinces: flags.provinces,
    cities: flags.cities,
    limit: flags.limit,
    sourceCsv: flags.sourceCsv,
    outputDir: flags.outputDir,
  };
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const request = buildRequest(flags);
  const result = await runScraper(request);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.status === 'failed' ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Fatal: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
