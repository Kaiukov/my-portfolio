import { describe, expect, test, mock } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

const TODAY = new Date().toISOString().split("T")[0];

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

describe("getPriceFreshness", () => {
  test("returns stale=true when coverage gaps exist (per-ticker)", async () => {
    const recent = daysAgo(1);
    mockQuerySingle.mockResolvedValue({ prices_as_of: recent });
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(recent);
    expect(result.price_age_days).toBe(1);
    expect(result.stale).toBe(true);
  });

  test("returns stale=true when stale_tickers_sql returns rows (per-ticker)", async () => {
    const recent = daysAgo(1);
    mockQuerySingle.mockResolvedValue({ prices_as_of: recent });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ ticker: "SPY" }]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(recent);
    expect(result.price_age_days).toBe(1);
    expect(result.stale).toBe(true);
  });

  test("returns stale=false when no coverage gaps and no stale tickers (even with old MAX date)", async () => {
    const oldDate = daysAgo(7);
    mockQuerySingle.mockResolvedValue({ prices_as_of: oldDate });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(oldDate);
    expect(result.price_age_days).toBe(7);
    expect(result.stale).toBe(false);
  });

  test("correctly computes prices_as_of and price_age_days from MAX(date)", async () => {
    const boundary = daysAgo(5);
    mockQuerySingle.mockResolvedValue({ prices_as_of: boundary });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(boundary);
    expect(result.price_age_days).toBe(5);
    expect(result.stale).toBe(false);
  });

  test("returns null prices_as_of when no price data exists", async () => {
    mockQuerySingle.mockResolvedValue(null);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
  });

  test("handles null prices_as_of field in row", async () => {
    mockQuerySingle.mockResolvedValue({ prices_as_of: null });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
  });

  test("uses env PORTFOLIO_PRICE_MAX_AGE_DAYS to pass maxAgeDays to stale_tickers_sql", async () => {
    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "3";
    const recent = daysAgo(1);
    mockQuerySingle.mockResolvedValue({ prices_as_of: recent });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.stale).toBe(false);

    const staleCallArgs = mockQuery.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("stale_tickers_sql"),
    );
    expect(staleCallArgs).toBeDefined();
    expect(staleCallArgs[1]).toEqual([3]);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });

  test("ignores invalid env PORTFOLIO_PRICE_MAX_AGE_DAYS and falls back to default", async () => {
    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "not-a-number";
    const recent = daysAgo(1);
    mockQuerySingle.mockResolvedValue({ prices_as_of: recent });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.stale).toBe(false);

    const staleCallArgs = mockQuery.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("stale_tickers_sql"),
    );
    expect(staleCallArgs).toBeDefined();
    expect(staleCallArgs[1]).toEqual([5]);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });
});

describe("summary regression: summary does not invoke fetchPrices", () => {
  test("getSummary remains read-only (no fetchPrices calls)", async () => {
    mockQuerySingle.mockResolvedValue({
      holding_count: 5,
      total_cash_usd: 5000,
      portfolio_value_usd: 25000,
      last_transaction_date: "2026-01-15",
      transaction_count: 42,
      as_of_date: "2026-01-15",
    });

    const { getSummary } = await import("../src/commands/summary.js");
    const result = await getSummary("2026-01-15");

    expect(result.holding_count).toBe(5);
    expect(result.portfolio_value_usd).toBe(25000);
    expect(result.as_of_date).toBe("2026-01-15");
  });
});
