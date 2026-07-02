import { describe, expect, test } from "bun:test";
import { APP_VERSION } from "../src/version.js";

describe("portfolio MCP server", () => {
  test("exports the full read/write tool surface for tunnel-client", async () => {
    const mod = await import("../src/mcp/server.js");

    expect(mod.MCP_READ_TOOLS).toContain("asset_analysis");
    expect(mod.MCP_READ_TOOLS).toContain("status");
    expect(mod.MCP_WRITE_TOOLS).toContain("split");
    expect(mod.MCP_WRITE_TOOLS).toContain("exchange_currency");
    expect(mod.MCP_READ_TOOLS.length).toBe(23);
    expect(mod.MCP_WRITE_TOOLS.length).toBe(5);
  });

  test("tools/list returns exactly 28 tools (23 read + 5 write)", async () => {
    const mod = await import("../src/mcp/server.js");

    const total = mod.MCP_READ_TOOLS.length + mod.MCP_WRITE_TOOLS.length;
    expect(total).toBe(28);

    // Verify all expected read tools are present
    const expectedRead = [
      "status", "summary", "cash", "cash_drag", "currency_exposure",
      "income", "realized_gains", "allocation", "rebalance", "concentration",
      "diversification", "decomposition", "performance", "mwr", "transactions",
      "report", "health", "verify_prices", "widget", "asset_metadata",
      "projection", "withdrawal", "asset_analysis",
    ];
    for (const tool of expectedRead) {
      expect(mod.MCP_READ_TOOLS).toContain(tool as typeof mod.MCP_READ_TOOLS[number]);
    }

    // Verify all expected write tools are present
    const expectedWrite = [
      "add_transaction", "edit_transaction", "delete_transaction",
      "exchange_currency", "split",
    ] as const;
    for (const tool of expectedWrite) {
      expect(mod.MCP_WRITE_TOOLS).toContain(tool);
    }
  });

  test("createPortfolioMcpServer returns an McpServer instance", async () => {
    const mod = await import("../src/mcp/server.js");
    const server = mod.createPortfolioMcpServer();
    expect(server).toBeDefined();
    expect(typeof server.registerTool).toBe("function");
  });

  test("server reports APP_VERSION as version", async () => {
    const mod = await import("../src/mcp/server.js");
    const server = mod.createPortfolioMcpServer();
    // McpServer.server is the low-level Server; its _serverInfo holds {name, version}.
    const serverInfo = (
      server as unknown as { server: { _serverInfo?: { name: string; version: string } } }
    ).server._serverInfo;
    expect(serverInfo).toBeDefined();
    expect(serverInfo?.version).toBe(APP_VERSION);
  });
});
