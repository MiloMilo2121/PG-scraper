import * as crypto from 'crypto';
import { AgentActorType, AgentRunMode } from './agent_contracts';
import { initializeRuntimeEnvironment } from '../shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from '../shared-runtime/config/runtime_config';

interface ParsedFlags {
  contractVersion?: string;
  mode?: AgentRunMode;
  runId?: string;
  sector?: string;
  zone?: string;
  provinces?: string[];
  limit?: number;
  sourceCsv?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  actorType?: AgentActorType;
  traceId?: string;
  maxCostPerRun?: number;
  maxCostPerCompany?: number;
  maxExternalCalls?: number;
  maxRunDurationMs?: number;
  json?: string;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
      case '--contract-version':
        out.contractVersion = consume();
        break;
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
        const parsed = parseInteger(consume());
        if (parsed !== undefined && parsed > 0) out.limit = parsed;
        break;
      }
      case '--source-csv':
        out.sourceCsv = consume();
        break;
      case '--workspace-id':
        out.workspaceId = consume();
        break;
      case '--agent-id':
        out.agentId = consume();
        break;
      case '--session-id':
        out.sessionId = consume();
        break;
      case '--actor-type':
        out.actorType = consume() as AgentActorType;
        break;
      case '--trace-id':
        out.traceId = consume();
        break;
      case '--max-cost-per-run':
        out.maxCostPerRun = parseNumber(consume());
        break;
      case '--max-cost-per-company':
        out.maxCostPerCompany = parseNumber(consume());
        break;
      case '--max-external-calls':
        out.maxExternalCalls = parseInteger(consume());
        break;
      case '--max-run-duration-ms':
        out.maxRunDurationMs = parseInteger(consume());
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
  const context = {
    workspaceId: flags.workspaceId,
    agentId: flags.agentId,
    sessionId: flags.sessionId,
    actorType: flags.actorType,
    traceId: flags.traceId,
  };
  const budget = {
    maxCostPerRun: flags.maxCostPerRun,
    maxCostPerCompany: flags.maxCostPerCompany,
    maxExternalCalls: flags.maxExternalCalls,
    maxRunDurationMs: flags.maxRunDurationMs,
  };
  const compact = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
  const compactContext = compact(context);
  const compactBudget = compact(budget);

  return {
    contractVersion: flags.contractVersion,
    runId: flags.runId ?? `cli-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    mode: flags.mode ?? 'campaign',
    sector: flags.sector,
    zone: flags.zone,
    provinces: flags.provinces,
    limit: flags.limit,
    sourceCsv: flags.sourceCsv,
    ...(Object.keys(compactContext).length > 0 ? { context: compactContext } : {}),
    ...(Object.keys(compactBudget).length > 0 ? { budget: compactBudget } : {}),
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
