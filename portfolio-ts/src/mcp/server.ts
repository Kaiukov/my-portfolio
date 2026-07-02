import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const READ_ARGS_SCHEMA = z.object({}).passthrough();

const ADD_TRANSACTION_SCHEMA = z
  .object({
    date: z.string().describe("Transaction date (YYYY-MM-DD)"),
    asset: z.string().describe("Asset symbol/ticker"),
    action: z.string().describe("Buy or Sell"),
    quantity: z.number().describe("Number of units/shares"),
    price: z.number().optional().describe("Price per unit"),
    currency: z.string().optional().describe("Transaction currency"),
    fees: z.number().optional().describe("Transaction fees"),
    feeCurrency: z.string().optional().describe("Fee currency"),
    exchange: z.string().optional().describe("Exchange name"),
    account: z.string().optional().describe("Account name"),
  })
  .passthrough();

const EDIT_TRANSACTION_SCHEMA = z
  .object({
    id: z.number().int().describe("Transaction ID"),
    date: z.string().optional().describe("Transaction date (YYYY-MM-DD)"),
    asset: z.string().optional().describe("Asset symbol/ticker"),
    action: z.string().optional().describe("Buy or Sell"),
    quantity: z.number().optional().describe("Number of units/shares"),
    price: z.number().optional().describe("Price per unit"),
    currency: z.string().optional().describe("Transaction currency"),
    fees: z.number().optional().describe("Transaction fees"),
    feeCurrency: z.string().optional().describe("Fee currency"),
    exchange: z.string().optional().describe("Exchange name"),
    dataSource: z.string().optional().describe("Data source"),
    account: z.string().optional().describe("Account name"),
    dryRun: z.boolean().optional().describe("Preview changes without applying"),
  })
  .passthrough();

const DELETE_TRANSACTION_SCHEMA = z
  .object({
    id: z.number().int().describe("Transaction ID"),
    dryRun: z.boolean().optional().describe("Preview deletion without applying"),
    confirm: z.boolean().optional().describe("Confirm deletion"),
  })
  .passthrough();

const EXCHANGE_CURRENCY_SCHEMA = z
  .object({
    date: z.string().describe("Exchange date (YYYY-MM-DD)"),
    fromAsset: z.string().describe("Source currency/asset"),
    toAsset: z.string().describe("Target currency/asset"),
    quantity: z.number().describe("Amount to convert"),
    rate: z.number().describe("Exchange rate"),
  })
  .passthrough();

const SPLIT_SCHEMA = z
  .object({
    date: z.string().describe("Split date (YYYY-MM-DD)"),
    asset: z.string().describe("Asset symbol/ticker"),
    ratio: z.number().describe("Split ratio (e.g., 2 for 2:1 split)"),
    confirm: z.boolean().describe("Confirm the split operation"),
    exchange: z.string().optional().describe("Exchange name"),
    account: z.string().optional().describe("Account name"),
  })
  .passthrough();

const WRITE_TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  add_transaction: ADD_TRANSACTION_SCHEMA,
  edit_transaction: EDIT_TRANSACTION_SCHEMA,
  delete_transaction: DELETE_TRANSACTION_SCHEMA,
  exchange_currency: EXCHANGE_CURRENCY_SCHEMA,
  split: SPLIT_SCHEMA,
};

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
  const inputSchema =
    kind === "write"
      ? (WRITE_TOOL_SCHEMAS[toolName] ?? READ_ARGS_SCHEMA)
      : READ_ARGS_SCHEMA;

  server.registerTool(
    toolName,
    {
      description: `${kind === "read" ? "Read" : "Write"} tool for ${toolName}`,
      inputSchema,
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
    version: "1.0.0",
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
}

if (import.meta.main) {
  runPortfolioMcpServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exit(1);
  });
}
