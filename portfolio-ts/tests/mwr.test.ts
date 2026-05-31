import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

describe("getMwr", () => {
  test("returns MWR row from portfolio_mwr_sql()", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: 0.1050 });

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr();

    expect(result.mwr_pct).toBe(10.5);
    expect(result.as_of_date).toBeDefined();
    expect(result.note).toContain("XIRR");
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue({ mwr: 0.05 });

    const { getMwr } = await import("../src/commands/mwr.js");
    await getMwr("2026-01-15");

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles null/insufficient data gracefully", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: null });

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr();

    expect(result.mwr_pct).toBe(0);
    expect(result.note).toContain("insufficient");
  });

  test("XIRR 10% fixture: -1000 on 2025-01-01 +1100 on 2026-01-01 via mocked DB", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: 0.10 });

    const { getMwr } = await import("../src/commands/mwr.js");
    const result = await getMwr("2026-01-01");

    expect(result.mwr_pct).toBe(10.0);
  });
});

describe("getMwr — CLI integration", () => {
  test("dispatches mwr command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: 0.085 });
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "mwr"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("mwr");
    expect(output.data.mwr_pct).toBe(8.5);
    expect(output.data.note).toContain("XIRR");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches mwr with --as-of-date", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: 0.12 });
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "mwr", "--as-of-date", "2026-01-01"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("mwr");
    expect(output.data.mwr_pct).toBe(12.0);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("mwr appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("mwr");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
