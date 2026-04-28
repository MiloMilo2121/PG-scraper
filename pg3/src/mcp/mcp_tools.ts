import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import type { AgentScraperResult } from '../agent/agent_contracts';

type McpHandler = (args: any) => unknown | Promise<unknown>;

export interface McpLikeServer {
  resource(name: string, uri: string, handler: (uri: URL) => unknown | Promise<unknown>): unknown;
  tool(name: string, description: string, schema: Record<string, unknown>, handler: McpHandler): unknown;
}

export interface Pg3McpRegistrationOptions {
  projectRoot?: string;
  enableLegacyTools?: boolean;
  execCommand?: (command: string, opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;
}

const execAsync = promisify(exec);

function defaultProjectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function asMcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function asMcp(result: AgentScraperResult) {
  return asMcpJson(result, result.status === 'failed');
}

function newRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

type AgentRunArgs = {
  contractVersion?: string;
  runId?: string;
  mode: 'campaign' | 'enrichment' | 'full';
  sector?: string;
  zone?: string;
  provinces?: string[];
  limit?: number;
  sourceCsv?: string;
  context?: {
    workspaceId?: string;
    agentId?: string;
    sessionId?: string;
    actorType?: 'human' | 'agent' | 'system' | 'ci';
    traceId?: string;
  };
  budget?: {
    maxCostPerRun?: number;
    maxCostPerCompany?: number;
    maxExternalCalls?: number;
    maxRunDurationMs?: number;
  };
};

function readProjectFile(projectRoot: string, relativePath: string, missing: string): string {
  const filePath = path.resolve(projectRoot, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : missing;
}

export function registerPg3Resources(
  server: McpLikeServer,
  opts: Pg3McpRegistrationOptions = {}
): void {
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();

  server.resource('agent-rules', 'docs://agent_rules', async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: readProjectFile(projectRoot, 'docs/AGENT_RULES.md', 'AGENT_RULES.md not found.'),
      },
    ],
  }));

  server.resource('pipeline-phases', 'docs://pipeline_phases', async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: readProjectFile(projectRoot, 'docs/PIPELINE_PHASES_v2.md', 'PIPELINE_PHASES_v2.md not found.'),
      },
    ],
  }));

  server.resource('runtime-config', 'config://runtime', async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: readProjectFile(
          projectRoot,
          'src/shared-runtime/config/runtime_config.ts',
          'runtime_config.ts not found.'
        ),
      },
    ],
  }));
}

