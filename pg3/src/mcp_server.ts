import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

// Import PG3 native dependencies for "God Mode" introspection
import { getDb, initializeDatabase } from "./enricher/db/index.js";
import { getQueueHealth } from "./enricher/queue/index.js";

const execAsync = promisify(exec);

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
            content: [{ type: "text", text: stdout }],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `ERROR: ${error.message}\nSTDOUT: ${error.stdout || ''}\nSTDERR: ${error.stderr || ''}` }],
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
    async ({ file_path, lines }) => {
        try {
            const absolutePath = path.resolve(__dirname, "..", file_path);
            // Basic security: ensure the path is within the pg3 directory
            if (!absolutePath.startsWith(path.resolve(__dirname, ".."))) {
                return { content: [{ type: "text", text: "ERROR: Path traversal is forbidden." }], isError: true };
            }
            if (!fs.existsSync(absolutePath)) {
                 return { content: [{ type: "text", text: `ERROR: File not found at ${absolutePath}` }], isError: true };
            }
            
            // Using tail to grab the last N lines without loading massive files into RAM
            const { stdout } = await execAsync(`tail -n ${lines} "${absolutePath}"`);
            return { content: [{ type: "text", text: stdout }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Log Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "pg3_db_query",
    "God Mode DB Sensor: Execute a SELECT query on the local SQLite DB to read stats, job logs, or enrichment results. CAUTION: Only SELECT queries are permitted.",
    {
        query: z.string().describe("A valid SQL SELECT query. Example: 'SELECT * FROM job_log ORDER BY id DESC LIMIT 5'")
    },
    async ({ query }) => {
        if (!query.trim().toUpperCase().startsWith("SELECT")) {
            return { content: [{ type: "text", text: "ERROR: Only SELECT queries are allowed for security." }], isError: true };
        }
        try {
            // Ensure DB is initialized
            try { initializeDatabase(); } catch (e) {} 
            const db = getDb();
            const results = db.prepare(query).all();
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `SQL Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool(
    "pg3_queue_status",
    "God Mode Redis Sensor: Get the live status of the BullMQ enrichment queue (waiting, active, failed counts).",
    {},
    async () => {
        try {
            const health = await getQueueHealth();
            return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Queue Error: ${error.message}` }], isError: true };
        }
    }
);


// --- ACTUATORS (CLI Wrappers) ---

server.tool(
    "pg3_discover_target",
    "Normalize target input and assess a URL. Use this to validate a single lead before enrichment.",
    {
        query: z.string().optional().describe("Company name to search"),
        url: z.string().optional().describe("Website URL"),
        piva: z.string().optional().describe("VAT number (Partita IVA)")
    },
    async ({ query, url, piva }) => {
        let args = "";
        if (query) args += ` --query "${query}"`;
        if (url) args += ` --url "${url}"`;
        if (piva) args += ` --piva "${piva}"`;
        return runTool(`npx tsx src/agent_tools/discover_target.ts${args}`);
    }
);

server.tool(
    "pg3_enrich_target",
    "Trigger specific enrichment modules (financial, contacts, social) for a target. This launches the Omega runtime asynchronously.",
    {
        url: z.string().describe("Target website URL. Must be valid."),
        modules: z.string().describe("Comma separated list of modules. Valid options: 'financial', 'pec', 'social', 'email', 'contacts', 'linkedin', 'decision_maker'"),
        company_name: z.string().optional().describe("Company name (improves search accuracy)"),
        piva: z.string().optional().describe("VAT number"),
        city: z.string().optional().describe("City")
    },
    async ({ url, modules, company_name, piva, city }) => {
        let args = ` --url "${url}" --modules "${modules}"`;
        if (company_name) args += ` --company-name "${company_name}"`;
        if (piva) args += ` --piva "${piva}"`;
        if (city) args += ` --city "${city}"`;
        return runTool(`npx tsx src/agent_tools/enrich_target.ts${args}`);
    }
);

server.tool(
    "pg3_qualify_target",
    "Calculate the Visual-Product ICP score using LLMs and VisionExtractor heuristics. (Currently deferred in PG3)",
    {
        data_path: z.string().describe("Path to the enriched lead JSON file")
    },
    async ({ data_path }) => {
        return runTool(`npx tsx src/agent_tools/qualify_target.ts --data-path "${data_path}"`);
    }
);

server.tool(
    "pg3_inspect_run",
    "Inspect the state of an ongoing batch or a specific target in the DB/Cache. (Note: use pg3_db_query for granular data)",
    {
        job_id: z.string().describe("The job ID to inspect")
    },
    async ({ job_id }) => {
        return runTool(`npx tsx src/agent_tools/inspect_run.ts --job-id "${job_id}"`);
    }
);

server.tool(
    "pg3_run_pipeline_module",
    "Trigger a standard pipeline batch run from a CSV source. Use this to start a massive parallel run.",
    {
        source: z.string().describe("Path to the source CSV file"),
        preset: z.string().optional().describe("Preset to use, e.g., 'B2B_Lombardia'")
    },
    async ({ source, preset }) => {
        let args = ` --source "${source}"`;
        if (preset) args += ` --preset "${preset}"`;
        return runTool(`npx tsx src/agent_tools/run_pipeline_module.ts${args}`);
    }
);

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PG3 MCP Server (God Mode) running on stdio");
}

main().catch(console.error);
