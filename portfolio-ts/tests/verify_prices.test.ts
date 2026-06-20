import { describe, expect, test, mock } from "bun:test";

const mockQuery = mock();
const mockQuerySingle = mock();

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

describe("verify_prices coverage output", () => {
  test("CLI JSON snapshot keeps only real market-open gaps from SQL", async () => {
    mockQuerySingle.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)::int AS total_rows")) {
        return Promise.resolve({
          total_rows: 8,
          min_date: "2026-02-05",
          max_date: "2026-06-19",
        });
      }
      if (sql.includes("needs_recalc() AS needs_recalc")) {
        return Promise.resolve({ needs_recalc: false });
      }
      return Promise.resolve(null);
    });

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === "SELECT DISTINCT ticker FROM prices ORDER BY ticker") {
        return Promise.resolve([
          { ticker: "EURUSD=X" },
          { ticker: "QQQ" },
          { ticker: "VGEU.DE" },
        ]);
      }
      if (sql === "SELECT ticker, ticker_category FROM discover_required_tickers_sql() ORDER BY ticker") {
        return Promise.resolve([
          { ticker: "EURUSD=X", ticker_category: "fx" },
          { ticker: "QQQ", ticker_category: "asset" },
          { ticker: "VGEU.DE", ticker_category: "asset" },
        ]);
      }
      if (sql.includes("FROM get_required_price_checkpoints_sql($1)")) {
        return Promise.resolve([
          { ticker: "EURUSD=X", checkpoint_date: "2026-02-05" },
          { ticker: "EURUSD=X", checkpoint_date: "2026-02-06" },
          { ticker: "QQQ", checkpoint_date: "2026-06-17" },
          { ticker: "QQQ", checkpoint_date: "2026-06-18" },
          { ticker: "VGEU.DE", checkpoint_date: "2026-06-17" },
          { ticker: "VGEU.DE", checkpoint_date: "2026-06-19" },
        ]);
      }
      if (sql.includes("FROM (VALUES")) {
        const ticker = params?.[0];
        if (ticker === "QQQ") return Promise.resolve([{ d: "2026-06-17" }]);
        if (ticker === "EURUSD=X") return Promise.resolve([{ d: "2026-02-05" }]);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices();

    expect(result).toEqual({
      total_rows: 8,
      unique_tickers: 3,
      date_range: {
        start: "2026-02-05",
        end: "2026-06-19",
      },
      required_tickers: ["EURUSD=X", "QQQ", "VGEU.DE"],
      coverage_issues: [
        { ticker: "EURUSD=X", issues: ["missing_dates: 2026-02-05"] },
        { ticker: "QQQ", issues: ["missing_dates: 2026-06-17"] },
      ],
      stale_tickers: [],
      needs_recalc: false,
    });
  });
});
