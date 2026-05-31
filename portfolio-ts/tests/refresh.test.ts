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
  test("composes repairPrices + getSummary + has correct shape", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery
      .mockResolvedValueOnce([{ ticker: "AAPL" }])
      .mockResolvedValue([]);
    mockQuerySingle
      .mockResolvedValueOnce(makeSummaryRow());

    const { refreshPortfolio } = await import("../src/commands/refresh.js");
    const result = await refreshPortfolio();

    expect(result).toHaveProperty("refreshed");
    expect(result).toHaveProperty("summary");
    expect(result.refreshed.tickers).toEqual(["AAPL"]);
    expect(result.refreshed.rows_loaded).toBe(1);
    expect(result.summary.holding_count).toBe(5);
    expect(result.summary.portfolio_value_usd).toBe(25000);
  });
});

describe("refresh CLI dispatch", () => {
  test("dispatches refresh and returns success envelope", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ start_date: "2026-01-01", end_date: "2026-01-31" });
    mockQuery
      .mockResolvedValueOnce([{ ticker: "AAPL" }])
      .mockResolvedValue([]);
    mockQuerySingle
      .mockResolvedValueOnce(makeSummaryRow());
    mockQuerySingle
      .mockResolvedValueOnce({ prices_as_of: TODAY });

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
    expect(output.data.refreshed.tickers).toEqual(["AAPL"]);
    expect(output.data.summary.holding_count).toBe(5);
    expect(output.meta.prices_as_of).toBe(TODAY);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
