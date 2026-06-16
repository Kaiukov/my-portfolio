import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { mcpRead } from "./read.js";
import { mcpWrite } from "./adapter.js";

export const MCP_READ_TOOLS = [
  "status",
  "summary",
  "cash",
  "cash_drag",
  "currency_exposure",
  "income",
  "realized_gains",
  "allocation",
  "rebalance",
  "concentration",
  "diversification",
  "decomposition",
  "performance",
  "mwr",
  "transactions",
  "report",
  "health",
  "verify_prices",
  "widget",
  "asset_metadata",
  "projection",
  "withdrawal",
  "asset_analysis",
] as const;

export const MCP_WRITE_TOOLS = [
  "add_transaction",
  "edit_transaction",
  "delete_transaction",
  "exchange_currency",
  "split",
] as const;

const OPEN_ARGS_SCHEMA = z.object({}).passthrough();

function toolResponse(envelope: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(envelope, null, 2),
      },
    ],
  };
}

function registerTool(
  server: McpServer,
  toolName: (typeof MCP_READ_TOOLS)[number] | (typeof MCP_WRITE_TOOLS)[number],
  kind: "read" | "write",
) {
  server.registerTool(
    toolName,
    {
      description: `${kind === "read" ? "Read" : "Write"} tool for ${toolName}`,
      inputSchema: OPEN_ARGS_SCHEMA,
      annotations: kind === "read" ? { readOnlyHint: true, openWorldHint: false } : undefined,
    },
    async (args) => {
      const envelope = kind === "read"
        ? await mcpRead(toolName as (typeof MCP_READ_TOOLS)[number], args as Record<string, unknown>)
        : await mcpWrite(toolName as (typeof MCP_WRITE_TOOLS)[number], args as Record<string, unknown>);
      return toolResponse(envelope);
    },
  );
}

export function createPortfolioMcpServer() {
  const server = new McpServer({
    name: "portfolio-mcp",
    version: APP_VERSION,
  }, {
    capabilities: {
      tools: {},
    },
  });

  for (const toolName of MCP_READ_TOOLS) {
    registerTool(server, toolName, "read");
  }

  for (const toolName of MCP_WRITE_TOOLS) {
    registerTool(server, toolName, "write");
  }

  return server;
}

export async function runPortfolioMcpServer(): Promise<void> {
  const server = createPortfolioMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

if (import.meta.main) {
  runPortfolioMcpServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exit(1);
  });
}
