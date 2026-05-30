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

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    asset: "AAPL",
    asset_type: "stock_usd",
    net_quantity: 10,
    value_usd: 1500,
    allocation_pct: 60,
    ...overrides,
  };
}

describe("getAllocation", () => {
  test("returns allocation rows from portfolio_allocation_sql()", async () => {
    mockQuery.mockResolvedValue([
      makeRow(),
      makeRow({ asset: "GOOGL", value_usd: 1000, allocation_pct: 40 }),
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(2);
    expect(result.portfolio_value).toBe(2500);
    expect(result.rows[0].asset).toBe("AAPL");
    expect(result.rows[0].asset_type).toBe("stock_usd");
    expect(result.rows[0].net_quantity).toBe(10);
    expect(result.rows[0].value_usd).toBe(1500);
    expect(result.rows[0].allocation_pct).toBe(60);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles empty result", async () => {
    mockQuery.mockResolvedValue([]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(0);
    expect(result.portfolio_value).toBe(0);
    expect(result.as_of_date).toBeDefined();
  });

  test("handles null fields gracefully", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ value_usd: null, allocation_pct: null }),
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].value_usd).toBe(0);
    expect(result.rows[0].allocation_pct).toBe(0);
  });

  test("response contains all required fields", async () => {
    mockQuery.mockResolvedValue([makeRow()]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result).toHaveProperty("as_of_date");
    expect(result).toHaveProperty("portfolio_value");
    expect(result).toHaveProperty("rows");
    for (const row of result.rows) {
      expect(row).toHaveProperty("asset");
      expect(row).toHaveProperty("asset_type");
      expect(row).toHaveProperty("net_quantity");
      expect(row).toHaveProperty("value_usd");
      expect(row).toHaveProperty("allocation_pct");
    }
  });
});

describe("getAllocation — CLI integration", () => {
  test("dispatches allocation command and returns success envelope", async () => {
    mockQuery.mockResolvedValue([makeRow()]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "allocation"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("allocation");
    expect(output.data.as_of_date).toBeDefined();
    expect(output.data.portfolio_value).toBe(1500);
    expect(output.data.rows).toHaveLength(1);
    expect(output.meta.count).toBe(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches allocation with --as-of-date", async () => {
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "allocation", "--as-of-date", "2026-01-15"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("allocation");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("allocation appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("allocation");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
