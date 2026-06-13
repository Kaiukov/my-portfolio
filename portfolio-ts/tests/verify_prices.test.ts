import { describe, expect, test, mock } from "bun:test";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

describe("verify_prices required_tickers dedup", () => {
  test("deduplicates tickers returned under multiple categories", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 42,
      min_date: "2025-01-01",
      max_date: "2025-12-31",
    });
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }, { ticker: "EUR" }]);
    mockQuery.mockResolvedValueOnce([
      { ticker: "AAPL", ticker_category: "asset" },
      { ticker: "AAPL", ticker_category: "crypto" },
      { ticker: "EUR", ticker_category: "fx" },
      { ticker: "EUR", ticker_category: "asset" },
    ]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices();

    expect(result.required_tickers).toEqual(["AAPL", "EUR"]);
    expect(new Set(result.required_tickers).size).toBe(result.required_tickers.length);
  });

  test("no duplicates when SQL returns unique tickers only", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 10,
      min_date: "2025-06-01",
      max_date: "2025-06-30",
    });
    mockQuery.mockResolvedValueOnce([
      { ticker: "AAPL" },
      { ticker: "EUR" },
      { ticker: "GBPUSD=X" },
    ]);
    mockQuery.mockResolvedValueOnce([
      { ticker: "AAPL", ticker_category: "asset" },
      { ticker: "EUR", ticker_category: "fx" },
      { ticker: "GBPUSD=X", ticker_category: "asset" },
    ]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices();

    expect(result.required_tickers).toEqual(["AAPL", "EUR", "GBPUSD=X"]);
    expect(new Set(result.required_tickers).size).toBe(result.required_tickers.length);
  });
});
