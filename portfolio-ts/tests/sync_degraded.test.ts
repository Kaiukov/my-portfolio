import { describe, expect, test, mock } from "bun:test";
import type { PriceRow } from "../src/providers/yahoo.js";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

const noMetadata = async () => null;

describe("repairPrices status / unresolved (issue #144)", () => {
  test("required ticker Yahoo fetch FAILS -> status 'degraded', unresolved.missing contains that ticker", async () => {
    mockQuery.mockReset();
    mockQuerySingle.mockReset();

    // getDateRange
    mockQuerySingle.mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    // getRequiredTickers -> AAPL
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    // catch branch: recordRepair(failed) for AAPL
    mockQuery.mockResolvedValueOnce([]);
    // totalRows === 0 -> markRefreshSuccess NOT called
    // verifyPrices:
    mockQuerySingle.mockResolvedValueOnce({ total_rows: 0, min_date: null, max_date: null });
    // distinct tickers from prices (empty)
    mockQuery.mockResolvedValueOnce([]);
    // required tickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL", ticker_category: "asset" }]);
    // checkpoints
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL", checkpoint_date: "2026-01-01" }]);
    // missing dates for AAPL
    mockQuery.mockResolvedValueOnce([{ d: "2026-01-01" }]);
    // needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const failingFetch = mock(async (): Promise<PriceRow[]> => {
      throw new Error("yahoo unavailable");
    });

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({}, failingFetch, noMetadata);

    expect(result.status).toBe("degraded");
    expect(result.unresolved.missing).toHaveLength(1);
    expect(result.unresolved.missing[0].ticker).toBe("AAPL");
    expect(result.unresolved.missing[0].issues[0]).toContain("missing_dates");
    expect(result.unresolved.stale).toEqual([]);
    expect(result.rows_loaded).toBe(0);
    expect(result.rows_per_ticker["AAPL"]).toBe(0);
  });

  test("full repair succeeds, coverage complete -> status 'ok', unresolved empty", async () => {
    mockQuery.mockReset();
    mockQuerySingle.mockReset();

    // getDateRange
    mockQuerySingle.mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    // getRequiredTickers -> AAPL
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    // upsertPrices (1 row)
    mockQuery.mockResolvedValueOnce([]);
    // recordRepair(success)
    mockQuery.mockResolvedValueOnce([]);
    // markRefreshSuccess:
    //   refresh_log insert
    mockQuery.mockResolvedValueOnce([]);
    //   service_state upsert
    mockQuery.mockResolvedValueOnce([]);
    //   service_state update prices_need_fetch
    mockQuery.mockResolvedValueOnce([]);
    // verifyPrices:
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 1,
      min_date: "2026-01-15",
      max_date: "2026-01-15",
    });
    // distinct tickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    // required tickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL", ticker_category: "asset" }]);
    // checkpoints (empty -> no coverage issues)
    mockQuery.mockResolvedValueOnce([]);
    // needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const okFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "AAPL", date: "2026-01-15", price: 200 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({}, okFetch, noMetadata);

    expect(result.status).toBe("ok");
    expect(result.unresolved.missing).toEqual([]);
    expect(result.unresolved.stale).toEqual([]);
    expect(result.rows_loaded).toBe(1);
    expect(result.rows_per_ticker["AAPL"]).toBe(1);
  });

  test("explicit --ticker subset skips coverage check -> status 'ok', unresolved empty", async () => {
    mockQuery.mockReset();
    mockQuerySingle.mockReset();

    // getDateRange
    mockQuerySingle.mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    // upsertPrices (1 row)
    mockQuery.mockResolvedValueOnce([]);
    // recordRepair(success)
    mockQuery.mockResolvedValueOnce([]);

    const okFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "SPY", date: "2026-01-15", price: 500 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({ tickers: ["SPY"] }, okFetch, noMetadata);

    expect(result.status).toBe("ok");
    expect(result.unresolved).toEqual({ missing: [], stale: [] });
    // verifyPrices is NOT called for subset repairs
    expect(mockQuerySingle).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
