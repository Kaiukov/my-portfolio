import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

function makeConcRow(overrides: Record<string, unknown> = {}) {
  return {
    hhi: 2500,
    total_holdings: 5,
    as_of_date: "2026-01-15",
    ...overrides,
  };
}

function makeAllocRows() {
  return [
    { asset: "AAPL", asset_type: "stock_usd", allocation_pct: 40 },
    { asset: "GOOGL", asset_type: "stock_usd", allocation_pct: 30 },
    { asset: "MSFT", asset_type: "stock_usd", allocation_pct: 15 },
  ];
}

describe("getConcentration", () => {
  test("returns HHI and top holdings", async () => {
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.hhi).toBe(2500);
    expect(result.total_holdings).toBe(5);
    expect(result.top_holdings).toHaveLength(3);
    expect(result.top_holdings[0].asset).toBe("AAPL");
    expect(result.top_holdings[0].allocation_pct).toBe(40);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date and top_n to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    await getConcentration("2026-01-15", 3);

    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-01-15"]);
    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15", 3]);
  });

  test("defaults top_n to 5", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    await getConcentration("2026-01-15");

    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15", 5]);
  });

  test("handles null concentration row", async () => {
    mockQuerySingle.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.hhi).toBe(0);
    expect(result.total_holdings).toBe(0);
    expect(result.top_holdings).toHaveLength(0);
  });

  test("handles null fields in allocation rows", async () => {
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue([
      { asset: null, asset_type: null, allocation_pct: null },
    ]);

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.top_holdings).toHaveLength(1);
    expect(result.top_holdings[0].asset).toBe("");
    expect(result.top_holdings[0].allocation_pct).toBe(0);
  });
});

describe("getConcentration — CLI integration", () => {
  test("dispatches concentration command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue(makeAllocRows());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "concentration"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("concentration");
    expect(output.data.hhi).toBe(2500);
    expect(output.data.total_holdings).toBe(5);
    expect(output.data.top_holdings).toHaveLength(3);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches concentration with --as-of-date and --top-n", async () => {
    mockQuerySingle.mockResolvedValue(makeConcRow());
    mockQuery.mockResolvedValue(makeAllocRows());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "concentration", "--as-of-date", "2026-01-15", "--top-n", "10"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("concentration appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("concentration");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
