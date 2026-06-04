import { describe, expect, test, mock, jest } from "bun:test";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
  upsertAssetMetadata: mock(async () => {}),
  getAssetMetadata: mock(async () => []),
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

describe("getStaticAssetProfile classification", () => {
  test("USD -> Cash", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("USD");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("Cash");
    expect(r!.region).toBe("US");
  });

  test("EUR -> FX", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("EUR");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("FX");
    expect(r!.region).toBe("EUR");
  });

  test("EURUSD=X -> FX", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("EURUSD=X");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("FX");
    expect(r!.region).toBe("EUR");
  });

  test("USDT -> Crypto (stablecoin)", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("USDT");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("Crypto");
  });

  test("BTC-USD -> Crypto", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("BTC-USD");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("Crypto");
  });

  test("CASH EUR -> Cash", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("CASH EUR");
    expect(r).not.toBeNull();
    expect(r!.sector).toBe("Cash");
  });

  test("AAPL -> null (yahoo-fetchable)", async () => {
    const { getStaticAssetProfile } = await import("../src/providers/yahoo.js");
    const r = getStaticAssetProfile("AAPL");
    expect(r).toBeNull();
  });
});

describe("isYahooFetchable", () => {
  test("AAPL is fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("AAPL")).toBe(true);
  });

  test("SPY is fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("SPY")).toBe(true);
  });

  test("USD is not fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("USD")).toBe(false);
  });

  test("EUR is not fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("EUR")).toBe(false);
  });

  test("USDT is not fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("USDT")).toBe(false);
  });

  test("CASH bucket is not fetchable", async () => {
    const { isYahooFetchable } = await import("../src/providers/yahoo.js");
    expect(isYahooFetchable("CASH USD")).toBe(false);
  });
});

describe("getAssetMetadataRecords - static assets (no network)", () => {
  test("USD returns static record, source:static", async () => {
    mockQuery.mockReset();
    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const result = await getAssetMetadataRecords({ asset: "USD" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].asset).toBe("USD");
    expect(result.assets[0].source).toBe("static");
    expect(result.assets[0].asset_kind).toBe("cash");
  });

  test("EUR returns static record, source:static", async () => {
    mockQuery.mockReset();
    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const result = await getAssetMetadataRecords({ asset: "EUR" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].source).toBe("static");
    expect(result.assets[0].asset_kind).toBe("fx");
  });
});

