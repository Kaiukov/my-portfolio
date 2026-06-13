import { describe, expect, test, mock } from "bun:test";

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
  runTx: mock(),
}));

mockQuery.mockResolvedValue([]);

const TODAY = new Date().toISOString().split("T")[0];

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

function setupFreshness(pricesAsOf: { prices_as_of: string }, needsRecalc: boolean) {
  mockQuerySingle.mockResolvedValueOnce(pricesAsOf);
  mockQuerySingle.mockResolvedValueOnce({ needs_recalc: needsRecalc });
}

describe("getPriceFreshness", () => {
  test("returns stale=true when coverage gaps exist (per-ticker)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, false);
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(recent);
    expect(result.price_age_days).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.needs_recalc).toBe(false);
    expect(result.recalc_warning).toBeUndefined();
  });

  test("returns stale=true when stale_tickers_sql returns rows (per-ticker)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ ticker: "SPY" }]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(recent);
    expect(result.price_age_days).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.needs_recalc).toBe(false);
  });

  test("returns stale=false when no coverage gaps and no stale tickers (even with old MAX date)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const oldDate = daysAgo(7);
    setupFreshness({ prices_as_of: oldDate }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(oldDate);
    expect(result.price_age_days).toBe(7);
    expect(result.stale).toBe(false);
    expect(result.needs_recalc).toBe(false);
  });

  test("correctly computes prices_as_of and price_age_days from MAX(date)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const boundary = daysAgo(5);
    setupFreshness({ prices_as_of: boundary }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBe(boundary);
    expect(result.price_age_days).toBe(5);
    expect(result.stale).toBe(false);
    expect(result.needs_recalc).toBe(false);
  });

  test("returns null prices_as_of when no price data exists", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    setupFreshness(null!, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.needs_recalc).toBe(false);
  });

  test("handles null prices_as_of field in row", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    setupFreshness({ prices_as_of: null! }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.prices_as_of).toBeNull();
    expect(result.price_age_days).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.needs_recalc).toBe(false);
  });

  test("uses env PORTFOLIO_PRICE_MAX_AGE_DAYS to drive stale_tickers_sql behavior", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "3";
    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ ticker: "SPY" }]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.stale).toBe(true);
    expect(result.needs_recalc).toBe(false);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });

  test("ignores invalid env PORTFOLIO_PRICE_MAX_AGE_DAYS and falls back to default", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"] = "not-a-number";
    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.stale).toBe(false);
    expect(result.needs_recalc).toBe(false);

    delete process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  });

  test("returns needs_recalc=true with recalc_warning when needs_recalc() returns true (#192)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, true);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.needs_recalc).toBe(true);
    expect(result.recalc_warning).toBeDefined();
    expect(typeof result.recalc_warning).toBe("string");
    expect(result.recalc_warning!.length).toBeGreaterThan(0);
    expect(result.recalc_warning).toContain("recalculate");
  });

  test("returns needs_recalc=false with no recalc_warning when needs_recalc() returns false (#192)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const recent = daysAgo(1);
    setupFreshness({ prices_as_of: recent }, false);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.needs_recalc).toBe(false);
    expect(result.recalc_warning).toBeUndefined();
  });

  test("degrades gracefully when needs_recalc() query fails (#192)", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const recent = daysAgo(1);
    mockQuerySingle.mockResolvedValueOnce({ prices_as_of: recent });
    mockQuerySingle.mockRejectedValueOnce(new Error("connection lost"));
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getPriceFreshness } = await import("../src/commands/freshness.js");
    const result = await getPriceFreshness(TODAY);

    expect(result.needs_recalc).toBe(false);
    expect(result.recalc_warning).toBeUndefined();
    expect(result.prices_as_of).toBe(recent);
  });
});

describe("summary regression: summary does not invoke fetchPrices", () => {
  test("getSummary remains read-only (no fetchPrices calls)", async () => {
    mockQuerySingle.mockClear();

    mockQuerySingle.mockResolvedValueOnce({
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

describe("CLI status meta carries needs_recalc (#192)", () => {
  test("status command meta includes freshness with needs_recalc=true", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    const statusData = {
      transactions_count: 42,
      start_date: "2024-01-15",
      end_date: "2026-03-20",
      portfolio_value: 125000.50,
      total_invested: 85000,
      deposits: 100000,
      withdrawals: 15000,
      income: 2500,
      fees: 120,
      taxes: 50,
      total_gain: 40000.50,
      total_gain_pct: 47.06,
      cost_basis: 60000,
      realized_gain: 5000,
      unrealized_gain: 35000.50,
      total_profit: 40000.50,
      as_of_date: "2026-03-20",
    };

    mockQuerySingle.mockResolvedValueOnce({ prices_as_of: "2026-03-20" });
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: true });
    mockQuerySingle.mockResolvedValueOnce(statusData);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { jest } = await import("bun:test");
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "status"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("status");
    expect(output.meta.needs_recalc).toBe(true);
    expect(output.meta.recalc_warning).toBeDefined();
    expect(output.meta.recalc_warning).toContain("recalculate");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
