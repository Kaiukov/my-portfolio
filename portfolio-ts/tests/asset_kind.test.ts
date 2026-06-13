import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

describe("normalizeAssetKind", () => {
  test("EQUITY -> stock", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("EQUITY")).toBe("stock");
  });

  test("ETF -> etf", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("ETF")).toBe("etf");
  });

  test("CRYPTOCURRENCY -> crypto", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("CRYPTOCURRENCY")).toBe("crypto");
  });

  test("MUTUALFUND -> fund", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("MUTUALFUND")).toBe("fund");
  });

  test("CURRENCY -> fx", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("CURRENCY")).toBe("fx");
  });

  test("null -> unknown", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind(null)).toBe("unknown");
  });

  test("empty string -> unknown", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("")).toBe("unknown");
  });

  test("garbage -> unknown", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("GARBAGE")).toBe("unknown");
  });

  test("lowercase input normalized", async () => {
    const { normalizeAssetKind } = await import("../src/asset_kind.js");
    expect(normalizeAssetKind("equity")).toBe("stock");
  });

  test("ASSET_KIND_NORMALIZED contains expected values", async () => {
    const { ASSET_KIND_NORMALIZED } = await import("../src/asset_kind.js");
    expect(ASSET_KIND_NORMALIZED.has("stock")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("etf")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("crypto")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("fund")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("fx")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("cash")).toBe(true);
    expect(ASSET_KIND_NORMALIZED.has("unknown")).toBe(true);
  });
});

describe("fetchAssetMetadata", () => {
  test("USD -> cash metadata (no network)", async () => {
    const { fetchAssetMetadata } = await import("../src/asset_kind.js");
    const meta = await fetchAssetMetadata("USD");
    expect(meta).not.toBeNull();
    expect(meta!.yahoo_quote_type).toBe("CURRENCY");
    expect(meta!.currency).toBe("USD");
  });

  test("EUR -> fx metadata (no network)", async () => {
    const { fetchAssetMetadata } = await import("../src/asset_kind.js");
    const meta = await fetchAssetMetadata("EUR");
    expect(meta).not.toBeNull();
    expect(meta!.yahoo_quote_type).toBe("CURRENCY");
    expect(meta!.currency).toBe("EUR");
  });

  test("EURUSD=X -> fx metadata (no network)", async () => {
    const { fetchAssetMetadata } = await import("../src/asset_kind.js");
    const meta = await fetchAssetMetadata("EURUSD=X");
    expect(meta).not.toBeNull();
    expect(meta!.yahoo_quote_type).toBe("CURRENCY");
    expect(meta!.currency).toBe("EUR");
  });

  test("IWM -> fetches real ETF metadata from Yahoo (regression #191)", async () => {
    const { fetchAssetMetadata } = await import("../src/asset_kind.js");
    const meta = await fetchAssetMetadata("IWM", async () => ({
      quoteType: "ETF",
      typeDisp: "ETF",
      shortName: "iShares Russell 2000 ETF",
      longName: "iShares Russell 2000 ETF",
      currency: "USD",
      exchange: "NMS",
    }));
    expect(meta).not.toBeNull();
    expect(meta!.yahoo_quote_type).toBe("ETF");
    expect(meta!.currency).toBe("USD");
    expect(typeof meta!.yahoo_short_name).toBe("string");
    expect(meta!.yahoo_short_name).not.toBe("");
  });
});

describe("getAllocation with asset_kind", () => {
  function makeAllocRow(overrides: Record<string, unknown> = {}) {
    return {
      asset: "AAPL",
      asset_type: "stock_usd",
      asset_kind: "stock",
      net_quantity: 10,
      value_usd: 1500,
      allocation_pct: 60,
      ...overrides,
    };
  }

  test("returns asset_kind in allocation rows", async () => {
    mockQuery.mockResolvedValue([
      makeAllocRow(),
      makeAllocRow({ asset: "BTC-USD", asset_kind: "crypto", value_usd: 1000, allocation_pct: 40 }),
    ]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].asset_kind).toBe("stock");
    expect(result.rows[1].asset_kind).toBe("crypto");
  });

  test("asset_kind field is present in each row", async () => {
    mockQuery.mockResolvedValue([makeAllocRow()]);

    const { getAllocation } = await import("../src/commands/allocation.js");
    const result = await getAllocation();

    for (const row of result.rows) {
      expect(row).toHaveProperty("asset_kind");
      expect(typeof row.asset_kind).toBe("string");
    }
  });

  test("asset_kind survives through response envelope", async () => {
    mockQuery.mockResolvedValue([makeAllocRow()]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "allocation"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.data.rows[0].asset_kind).toBe("stock");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("repairPrices with metadata injection", () => {
  test("calls metadataFetchFn after price upsert", async () => {
    const mockMetadataFn = mock(async (_ticker: string) => ({
      yahoo_quote_type: "EQUITY",
      yahoo_type_disp: "Equity",
      yahoo_short_name: "Apple Inc.",
      yahoo_long_name: "Apple Inc. Common Stock",
      currency: "USD",
      exchange: "NMS",
    }));

    mockQuery.mockReset();
    mockQuery.mockImplementation(async (_sql: string, _params?: unknown[]) => []);
    mockQuerySingle.mockImplementation(async (_sql: string, _params?: unknown[]) => ({
      start_date: "2024-01-01",
      end_date: "2026-01-01",
    }));

    const { repairPrices } = await import("../src/commands/repair_prices.js");

    const mockFetchFn = mock(async (_ticker: string, _start: string, _end: string) => [
      { ticker: "AAPL", date: "2026-01-01", price: 150 },
    ]);

    await repairPrices(
      { tickers: ["AAPL"] },
      mockFetchFn as any,
      mockMetadataFn as any,
    );

    expect(mockMetadataFn).toHaveBeenCalledWith("AAPL");
  });

  test("metadata fetch failure does not abort price repair", async () => {
    const mockFailingFn = mock(async (_ticker: string) => {
      throw new Error("network error");
    });

    mockQuery.mockReset();
    mockQuery.mockImplementation(async (_sql: string, _params?: unknown[]) => []);
    mockQuerySingle.mockImplementation(async (_sql: string, _params?: unknown[]) => ({
      start_date: "2024-01-01",
      end_date: "2026-01-01",
    }));

    const { repairPrices } = await import("../src/commands/repair_prices.js");

    const mockFetchFn = mock(async (_ticker: string, _start: string, _end: string) => [
      { ticker: "AAPL", date: "2026-01-01", price: 150 },
    ]);

    const result = await repairPrices(
      { tickers: ["AAPL"] },
      mockFetchFn as any,
      mockFailingFn as any,
    );

    expect(result.rows_loaded).toBe(1);
  });
});
