import fs from 'fs';
import os from 'os';
import path from 'path';

export type AgentDoctorStatus = 'ok' | 'warning' | 'failed';

export interface AgentDoctorCheck {
  name: string;
  status: AgentDoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface AgentDoctorOptions {
  projectRoot?: string;
  rootDir?: string;
  checkRedis?: boolean;
  redisUrl?: string;
}

export interface AgentDoctorResult {
  status: AgentDoctorStatus;
  checkedAt: string;
  projectRoot: string;
  runsRoot: string;
  checks: AgentDoctorCheck[];
  recommendations: string[];
}

interface PackageJson {
  engines?: {
    node?: string;
  };
  scripts?: Record<string, string>;
}

function resolveProjectRoot(input?: string): string {
  return path.resolve(input ?? process.cwd());
}

function resolveRunsRoot(projectRoot: string, input?: string): string {
  const raw = input || process.env.AGENT_RUNS_ROOT || path.join('output', 'runs');
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
}

function resolveRuntimeCostLedgerPath(projectRoot: string): string {
  const runtimeDataDir = process.env.RUNTIME_DATA_DIR || path.join('data');
  const raw = process.env.COST_LEDGER_PATH || path.join(runtimeDataDir, 'cost_ledger.jsonl');
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
}

function readPackageJson(projectRoot: string): PackageJson | undefined {
  const packagePath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packagePath)) return undefined;
  return JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as PackageJson;
}

function parseNodeVersion(version: string): [number, number, number] {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return [
    Number.parseInt(major, 10) || 0,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ];
}

function nodeSatisfiesPinnedRuntime(version: string): boolean {
  const [major, minor, patch] = parseNodeVersion(version);
  if (major !== 22) return false;
  if (minor > 14) return true;
  if (minor < 14) return false;
  return patch >= 0;
}

function addCheck(checks: AgentDoctorCheck[], check: AgentDoctorCheck): void {
  checks.push(check);
}

function checkFileExists(projectRoot: string, relativePath: string): AgentDoctorCheck {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.existsSync(absolutePath)
    ? {
        name: `file:${relativePath}`,
        status: 'ok',
        message: `${relativePath} exists.`,
      }
    : {
        name: `file:${relativePath}`,
        status: 'failed',
        message: `${relativePath} is missing.`,
        details: { absolutePath },
      };
}