describe("getAssetMetadataRecords - Yahoo fetchable assets", () => {
  const mockMetaFn = mock(async (_ticker: string) => ({
    yahoo_quote_type: "EQUITY",
    yahoo_type_disp: "",
    yahoo_short_name: "Apple Inc.",
    yahoo_long_name: "",
    currency: "USD",
    exchange: "NMS",
  }));

  test("AAPL stock: sector and industry from assetProfile", async () => {
    const mockFetch = mock(async (ticker: string) => ({
      sector: "Technology",
      industry: "Consumer Electronics",
      region: "United States",
    }));

    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const testDeps = await import("../src/db.js");
    (testDeps.getAssetMetadata as any).mockResolvedValue([]);
    (testDeps.upsertAssetMetadata as any).mockResolvedValue(undefined);

    const result = await getAssetMetadataRecords({ asset: "AAPL", refresh: true }, mockFetch as any, mockMetaFn as any);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].sector).toBe("Technology");
    expect(result.assets[0].industry).toBe("Consumer Electronics");
    expect(result.assets[0].region).toBe("United States");
    expect(result.assets[0].source).toBe("yahoo");
    expect(result.fetched).toContain("AAPL");

    // Verify upsertAssetMetadata was called
    expect(testDeps.upsertAssetMetadata).toHaveBeenCalled();
  });

  test("SPY ETF: sectorWeights from topHoldings.sectorWeightings", async () => {
    const mockFetch = mock(async (_ticker: string) => ({
      sector: undefined,
      sectorWeights: [
        { sector: "Technology", weight: 28.5 },
        { sector: "Financial Services", weight: 14.2 },
        { sector: "Healthcare", weight: 12.8 },
      ],
    }));

    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const testDeps = await import("../src/db.js");
    (testDeps.getAssetMetadata as any).mockResolvedValue([]);
    (testDeps.upsertAssetMetadata as any).mockResolvedValue(undefined);

    const result = await getAssetMetadataRecords({ asset: "SPY", refresh: true }, mockFetch as any, mockMetaFn as any);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].sector_weights).toBeDefined();
    expect(result.assets[0].sector_weights!.length).toBe(3);
    expect(result.assets[0].sector_weights![0].sector).toBe("Technology");
    expect(result.assets[0].sector_weights![0].weight).toBe(28.5);
    expect(result.assets[0].source).toBe("yahoo");
  });

  test("fetch failure surface as failed record + source:none", async () => {
    const mockFetch = mock(async (_ticker: string) => {
      throw new Error("Yahoo API error");
    });

    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const testDeps = await import("../src/db.js");
    (testDeps.getAssetMetadata as any).mockResolvedValue([]);
    (testDeps.upsertAssetMetadata as any).mockResolvedValue(undefined);

    const result = await getAssetMetadataRecords({ asset: "AAPL", refresh: true }, mockFetch as any, mockMetaFn as any);
    expect(result.failed).toBeDefined();
    expect(result.failed!.length).toBe(1);
    expect(result.failed![0].ticker).toBe("AAPL");
    expect(result.assets[0].source).toBe("none");
  });

  test("cached read (no refresh) returns cached data", async () => {
    const testDeps = await import("../src/db.js");
    (testDeps.getAssetMetadata as any).mockResolvedValue([{
      asset: "AAPL",
      asset_kind: "stock",
      sector: "Technology",
      industry: "Consumer Electronics",
      region: "United States",
      sector_weights: null,
      source: "yahoo",
      fetched_at: "2026-06-01T00:00:00Z",
    }]);

    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const result = await getAssetMetadataRecords({ asset: "AAPL" });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].sector).toBe("Technology");
    expect(result.assets[0].source).toBe("yahoo");
  });
});

describe("fetchAssetProfile - sectorWeightings normalization via mock fetchFn", () => {
  test("normalizes raw Yahoo sectorWeightings to {sector, weight}[]", async () => {
    const mockFn = mock(async (ticker: string) => ({
      sector: undefined,
      sectorWeights: [
        { sector: "Technology", weight: 25.5 },
        { sector: "Healthcare", weight: 12.3 },
        { sector: "Financial Services", weight: 15.7 },
      ],
    }));

    const { getAssetMetadataRecords } = await import("../src/commands/asset_metadata.js");
    const testDeps = await import("../src/db.js");
    (testDeps.getAssetMetadata as any).mockResolvedValue([]);
    (testDeps.upsertAssetMetadata as any).mockResolvedValue(undefined);

    const result = await getAssetMetadataRecords({ asset: "SPY", refresh: true }, mockFn as any);
    expect(result.assets[0].sector_weights).toBeDefined();
    expect(result.assets[0].sector_weights!.length).toBe(3);
    const tech = result.assets[0].sector_weights!.find((sw) => sw.sector === "Technology");
    expect(tech).toBeDefined();
    expect(tech!.weight).toBe(25.5);
  });
});

describe("CLI JSON snapshot: asset-metadata", () => {
  test("asset-metadata --asset USD emits valid JSON envelope", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "asset-metadata", "--asset", "USD"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("asset-metadata");
    expect(output.data.assets).toBeInstanceOf(Array);
    expect(output.data.assets.length).toBeGreaterThan(0);
    expect(typeof output.meta.generated_at).toBe("string");
    expect(output.meta.count).toBe(1);

    logSpy.mockRestore();
  });

  test("asset_metadata --asset EUR emits valid JSON envelope (alias)", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "asset_metadata", "--asset", "EUR"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("asset-metadata");
    expect(output.data.assets[0].asset_kind).toBe("fx");
    expect(output.data.assets[0].source).toBe("static");

    logSpy.mockRestore();
  });
});
