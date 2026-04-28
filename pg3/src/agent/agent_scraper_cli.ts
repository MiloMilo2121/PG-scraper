import * as crypto from 'crypto';
import { AgentRunMode } from './agent_contracts';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';

interface ParsedFlags {
  mode?: AgentRunMode;
  runId?: string;
  sector?: string;
  zone?: string;
  provinces?: string[];
  limit?: number;
  sourceCsv?: string;
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
    limit: flags.limit,
    sourceCsv: flags.sourceCsv,
  };
}

async function main(): Promise<number> {
  initializeRuntimeEnvironment();
  initializeRuntimeConfig();
  const flags = parseArgs(process.argv.slice(2));
  const request = buildRequest(flags);
  const { runScraper } = await import('./agent_scraper');
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
