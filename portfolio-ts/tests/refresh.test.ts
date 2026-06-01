import { describe, expect, test, mock, jest } from "bun:test";
import type { PriceRow } from "../src/providers/yahoo.js";

const TODAY = new Date().toISOString().split("T")[0];

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

mock.module("../src/providers/yahoo.js", () => ({
  fetchPrices: mock(async (_: string, __: string, ___: string): Promise<PriceRow[]> => [
    { ticker: "AAPL", date: "2026-01-15", price: 200 },
  ]),
}));

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    holding_count: 5,
    total_cash_usd: 5000,
    portfolio_value_usd: 25000,
    last_transaction_date: "2026-01-15",
    transaction_count: 42,
    as_of_date: "2026-01-15",
    ...overrides,
  };
}

describe("refreshPortfolio service", () => {
  test("composes repairPrices + recalculate + getSummary + has correct shape", async () => {
    // getDateRange
    mockQuerySingle.mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    // getRequiredTickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    // upsertPrices / recordRepair / markRefreshSuccess (refresh_log + service_state x2)
    mockQuery.mockResolvedValue([]);
    // verifyPrices: price stats
    mockQuerySingle.mockResolvedValueOnce({ total_rows: 1, min_date: "2026-01-15", max_date: "2026-01-15" });
    // verifyPrices: distinct tickers, required tickers, checkpoints
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    // verifyPrices: needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    // recalculate: refresh_daily_returns_sql + insert logs
    mockQuery.mockResolvedValueOnce([{ refresh_daily_returns_sql: 10 }]);
    mockQuery.mockResolvedValue([]);
    // getSummary
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());

    const { refreshPortfolio } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolio();

    expect(result).toHaveProperty("refreshed");
    expect(result).toHaveProperty("recalculated");
    expect(result).toHaveProperty("summary");
    expect(result.recalculated).toBe(true);
    expect(result.refreshed.tickers).toEqual(["AAPL"]);
    expect(result.refreshed.rows_loaded).toBe(1);
    expect(result.summary.holding_count).toBe(5);
    expect(result.summary.portfolio_value_usd).toBe(25000);
  });
});

describe("refreshPortfolioDryRun service", () => {
  test("composes repairPricesDryRun + getSummary + has correct shape", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery
      .mockResolvedValueOnce([{ ticker: "AAPL" }]); // getRequiredTickers
    mockQuerySingle
      .mockResolvedValueOnce(makeSummaryRow());

    const { refreshPortfolioDryRun } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolioDryRun();

    expect(result).toHaveProperty("dry_run");
    expect(result).toHaveProperty("refreshed");
    expect(result).toHaveProperty("recalculated");
    expect(result).toHaveProperty("summary");
    expect(result.dry_run).toBe(true);
    expect(result.recalculated).toBe(false);
    expect(result.refreshed.would_repair).toEqual(["AAPL"]);
    expect(result.summary.holding_count).toBe(5);
    expect(result.summary.portfolio_value_usd).toBe(25000);
  });
});

describe("refresh CLI dispatch", () => {
  test("dispatches refresh and returns success envelope", async () => {
    // getDateRange
    mockQuerySingle.mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    // getRequiredTickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    // upsertPrices / recordRepair / markRefreshSuccess
    mockQuery.mockResolvedValue([]);
    // verifyPrices: price stats
    mockQuerySingle.mockResolvedValueOnce({ total_rows: 1, min_date: "2026-01-15", max_date: "2026-01-15" });
    // verifyPrices: distinct, required, checkpoints
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    // verifyPrices: needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    // recalculate: refresh_daily_returns_sql + insert logs
    mockQuery.mockResolvedValueOnce([{ refresh_daily_returns_sql: 10 }]);
    mockQuery.mockResolvedValue([]);
    // getSummary
    mockQuerySingle.mockResolvedValueOnce(makeSummaryRow());
    // getPriceFreshness
    mockQuerySingle.mockResolvedValueOnce({ prices_as_of: TODAY });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "refresh"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("refresh");
    expect(output.data.refreshed).toBeDefined();
    expect(output.data.summary).toBeDefined();
    expect(output.data.recalculated).toBe(true);
    expect(output.data.refreshed.tickers).toEqual(["AAPL"]);
    expect(output.data.summary.holding_count).toBe(5);
    expect(output.meta.prices_as_of).toBe(TODAY);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches refresh --dry-run and returns preview", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery
      .mockResolvedValueOnce([{ ticker: "AAPL" }]);
    mockQuerySingle
      .mockResolvedValueOnce(makeSummaryRow());
    mockQuerySingle
      .mockResolvedValueOnce({ prices_as_of: TODAY });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "refresh", "--dry-run"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("refresh");
    expect(output.data.dry_run).toBe(true);
    expect(output.data.recalculated).toBe(false);
    expect(output.data.refreshed.would_repair).toEqual(["AAPL"]);
    expect(output.data.summary).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
