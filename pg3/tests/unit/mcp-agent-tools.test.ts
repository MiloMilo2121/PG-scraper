import { describe, expect, it } from 'vitest';
import {
  McpLikeServer,
  registerPg3McpTools,
} from '../../src/mcp/mcp_tools';

interface RegisteredTool {
  description: string;
  schema: Record<string, unknown>;
  handler: (args: any) => unknown | Promise<unknown>;
}

class FakeMcpServer implements McpLikeServer {
  readonly resources = new Map<string, { uri: string; handler: (uri: URL) => unknown | Promise<unknown> }>();
  readonly tools = new Map<string, RegisteredTool>();

  resource(name: string, uri: string, handler: (uri: URL) => unknown | Promise<unknown>): void {
    this.resources.set(name, { uri, handler });
  }

  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: any) => unknown | Promise<unknown>
  ): void {
    this.tools.set(name, { description, schema, handler });
  }
}

function parseTextPayload(result: any): any {
  const text = result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text);
}

describe('MCP agent-first tool registration', () => {
  it('registers agent-first tools by default', () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: false });

    expect(server.tools.has('agent_run')).toBe(true);
    expect(server.tools.has('agent_inspect_run')).toBe(true);
    expect(server.tools.get('agent_run')!.schema.context).toBeTruthy();
    expect(server.tools.get('agent_run')!.schema.budget).toBeTruthy();
  });

  it('keeps legacy actuator tools hidden by default', () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: false });

    expect([...server.tools.keys()].filter((name) => name.startsWith('pg3_'))).toEqual([
      'pg3_read_log',
      'pg3_db_query',
      'pg3_queue_status',
    ]);
    expect(server.tools.has('pg3_discover_target')).toBe(false);
    expect(server.tools.has('pg3_run_pipeline_module')).toBe(false);
  });

  it('registers legacy actuator tools only when the legacy flag is enabled', () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: true });

    expect(server.tools.has('pg3_discover_target')).toBe(true);
    expect(server.tools.has('pg3_enrich_target')).toBe(true);
    expect(server.tools.has('pg3_qualify_target')).toBe(true);
    expect(server.tools.has('pg3_inspect_run')).toBe(true);
    expect(server.tools.has('pg3_run_pipeline_module')).toBe(true);
  });

  it('keeps agent_run wired in-process and returns structured failures', async () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: false });

    const result = await server.tools.get('agent_run')!.handler({
      runId: 'mcp-bad-enrich',
      mode: 'enrichment',
      context: {
        workspaceId: 'workspace-mcp',
        agentId: 'codex-mcp',
        sessionId: 'session-mcp',
        actorType: 'agent',
        traceId: 'trace-mcp',
      },
      budget: {
        maxExternalCalls: 0,
      },
    });

    expect(result).toMatchObject({ isError: true });
    const payload = parseTextPayload(result);
    expect(payload).toMatchObject({
      runId: 'mcp-bad-enrich',
      status: 'failed',
      input: {
        mode: 'enrichment',
        runId: 'mcp-bad-enrich',
        context: {
          traceId: 'trace-mcp',
        },
        budget: {
          maxExternalCalls: 0,
        },
      },
      error: {
        name: 'ZodError',
      },
    });
  });

  it('registers inspect as a structured lookup tool', async () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: false });

    const result = await server.tools.get('agent_inspect_run')!.handler({
      runId: 'missing-run',
    });

    expect(result).toMatchObject({ isError: true });
    expect(parseTextPayload(result)).toEqual({
      runId: 'missing-run',
      found: false,
    });
  });

  it('registers documented MCP resources', () => {
    const server = new FakeMcpServer();
    registerPg3McpTools(server, { enableLegacyTools: false });

    expect([...server.resources.keys()].sort()).toEqual([
      'agent-rules',
      'pipeline-phases',
      'runtime-config',
    ]);
  });
});
