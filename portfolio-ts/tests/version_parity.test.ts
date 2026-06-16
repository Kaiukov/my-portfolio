import { describe, expect, test, mock, jest } from "bun:test";

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

describe("version parity", () => {
  test("--version flag prints APP_VERSION", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["node", "portfolio", "--version"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toBe("0.8.0");

    logSpy.mockRestore();
  });

  test("-v flag prints APP_VERSION", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["node", "portfolio", "-v"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toBe("0.8.0");

    logSpy.mockRestore();
  });

  test("success envelope meta.version matches APP_VERSION", async () => {
    const { success } = await import("../src/response.js");
    const { APP_VERSION } = await import("../src/version.js");

    const env = success("test", { x: 1 });
    expect(env.meta.version).toBe(APP_VERSION);
  });

  test("error envelope meta.version matches APP_VERSION", async () => {
    const { error } = await import("../src/response.js");
    const { APP_VERSION } = await import("../src/version.js");

    const env = error("test", "DB_ERROR", "boom");
    expect(env.meta.version).toBe(APP_VERSION);
  });

  test("MCP server version matches APP_VERSION", async () => {
    const mod = await import("../src/mcp/server.js");
    const { APP_VERSION } = await import("../src/version.js");

    const server = mod.createPortfolioMcpServer();
    const serverInfo = (
      server as unknown as { server: { _serverInfo?: { name: string; version: string } } }
    ).server._serverInfo;
    expect(serverInfo?.version).toBe(APP_VERSION);
  });

  test("all version surfaces are consistent", async () => {
    const { APP_VERSION } = await import("../src/version.js");
    const { success, error } = await import("../src/response.js");
    const mod = await import("../src/mcp/server.js");

    const successEnv = success("test", { x: 1 });
    const errorEnv = error("test", "DB_ERROR", "boom");
    const server = mod.createPortfolioMcpServer();
    const serverInfo = (
      server as unknown as { server: { _serverInfo?: { name: string; version: string } } }
    ).server._serverInfo;

    expect(successEnv.meta.version).toBe(APP_VERSION);
    expect(errorEnv.meta.version).toBe(APP_VERSION);
    expect(serverInfo?.version).toBe(APP_VERSION);
  });
});