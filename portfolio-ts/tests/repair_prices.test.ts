import { describe, expect, test, mock } from "bun:test";
import type { PriceRow } from "../src/providers/yahoo.js";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.ts", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  runTx: mock(),
  connect: () => {},
  close: () => {},
}));

describe("repairPricesDryRun", () => {
  test("returns list of tickers that would be repaired", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-03-01" });
    mockQuery.mockResolvedValue([{ ticker: "AAPL" }, { ticker: "MSFT" }]);

    const { repairPricesDryRun } = await import("../src/commands/repair_prices.js");
    const result = await repairPricesDryRun({});
    expect(result.dry_run).toBe(true);
    expect(result.would_repair).toContain("AAPL");
    expect(result.range.start).toBe("2026-01-01");
  });

  test("uses explicit ticker list when provided", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-03-01" });
    mockQuery.mockResolvedValue([]);

    const { repairPricesDryRun } = await import("../src/commands/repair_prices.js");
    const result = await repairPricesDryRun({ tickers: ["SPY"] });
    expect(result.would_repair).toEqual(["SPY"]);
  });
});

describe("repairPrices", () => {
  test("calls fetch function per ticker and upserts prices", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery
      .mockResolvedValueOnce([{ ticker: "AAPL" }]) // discover tickers
      .mockResolvedValue([]); // upsert calls

    const fakeFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "AAPL", date: "2026-01-15", price: 200 },
      { ticker: "AAPL", date: "2026-01-16", price: 201 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({}, fakeFetch);

    expect(result.tickers).toEqual(["AAPL"]);
    expect(result.rows_loaded).toBe(2);
    expect(result.rows_per_ticker["AAPL"]).toBe(2);
    expect(fakeFetch).toHaveBeenCalledWith("AAPL", "2026-01-01", expect.any(String));
  });

  test("uses explicit tickers when provided", async () => {
    mockQuerySingle.mockResolvedValue({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery.mockResolvedValue([]);

    const fakeFetch = mock(async (): Promise<PriceRow[]> => [
      { ticker: "SPY", date: "2026-01-15", price: 500 },
    ]);

    const { repairPrices } = await import("../src/commands/repair_prices.js");
    const result = await repairPrices({ tickers: ["SPY"] }, fakeFetch);

    expect(result.tickers).toEqual(["SPY"]);
    expect(fakeFetch).toHaveBeenCalledWith("SPY", expect.any(String), expect.any(String));
  });
});
