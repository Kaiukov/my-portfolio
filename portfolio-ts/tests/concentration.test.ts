import { describe, expect, test, mock, jest } from "bun:test";

const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mock(),
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

function makeAllocRows() {
  return [
    { asset: "AAPL", asset_type: "stock_usd", allocation_pct: 40 },
    { asset: "GOOGL", asset_type: "stock_usd", allocation_pct: 30 },
    { asset: "MSFT", asset_type: "stock_usd", allocation_pct: 15 },
  ];
}

describe("getConcentration", () => {
  test("returns HHI and top holdings", async () => {
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.hhi).toBe(2725);
    expect(result.total_holdings).toBe(3);
    expect(result.top_holdings).toHaveLength(3);
    expect(result.top_holdings[0].asset).toBe("AAPL");
    expect(result.top_holdings[0].allocation_pct).toBe(40);
    expect(result.dust_filter!.threshold_pct).toBe(1);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date and top_n to SQL", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    await getConcentration("2026-01-15", 3);

    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("defaults top_n to 5", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue(makeAllocRows());

    const { getConcentration } = await import("../src/commands/concentration.js");
    await getConcentration("2026-01-15");

    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles null concentration row", async () => {
    mockQuery.mockResolvedValue([]);

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.hhi).toBe(0);
    expect(result.total_holdings).toBe(0);
    expect(result.top_holdings).toHaveLength(0);
  });

  test("handles null fields in allocation rows", async () => {
    mockQuery.mockResolvedValue([
      { asset: null, asset_type: null, allocation_pct: null },
    ]);

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration(undefined, undefined, true);

    expect(result.top_holdings).toHaveLength(1);
    expect(result.top_holdings[0].asset).toBe("");
    expect(result.top_holdings[0].allocation_pct).toBe(0);
  });

  test("filters dust holdings from top holdings by default", async () => {
    mockQuery.mockResolvedValue([
      { asset: "PAXG-USD", asset_type: "crypto", allocation_pct: 0.0066 },
      { asset: "BNB-USD", asset_type: "crypto", allocation_pct: -0.016 },
      { asset: "AAPL", asset_type: "stock_usd", allocation_pct: 40 },
      { asset: "MSFT", asset_type: "stock_usd", allocation_pct: 30 },
    ]);

    const { getConcentration } = await import("../src/commands/concentration.js");
    const result = await getConcentration();

    expect(result.top_holdings.map((row) => row.asset)).toEqual(["AAPL", "MSFT"]);
    expect(result.dust_filter!.hidden_count).toBe(2);
    expect(result.dust_filter!.hidden_assets).toEqual(["PAXG-USD", "BNB-USD"]);
    expect(result.total_holdings).toBe(2);
    expect(result.hhi).toBe(2500);
  });
});

describe("getConcentration — CLI integration", () => {
  test("dispatches concentration command and returns success envelope", async () => {
    mockQuery.mockResolvedValue(makeAllocRows());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "concentration"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("concentration");
    expect(output.data.hhi).toBe(2725);
    expect(output.data.total_holdings).toBe(3);
    expect(output.data.top_holdings).toHaveLength(3);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches concentration with --as-of-date and --top-n", async () => {
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