async function runTool(command: string, opts: Pg3McpRegistrationOptions) {
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();
  const execCommand = opts.execCommand ?? ((cmd, execOpts) => execAsync(cmd, execOpts));
  try {
    const { stdout, stderr } = await execCommand(command, { cwd: projectRoot });
    if (stderr && stderr.trim().length > 0) {
      console.error(`[Tool Execution Stderr]: ${stderr}`);
    }
    return {
      content: [{ type: 'text' as const, text: stdout }],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: ${error.message}\nSTDOUT: ${error.stdout || ''}\nSTDERR: ${error.stderr || ''}`,
        },
      ],
      isError: true,
    };
  }
}

export function registerPg3SensorTools(
  server: McpLikeServer,
  opts: Pg3McpRegistrationOptions = {}
): void {
  const projectRoot = opts.projectRoot ?? defaultProjectRoot();

  server.tool(
    'pg3_read_log',
    'God Mode Sensor: Read the last N lines of a log file to diagnose errors remotely.',
    {
      file_path: z.string().describe("Path to the log file (e.g. 'logs/error.log' or 'benchmark_wave_results.log')"),
      lines: z.number().default(100).describe('Number of lines to tail from the end of the file'),
    },
    async ({ file_path, lines }: { file_path: string; lines: number }) => {
      try {
        const absolutePath = path.resolve(projectRoot, file_path);
        if (!absolutePath.startsWith(path.resolve(projectRoot))) {
          return { content: [{ type: 'text' as const, text: 'ERROR: Path traversal is forbidden.' }], isError: true };
        }
        if (!fs.existsSync(absolutePath)) {
          return { content: [{ type: 'text' as const, text: `ERROR: File not found at ${absolutePath}` }], isError: true };
        }

        const { stdout } = await execAsync(`tail -n ${lines} "${absolutePath}"`);
        return { content: [{ type: 'text' as const, text: stdout }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Log Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'pg3_db_query',
    "God Mode DB Sensor: Execute a SELECT query on the local SQLite DB to read stats, job logs, or enrichment results. CAUTION: Only SELECT queries are permitted.",
    {
      query: z.string().describe("A valid SQL SELECT query. Example: 'SELECT * FROM job_log ORDER BY id DESC LIMIT 5'"),
    },
    async ({ query }: { query: string }) => {
      if (!query.trim().toUpperCase().startsWith('SELECT')) {
        return { content: [{ type: 'text' as const, text: 'ERROR: Only SELECT queries are allowed for security.' }], isError: true };
      }
      try {
        const { initializeDatabase, getDb } = await import('../enricher/db/index.js');
        try {
          initializeDatabase();
        } catch {}
        const db = getDb();
        const results = db.prepare(query).all();
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `SQL Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'pg3_queue_status',
    'God Mode Redis Sensor: Get the live status of the BullMQ enrichment queue (waiting, active, failed counts).',
    {},
    async () => {
      try {
        const { getQueueHealth } = await import('../enricher/queue/index.js');
        const health = await getQueueHealth();
        return { content: [{ type: 'text' as const, text: JSON.stringify(health, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: 'text' as const, text: `Queue Error: ${error.message}` }], isError: true };
      }
    }
  );
}

export function registerAgentMcpTools(server: McpLikeServer): void {
  server.tool(
    'agent_doctor',
    'Agent-first readiness check. Verifies canonical scripts, docs, artifacts, cost ledger writability, hidden legacy MCP tools, and optional Redis connectivity.',
    {
      projectRoot: z.string().optional().describe('Project root. Defaults to the MCP server cwd.'),
      rootDir: z.string().optional().describe('Agent runs root. Defaults to AGENT_RUNS_ROOT or output/runs.'),
      checkRedis: z.boolean().optional().describe('When true, PING Redis using redisUrl or REDIS_URL.'),
      redisUrl: z.string().optional().describe('Redis URL used when checkRedis=true.'),
    },
    async (args: { projectRoot?: string; rootDir?: string; checkRedis?: boolean; redisUrl?: string }) => {
      const { runAgentDoctor } = await import('../agent/agent_doctor.js');
      const result = await runAgentDoctor({
        projectRoot: args.projectRoot,
        rootDir: args.rootDir,
        checkRedis: args.checkRedis,
        redisUrl: args.redisUrl,
      });
      return asMcpJson(result, result.status === 'failed');
    }
  );

  server.tool(
    'agent_run',
    'Agent-first canonical action. Calls runScraper({contractVersion, runId, mode, context, budget, sector, zone, provinces, limit, sourceCsv}) in-process.',
    {
      contractVersion: z.string().optional().describe("Agent contract version. Defaults to 'agent.v1'."),
      runId: z.string().optional().describe('Stable run id. Auto-generated if omitted.'),
      mode: z.enum(['campaign', 'enrichment', 'full']).describe('campaign | enrichment | full'),
      sector: z.string().optional().describe('Required for campaign/full'),
      zone: z.string().optional().describe('Italian region, province name, or province code'),
      provinces: z.array(z.string()).optional().describe("Province codes or names, e.g. ['VR','VE']"),
      limit: z.number().int().positive().optional().describe('Max companies to keep'),
      sourceCsv: z.string().optional().describe('Required for enrichment'),
      context: z
        .object({
          workspaceId: z.string().optional(),
          agentId: z.string().optional(),
          sessionId: z.string().optional(),
          actorType: z.enum(['human', 'agent', 'system', 'ci']).optional(),
          traceId: z.string().optional(),
        })
        .optional()
        .describe('Agent/run trace context for auditability.'),
      budget: z
        .object({
          maxCostPerRun: z.number().nonnegative().optional(),
          maxCostPerCompany: z.number().nonnegative().optional(),
          maxExternalCalls: z.number().int().nonnegative().optional(),
          maxRunDurationMs: z.number().int().positive().optional(),
        })
        .optional()
        .describe('Per-run guardrails checked before report persistence.'),
    },
    async (args: AgentRunArgs) => {
      const { runScraper } = await import('../agent/agent_scraper.js');
      const result = await runScraper({
        contractVersion: args.contractVersion,
        runId: args.runId ?? newRunId(`agent-${args.mode}`),
        mode: args.mode,
        sector: args.sector,
        zone: args.zone,
        provinces: args.provinces,
        limit: args.limit,
        sourceCsv: args.sourceCsv,
        context: args.context,
        budget: args.budget,
      });
      return asMcp(result);
    }
  );

  server.tool(
    'agent_inspect_run',
    'Agent-first: inspect a run by runId. Returns the registry entry plus the persisted report.json.',
    {
      runId: z.string().describe('Run identifier returned by an earlier agent_run call'),
    },
    async ({ runId }: { runId: string }) => {
      const { inspectAgentRun } = await import('../agent/agent_inspection.js');
      const payload = inspectAgentRun(runId);
      return asMcpJson(payload, 'found' in payload && payload.found === false);
    }
  );
}

export function registerLegacyMcpTools(
  server: McpLikeServer,
  opts: Pg3McpRegistrationOptions = {}
): void {
  server.tool(
    'pg3_discover_target',
    '[DEPRECATED - use agent_run] Normalize target input and assess a URL. Use this to validate a single lead before enrichment.',
    {
      query: z.string().optional().describe('Company name to search'),
      url: z.string().optional().describe('Website URL'),
      piva: z.string().optional().describe('VAT number (Partita IVA)'),
    },
    async ({ query, url, piva }: { query?: string; url?: string; piva?: string }) => {
      let args = '';
      if (query) args += ` --query "${query}"`;
      if (url) args += ` --url "${url}"`;
      if (piva) args += ` --piva "${piva}"`;
      return runTool(`npx tsx src/agent_tools/discover_target.ts${args}`, opts);
    }
  );

  server.tool(
    'pg3_enrich_target',
    "[DEPRECATED - use agent_run mode='enrichment' for batch enrichment] Trigger specific enrichment modules for a target.",
    {
      url: z.string().describe('Target website URL. Must be valid.'),
      modules: z.string().describe("Comma separated list of modules. Valid options: 'financial', 'pec', 'social', 'email', 'contacts', 'linkedin', 'decision_maker'"),
      company_name: z.string().optional().describe('Company name (improves search accuracy)'),
      piva: z.string().optional().describe('VAT number'),
      city: z.string().optional().describe('City'),
    },
    async ({ url, modules, company_name, piva, city }: { url: string; modules: string; company_name?: string; piva?: string; city?: string }) => {
      let args = ` --url "${url}" --modules "${modules}"`;
      if (company_name) args += ` --company-name "${company_name}"`;
      if (piva) args += ` --piva "${piva}"`;
      if (city) args += ` --city "${city}"`;
      return runTool(`npx tsx src/agent_tools/enrich_target.ts${args}`, opts);
    }
  );

  server.tool(
    'pg3_qualify_target',
    '[DEPRECATED - qualification is being migrated under the agent_* path] Calculate the Visual-Product ICP score.',
    {
      data_path: z.string().describe('Path to the enriched lead JSON file'),
    },
    async ({ data_path }: { data_path: string }) => {
      return runTool(`npx tsx src/agent_tools/qualify_target.ts --data-path "${data_path}"`, opts);
    }
  );

  server.tool(
    'pg3_inspect_run',
    '[DEPRECATED - use agent_inspect_run for runId-based inspection] Inspect the state of an ongoing batch or target.',
    {
      job_id: z.string().describe('The job ID to inspect'),
    },
    async ({ job_id }: { job_id: string }) => {
      return runTool(`npx tsx src/agent_tools/inspect_run.ts --job-id "${job_id}"`, opts);
    }
  );

  server.tool(
    'pg3_run_pipeline_module',
    "[DEPRECATED - use agent_run mode='enrichment' with sourceCsv] Trigger a standard pipeline batch run from a CSV source.",
    {
      source: z.string().describe('Path to the source CSV file'),
      preset: z.string().optional().describe("Preset to use, e.g., 'B2B_Lombardia'"),
    },
    async ({ source, preset }: { source: string; preset?: string }) => {
      let args = ` --source "${source}"`;
      if (preset) args += ` --preset "${preset}"`;
      return runTool(`npx tsx src/agent_tools/run_pipeline_module.ts${args}`, opts);
    }
  );
}

export function registerPg3McpTools(
  server: McpLikeServer,
  opts: Pg3McpRegistrationOptions = {}
): void {
  registerPg3Resources(server, opts);
  registerPg3SensorTools(server, opts);
  registerAgentMcpTools(server);
  if (opts.enableLegacyTools) {
    registerLegacyMcpTools(server, opts);
  }
}
