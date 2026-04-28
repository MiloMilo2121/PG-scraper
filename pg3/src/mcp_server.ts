import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { initializeRuntimeEnvironment } from "./shared-runtime/config/runtime_bootstrap.js";
import { initializeRuntimeConfig } from "./shared-runtime/config/runtime_config.js";
import type { AgentScraperResult } from "./agent/agent_contracts.js";

initializeRuntimeEnvironment();
initializeRuntimeConfig();

function asMcpJson(payload: unknown, isError = false) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        isError,
    };
}

function newRunId(prefix: string): string {
    return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function asMcp(result: AgentScraperResult) {
    return asMcpJson(result, result.status === 'failed');
}

const execAsync = promisify(exec);
const ENABLE_LEGACY_MCP_TOOLS = process.env.PG3_ENABLE_LEGACY_MCP_TOOLS === 'true';

// Create an MCP server instance
const server = new McpServer({
  name: "pg3-mcp-server-god-mode",
  version: "2.0.0"
});

// Helper to run a CLI tool safely
async function runTool(command: string) {
    try {
        const { stdout, stderr } = await execAsync(command, { cwd: path.resolve(__dirname, "..") });
        if (stderr && stderr.trim().length > 0) {
            console.error(`[Tool Execution Stderr]: ${stderr}`);
        }
        return {
            content: [{ type: "text" as const, text: stdout }],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text" as const, text: `ERROR: ${error.message}\nSTDOUT: ${error.stdout || ''}\nSTDERR: ${error.stderr || ''}` }],
            isError: true
        };
    }
}

// ==========================================
// 📚 RESOURCES (Context for the Agent)
// ==========================================

server.resource(
    "agent-rules",
    "docs://agent_rules",
    async (uri) => {
        const filePath = path.resolve(__dirname, "../docs/AGENT_RULES.md");
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "AGENT_RULES.md not found.";
        return {
            contents: [{
                uri: uri.href,
                text: content
            }]
        };
    }
);

server.resource(
    "pipeline-phases",
    "docs://pipeline_phases",
    async (uri) => {
        const filePath = path.resolve(__dirname, "../docs/PIPELINE_PHASES_v2.md");
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "PIPELINE_PHASES_v2.md not found.";
        return {
            contents: [{
                uri: uri.href,
                text: content
            }]
        };
    }
);

server.resource(
    "runtime-config",
    "config://runtime",
    async (uri) => {
        const filePath = path.resolve(__dirname, "./shared-runtime/config/runtime_config.ts");
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "runtime_config.ts not found.";
        return {
            contents: [{
                uri: uri.href,
                text: content
            }]
        };
    }
);

// ==========================================
// 🛠️ TOOLS (Sensors & Actuators)
// ==========================================

// --- SENSORS (Introspection) ---

server.tool(
    "pg3_read_log",
    "God Mode Sensor: Read the last N lines of a log file to diagnose errors remotely.",
    {
        file_path: z.string().describe("Path to the log file (e.g. 'logs/error.log' or 'benchmark_wave_results.log')"),
        lines: z.number().default(100).describe("Number of lines to tail from the end of the file")
    },
    async ({ file_path, lines }: { file_path: string; lines: number }) => {
        try {
            const absolutePath = path.resolve(__dirname, "..", file_path);
            // Basic security: ensure the path is within the pg3 directory
            if (!absolutePath.startsWith(path.resolve(__dirname, ".."))) {
                return { content: [{ type: "text" as const, text: "ERROR: Path traversal is forbidden." }], isError: true };
            }
            if (!fs.existsSync(absolutePath)) {
                 return { content: [{ type: "text" as const, text: `ERROR: File not found at ${absolutePath}` }], isError: true };
            }
            
            // Using tail to grab the last N lines without loading massive files into RAM
            const { stdout } = await execAsync(`tail -n ${lines} "${absolutePath}"`);
            return { content: [{ type: "text" as const, text: stdout }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Log Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "pg3_db_query",
    "God Mode DB Sensor: Execute a SELECT query on the local SQLite DB to read stats, job logs, or enrichment results. CAUTION: Only SELECT queries are permitted.",
    {
        query: z.string().describe("A valid SQL SELECT query. Example: 'SELECT * FROM job_log ORDER BY id DESC LIMIT 5'")
    },
    async ({ query }: { query: string }) => {
        if (!query.trim().toUpperCase().startsWith("SELECT")) {
            return { content: [{ type: "text" as const, text: "ERROR: Only SELECT queries are allowed for security." }], isError: true };
        }
        try {
            // Ensure DB is initialized
            const { initializeDatabase, getDb } = await import("./enricher/db/index.js");
            try { initializeDatabase(); } catch (e) {} 
            const db = getDb();
            const results = db.prepare(query).all();
            return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `SQL Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "pg3_queue_status",
    "God Mode Redis Sensor: Get the live status of the BullMQ enrichment queue (waiting, active, failed counts).",
    {},
    async () => {
        try {
            const { getQueueHealth } = await import("./enricher/queue/index.js");
            const health = await getQueueHealth();
            return { content: [{ type: "text" as const, text: JSON.stringify(health, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Queue Error: ${error.message}` }], isError: true };
        }
    }
);


// ==========================================
// 🤖 AGENT-FIRST OFFICIAL PATH (in-process, no shell-out)
// ==========================================
// One contract: runScraper({runId, sector, zone, mode, ...}). Every campaign
// or enrichment goes through here; the registry keeps every runId
// inspectable. Legacy "pg3_*" tools below are hidden unless explicitly enabled.

server.tool(
    "agent_run",
    "Agent-first canonical action. Calls runScraper({runId, mode, sector, zone, provinces, limit, sourceCsv}) in-process.",
    {
        runId: z.string().optional().describe("Stable run id. Auto-generated if omitted."),
        mode: z.enum(['campaign', 'enrichment', 'full']).describe("campaign | enrichment | full"),
        sector: z.string().optional().describe("Required for campaign/full"),
        zone: z.string().optional().describe("Italian region, province name, or province code"),
        provinces: z.array(z.string()).optional().describe("Province codes or names, e.g. ['VR','VE']"),
        limit: z.number().int().positive().optional().describe("Max companies to keep"),
        sourceCsv: z.string().optional().describe("Required for enrichment"),
    },
    async (args: { runId?: string; mode: 'campaign' | 'enrichment' | 'full'; sector?: string; zone?: string; provinces?: string[]; limit?: number; sourceCsv?: string }) => {
        const { runScraper } = await import("./agent/agent_scraper.js");
        const result = await runScraper({
            runId: args.runId ?? newRunId(`agent-${args.mode}`),
            mode: args.mode,
            sector: args.sector,
            zone: args.zone,
            provinces: args.provinces,
            limit: args.limit,
            sourceCsv: args.sourceCsv,
        });
        return asMcp(result);
    }
);

server.tool(
    "agent_inspect_run",
    "Agent-first: inspect a run by runId. Returns the registry entry plus the persisted report.json.",
    {
        runId: z.string().describe("Run identifier returned by an earlier agent_run call"),
    },
    async ({ runId }: { runId: string }) => {
        const { AgentRunRegistry } = await import("./agent/agent_run_registry.js");
        const registry = new AgentRunRegistry();
        const entry = registry.get(runId);
        if (!entry) {
            return asMcpJson({ runId, found: false }, true);
        }
        const reportPath = entry.result?.artifacts?.reportJson;
        let report: unknown = null;
        if (reportPath && fs.existsSync(reportPath)) {
            try {
                report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
            } catch {
                report = null;
            }
        }
        return asMcpJson({ entry, report });
    }
);


// ==========================================
// LEGACY ACTUATORS (DEPRECATED — hidden unless PG3_ENABLE_LEGACY_MCP_TOOLS=true)
// ==========================================

if (ENABLE_LEGACY_MCP_TOOLS) {
server.tool(
    "pg3_discover_target",
    "[DEPRECATED — use agent_run] Normalize target input and assess a URL. Use this to validate a single lead before enrichment.",
    {
        query: z.string().optional().describe("Company name to search"),
        url: z.string().optional().describe("Website URL"),
        piva: z.string().optional().describe("VAT number (Partita IVA)")
    },
    async ({ query, url, piva }: { query?: string; url?: string; piva?: string }) => {
        let args = "";
        if (query) args += ` --query "${query}"`;
        if (url) args += ` --url "${url}"`;
        if (piva) args += ` --piva "${piva}"`;
        return runTool(`npx tsx src/agent_tools/discover_target.ts${args}`);
    }
);

server.tool(
    "pg3_enrich_target",
    "[DEPRECATED — use agent_run mode='enrichment' for batch enrichment] Trigger specific enrichment modules (financial, contacts, social) for a target. This launches the Omega runtime asynchronously.",
    {
        url: z.string().describe("Target website URL. Must be valid."),
        modules: z.string().describe("Comma separated list of modules. Valid options: 'financial', 'pec', 'social', 'email', 'contacts', 'linkedin', 'decision_maker'"),
        company_name: z.string().optional().describe("Company name (improves search accuracy)"),
        piva: z.string().optional().describe("VAT number"),
        city: z.string().optional().describe("City")
    },
    async ({ url, modules, company_name, piva, city }: { url: string; modules: string; company_name?: string; piva?: string; city?: string }) => {
        let args = ` --url "${url}" --modules "${modules}"`;
        if (company_name) args += ` --company-name "${company_name}"`;
        if (piva) args += ` --piva "${piva}"`;
        if (city) args += ` --city "${city}"`;
        return runTool(`npx tsx src/agent_tools/enrich_target.ts${args}`);
    }
);

server.tool(
    "pg3_qualify_target",
    "[DEPRECATED — qualification is being migrated under the agent_* path] Calculate the Visual-Product ICP score using LLMs and VisionExtractor heuristics. (Currently deferred in PG3)",
    {
        data_path: z.string().describe("Path to the enriched lead JSON file")
    },
    async ({ data_path }: { data_path: string }) => {
        return runTool(`npx tsx src/agent_tools/qualify_target.ts --data-path "${data_path}"`);
    }
);

server.tool(
    "pg3_inspect_run",
    "[DEPRECATED — use agent_inspect_run for runId-based inspection] Inspect the state of an ongoing batch or a specific target in the DB/Cache. (Note: use pg3_db_query for granular data)",
    {
        job_id: z.string().describe("The job ID to inspect")
    },
    async ({ job_id }: { job_id: string }) => {
        return runTool(`npx tsx src/agent_tools/inspect_run.ts --job-id "${job_id}"`);
    }
);

server.tool(
    "pg3_run_pipeline_module",
    "[DEPRECATED — use agent_run mode='enrichment' with sourceCsv] Trigger a standard pipeline batch run from a CSV source. Use this to start a massive parallel run.",
    {
        source: z.string().describe("Path to the source CSV file"),
        preset: z.string().optional().describe("Preset to use, e.g., 'B2B_Lombardia'")
    },
    async ({ source, preset }: { source: string; preset?: string }) => {
        let args = ` --source "${source}"`;
        if (preset) args += ` --preset "${preset}"`;
        return runTool(`npx tsx src/agent_tools/run_pipeline_module.ts${args}`);
    }
);
}

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PG3 MCP Server (God Mode) running on stdio");
}

main().catch(console.error);
