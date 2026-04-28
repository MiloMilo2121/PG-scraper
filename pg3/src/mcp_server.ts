import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "path";
import { initializeRuntimeEnvironment } from "./shared-runtime/config/runtime_bootstrap.js";
import { initializeRuntimeConfig } from "./shared-runtime/config/runtime_config.js";
import {
    McpLikeServer,
    registerPg3McpTools,
} from "./mcp/mcp_tools.js";

export function createPg3McpServer(): McpServer {
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const server = new McpServer({
        name: "pg3-mcp-server-god-mode",
        version: "2.0.0",
    });

    registerPg3McpTools(server as unknown as McpLikeServer, {
        projectRoot: path.resolve(__dirname, ".."),
        enableLegacyTools: process.env.PG3_ENABLE_LEGACY_MCP_TOOLS === "true",
    });

    return server;
}

async function main() {
    const server = createPg3McpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PG3 MCP Server (God Mode) running on stdio");
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