function checkWritableDirectory(name: string, directory: string): AgentDoctorCheck {
  const tempFile = path.join(
    directory,
    `.doctor-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempFile, 'ok', 'utf-8');
    fs.unlinkSync(tempFile);
    return {
      name,
      status: 'ok',
      message: `${directory} is writable.`,
      details: { directory },
    };
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
    return {
      name,
      status: 'failed',
      message: `${directory} is not writable.`,
      details: {
        directory,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function checkRedis(redisUrl: string): Promise<AgentDoctorCheck> {
  let redis:
    | {
        connect: () => Promise<void>;
        ping: () => Promise<string>;
        quit: () => Promise<unknown>;
        disconnect: () => void;
        on?: (event: 'error', listener: (error: Error) => void) => unknown;
      }
    | undefined;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 300,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redis.on?.('error', () => undefined);
    await redis.connect();
    const pong = await redis.ping();
    await redis.quit();
    return {
      name: 'redis',
      status: pong === 'PONG' ? 'ok' : 'failed',
      message: pong === 'PONG' ? 'Redis responded to PING.' : `Redis returned ${pong}.`,
      details: { redisUrl },
    };
  } catch (error) {
    try {
      redis?.disconnect();
    } catch {}
    return {
      name: 'redis',
      status: 'failed',
      message: 'Redis check failed.',
      details: {
        redisUrl,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function aggregateStatus(checks: AgentDoctorCheck[]): AgentDoctorStatus {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'ok';
}

function buildRecommendations(checks: AgentDoctorCheck[], checkRedisRequested: boolean): string[] {
  const recommendations: string[] = [];

  if (checks.some((check) => check.status === 'failed')) {
    recommendations.push('Fix failed checks before handing this repo to a cloud coworker agent.');
  }
  if (checks.some((check) => check.name === 'env:OPENAI_API_KEY' && check.status === 'warning')) {
    recommendations.push('Set OPENAI_API_KEY for real discovery/enrichment runs; use test-key only for local gates.');
  }
  if (checks.some((check) => check.name === 'mcp:legacy_tools' && check.status === 'warning')) {
    recommendations.push('Unset PG3_ENABLE_LEGACY_MCP_TOOLS unless you are explicitly maintaining deprecated pg3_* flows.');
  }
  if (!checkRedisRequested) {
    recommendations.push('Run npm run agent:doctor -- --check-redis before Redis-backed smoke tests or queued enrichment.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Agent-first runtime is ready: use npm run agent, npm run agent:inspect, or MCP agent_* tools.');
  }

  return recommendations;
}

export async function runAgentDoctor(options: AgentDoctorOptions = {}): Promise<AgentDoctorResult> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const runsRoot = resolveRunsRoot(projectRoot, options.rootDir);
  const packageJson = readPackageJson(projectRoot);
  const checks: AgentDoctorCheck[] = [];

  addCheck(
    checks,
    packageJson
      ? {
          name: 'project:package_json',
          status: 'ok',
          message: 'package.json found.',
        }
      : {
          name: 'project:package_json',
          status: 'failed',
          message: 'package.json not found at project root.',
          details: { projectRoot },
        }
  );

  const expectedNodeRange = packageJson?.engines?.node ?? '>=22.14.0 <23';
  const nodeVersion = process.versions.node;
  const nodeMatchesPinnedRuntime = nodeSatisfiesPinnedRuntime(nodeVersion);
  addCheck(checks, {
    name: 'runtime:node',
    status: nodeMatchesPinnedRuntime ? 'ok' : 'warning',
    message: nodeMatchesPinnedRuntime
      ? `Node ${nodeVersion} matches the pinned PG3 runtime.`
      : `Node ${nodeVersion} does not match ${expectedNodeRange}; use the pinned runtime for production parity.`,
    details: { nodeVersion, expectedNodeRange },
  });

  const scripts = packageJson?.scripts ?? {};
  const requiredScripts = ['agent', 'agent:inspect', 'agent:doctor'];
  const missingScripts = requiredScripts.filter((script) => !scripts[script]);
  addCheck(checks, {
    name: 'package:scripts',
    status: missingScripts.length === 0 ? 'ok' : 'failed',
    message:
      missingScripts.length === 0
        ? 'Canonical agent npm scripts are present.'
        : `Missing canonical scripts: ${missingScripts.join(', ')}.`,
    details: { requiredScripts, missingScripts },
  });

  [
    'docs/AGENT_FIRST_CONTRACT.md',
    'docs/AGENT_RULES.md',
    'src/agent/agent_scraper.ts',
    'src/agent/agent_contracts.ts',
    'src/agent/agent_costs.ts',
    'src/agent/agent_inspection.ts',
    'src/mcp/mcp_tools.ts',
  ].forEach((relativePath) => addCheck(checks, checkFileExists(projectRoot, relativePath)));

  addCheck(checks, checkWritableDirectory('artifacts:runs_root', runsRoot));

  const runtimeLedgerPath = resolveRuntimeCostLedgerPath(projectRoot);
  addCheck(checks, checkWritableDirectory('artifacts:runtime_cost_ledger_parent', path.dirname(runtimeLedgerPath)));

  addCheck(checks, {
    name: 'mcp:legacy_tools',
    status: process.env.PG3_ENABLE_LEGACY_MCP_TOOLS === 'true' ? 'warning' : 'ok',
    message:
      process.env.PG3_ENABLE_LEGACY_MCP_TOOLS === 'true'
        ? 'Legacy pg3_* actuator tools are enabled.'
        : 'Legacy pg3_* actuator tools are hidden by default.',
  });

  addCheck(checks, {
    name: 'env:OPENAI_API_KEY',
    status: process.env.OPENAI_API_KEY ? 'ok' : 'warning',
    message: process.env.OPENAI_API_KEY
      ? 'OPENAI_API_KEY is configured.'
      : 'OPENAI_API_KEY is not configured; real AI-backed runs may fail.',
  });

  if (options.checkRedis) {
    const redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';
    addCheck(checks, await checkRedis(redisUrl));
  }

  const status = aggregateStatus(checks);

  return {
    status,
    checkedAt: new Date().toISOString(),
    projectRoot,
    runsRoot,
    checks,
    recommendations: buildRecommendations(checks, options.checkRedis === true),
  };
}
