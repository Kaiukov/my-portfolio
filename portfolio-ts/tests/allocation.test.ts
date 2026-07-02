import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();
const mockGetAssetMetadata: any = mock(async () => []);

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mockGetAssetMetadata,
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
    mockGetAssetMetadata.mockResolvedValue([]);

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

  test("allocated ETF rows include sector_weights from asset metadata", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ asset: "VTI", asset_type: "etf", asset_kind: "equity", value_usd: 50000, allocation_pct: 50 }),
    ]);
    mockGetAssetMetadata.mockResolvedValue([
      {
        asset: "VTI",
        asset_kind: "etf",
        sector: null,
        industry: null,
        region: "United States",
        sector_weights: [
          { sector: "Technology", weight: 30 },
          { sector: "Financial Services", weight: 15 },
        ],
        source: "yahoo",
        fetched_at: "2026-06-01T00:00:00Z",
        is_stale: false,
      },
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].asset).toBe("VTI");
    expect(result.rows[0].sector).toBeUndefined();
    expect(result.rows[0].sector_weights).toBeDefined();
    expect(result.rows[0].sector_weights!.length).toBe(2);
    expect(result.rows[0].sector_weights![0].sector).toBe("Technology");
    expect(result.rows[0].sector_weights![0].weight).toBe(30);
  });

  test("sector from metadata is reflected on direct holdings", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ asset: "AAPL", asset_type: "stock", asset_kind: "equity", value_usd: 9750, allocation_pct: 24.375 }),
    ]);
    mockGetAssetMetadata.mockResolvedValue([
      {
        asset: "AAPL",
        asset_kind: "stock",
        sector: "Technology",
        industry: "Consumer Electronics",
        region: "United States",
        sector_weights: null,
        source: "yahoo",
        fetched_at: "2026-06-01T00:00:00Z",
        is_stale: false,
      },
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sector).toBe("Technology");
    expect(result.rows[0].sector_weights).toBeUndefined();
  });

  test("handles JSON-string sector_weights from DB", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ asset: "SPY", asset_type: "etf", asset_kind: "equity", value_usd: 30000, allocation_pct: 60 }),
    ]);
    mockGetAssetMetadata.mockResolvedValue([
      {
        asset: "SPY",
        asset_kind: "etf",
        sector: null,
        industry: null,
        region: null,
        sector_weights: JSON.stringify([
          { sector: "Technology", weight: 28 },
          { sector: "Healthcare", weight: 13 },
        ]),
        source: "yahoo",
        fetched_at: "2026-06-01T00:00:00Z",
        is_stale: false,
      },
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sector).toBeUndefined();
    expect(result.rows[0].sector_weights).toBeDefined();
    expect(result.rows[0].sector_weights!.length).toBe(2);
  });

  test("no metadata returns allocation rows without sector info", async () => {
    mockQuery.mockResolvedValue([makeRow()]);
    mockGetAssetMetadata.mockResolvedValue([]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sector).toBeUndefined();
    expect(result.rows[0].sector_weights).toBeUndefined();
  });

  test("blank metadata rows fall back to read-only sector enrichment for known holdings", async () => {
    const blankRow = (asset: string) => ({
      asset,
      asset_kind: null,
      sector: null,
      industry: null,
      region: null,
      sector_weights: null,
      source: null,
      fetched_at: null,
      is_stale: false,
    });
    mockQuery.mockResolvedValue([
      makeRow({ asset: "SCHD", asset_type: "etf", asset_kind: "etf", value_usd: 2672.38, allocation_pct: 14.04 }),
      makeRow({ asset: "VGIT", asset_type: "etf", asset_kind: "fixed_income", value_usd: 2058.0, allocation_pct: 10.81 }),
      makeRow({ asset: "EURUSD=X", asset_type: "cash_fx", asset_kind: "fx", value_usd: 2571.15, allocation_pct: 13.51 }),
    ]);
    mockGetAssetMetadata.mockResolvedValue([
      blankRow("SCHD"),
      blankRow("VGIT"),
      blankRow("EURUSD=X"),
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation("2026-06-05");

    expect(result.rows[0].sector).toBeUndefined();
    expect(result.rows[0].sector_weights).toBeDefined();
    expect(result.rows[0].sector_weights![0]).toEqual({
      sector: "Consumer Defensive",
      weight: 19.39,
    });
    expect(result.rows[1].sector).toBe("Bonds");
    expect(result.rows[1].sector_weights).toBeUndefined();
    expect(result.rows[2].sector).toBe("FX");
  });

  test("price lookup is capped at as_of_date for historical snapshots", async () => {
    // First call: allocation rows
    // Second call: price enrichment
    let queryCallCount = 0;
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return [makeRow({ asset: "AAPL", net_quantity: 10, value_usd: 1500 })];
      }
      // Price query — verify it receives the date param
      expect(params).toHaveLength(2);
      expect(params[1]).toBe("2026-01-15");
      expect(sql).toContain("ARRAY[$1]::varchar[]");
      return [{ ticker: "AAPL", last_price: 155, prev_price: 150 }];
    });

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(result.rows[0].last_price).toBe(155);
    // day_gain_usd = 1500 - 1500 / (155/150) = 1500 - 1451.61 = 48.39
    expect(result.rows[0].day_gain_usd).toBeCloseTo(48.39, 1);
  });

  test("day_gain_usd is USD-correct via price-ratio × value_usd (works for foreign stocks)", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(async (_sql: string, _params: unknown[]) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return [makeRow({ asset: "VGEU.DE", asset_type: "stock_eur", net_quantity: 50, value_usd: 5000 })];
      }
      // EUR-denominated stock: prices in EUR, but value_usd already FX-converted
      return [{ ticker: "VGEU.DE", last_price: 110, prev_price: 100 }];
    });

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    // day_gain_usd = 5000 - 5000 / 1.10 = 5000 - 4545.45 = 454.55
    // The old (buggy) formula would give: (110-100)*50 = 500 EUR (not USD)
    expect(result.rows[0].day_gain_usd).toBeCloseTo(454.55, 1);
  });

  test("null prev_price degrades gracefully — day_gain_usd is undefined", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(async (_sql: string, _params: unknown[]) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return [makeRow({ asset: "NEWCO", net_quantity: 100, value_usd: 2500 })];
      }
      return [{ ticker: "NEWCO", last_price: 25, prev_price: null }];
    });

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows[0].last_price).toBe(25);
    expect(result.rows[0].day_gain_usd).toBeUndefined();
  });

  test("zero prev_price degrades gracefully — day_gain_usd is undefined", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(async (_sql: string, _params: unknown[]) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return [makeRow({ asset: "ZEROCO", net_quantity: 10, value_usd: 100 })];
      }
      return [{ ticker: "ZEROCO", last_price: 10, prev_price: 0 }];
    });

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows[0].last_price).toBe(10);
    expect(result.rows[0].day_gain_usd).toBeUndefined();
  });

  test("missing price data — last_price and day_gain_usd remain undefined", async () => {
    let queryCallCount = 0;
    mockQuery.mockImplementation(async (_sql: string, _params: unknown[]) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        return [makeRow({ asset: "NOPRICE", net_quantity: 5, value_usd: 500 })];
      }
      return []; // no price data
    });

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows[0].last_price).toBeUndefined();
    expect(result.rows[0].day_gain_usd).toBeUndefined();
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
