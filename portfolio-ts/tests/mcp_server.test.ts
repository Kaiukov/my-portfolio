import { describe, expect, test } from "bun:test";

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
});
