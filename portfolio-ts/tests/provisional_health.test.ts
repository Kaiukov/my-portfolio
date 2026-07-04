import { describe, expect, test, mock } from "bun:test";

const TODAY = new Date().toISOString().split("T")[0];
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split("T")[0];

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

// Reset all mocks between tests so mockResolvedValueOnce queues don't bleed.
// (bun:test doesn't have a global beforeEach reset for module-level mocks,
// so we call .mockReset() inside each test's setup.)

describe("health: current-day missing vs historical missing (KAI-18)", () => {
  test("status is 'provisional' when only today's prices are missing", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false }); // needs_recalc
    mockQuery.mockResolvedValueOnce([]); // service_state
    // coverage checkpoints: 2 tickers missing today only
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", checkpoint_date: TODAY },
      { ticker: "SGOV", checkpoint_date: TODAY },
    ]);
    // stale_tickers_sql — not called (no maxAgeDays)

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result.status).toBe("provisional");
    expect(result.current_day_missing_tickers).toEqual(["SCHD", "SGOV"]);
    expect(result.coverage_issue_tickers).toEqual(["SCHD", "SGOV"]);
    expect(result.stale_tickers).toEqual([]);
    expect(result.provisional_warning).toContain("current-day quotes");
    expect(result.needs_recalc).toBe(false);
  });

  test("status is 'degraded' when historical prices are missing", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]); // service_state
    // One historical missing, one current-day missing
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", checkpoint_date: YESTERDAY },
      { ticker: "SGOV", checkpoint_date: TODAY },
    ]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result.status).toBe("degraded");
    expect(result.current_day_missing_tickers).toEqual(["SGOV"]);
    expect(result.coverage_issue_tickers).toEqual(["SCHD", "SGOV"]);
    expect(result.provisional_warning).toBeNull();
  });

  test("status is 'ok' when no coverage issues at all", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]); // service_state
    mockQuery.mockResolvedValueOnce([]); // no missing checkpoints

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result.status).toBe("ok");
    expect(result.current_day_missing_tickers).toEqual([]);
    expect(result.provisional_warning).toBeNull();
  });

  test("status is 'degraded' when needs_recalc is true even if only today missing", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: true });
    mockQuery.mockResolvedValueOnce([]); // service_state
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", checkpoint_date: TODAY },
    ]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result.status).toBe("degraded");
    expect(result.needs_recalc).toBe(true);
  });

  test("status is 'degraded' when stale tickers exist alongside today-only missing", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]); // service_state
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", checkpoint_date: TODAY },
    ]);
    // stale_tickers_sql(30) returns MSFT
    mockQuery.mockResolvedValueOnce([
      { ticker: "MSFT", last_price_date: "2026-01-01", age_days: 180 },
    ]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(30);

    expect(result.status).toBe("degraded");
    expect(result.stale_price_tickers).toHaveLength(1);
  });
});

describe("verify_prices: separates historical vs current-day missing (KAI-18)", () => {
  test("splits coverage_issues into historical and current_day arrays", async () => {
    // price stats
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 100,
      min_date: "2025-01-01",
      max_date: YESTERDAY,
    });
    // distinct tickers
    mockQuery.mockResolvedValueOnce([{ ticker: "SCHD" }, { ticker: "SGOV" }]);
    // required tickers
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", ticker_category: "asset" },
      { ticker: "SGOV", ticker_category: "asset" },
    ]);
    // checkpoints: SCHD missing today, SGOV missing yesterday+today
    mockQuery.mockResolvedValueOnce([
      { ticker: "SCHD", checkpoint_date: TODAY },
      { ticker: "SGOV", checkpoint_date: YESTERDAY },
      { ticker: "SGOV", checkpoint_date: TODAY },
    ]);
    // missing for SCHD (today)
    mockQuery.mockResolvedValueOnce([{ d: TODAY }]);
    // missing for SGOV (yesterday + today)
    mockQuery.mockResolvedValueOnce([{ d: YESTERDAY }, { d: TODAY }]);
    // needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices(undefined);

    expect(result.coverage_issues).toHaveLength(2); // backward compat: all issues
    expect(result.historical_coverage_issues).toHaveLength(1); // SGOV yesterday
    expect(result.historical_coverage_issues[0].ticker).toBe("SGOV");
    expect(result.current_day_missing).toHaveLength(2); // SCHD + SGOV today
    expect(result.current_day_missing.map((c) => c.ticker)).toEqual(
      expect.arrayContaining(["SCHD", "SGOV"]),
    );
    expect(result.needs_recalc).toBe(false);
  });

  test("all current-day only: historical_coverage_issues is empty", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 100,
      min_date: "2025-01-01",
      max_date: TODAY,
    });
    mockQuery.mockResolvedValueOnce([{ ticker: "QQQ" }]);
    mockQuery.mockResolvedValueOnce([
      { ticker: "QQQ", ticker_category: "asset" },
    ]);
    mockQuery.mockResolvedValueOnce([
      { ticker: "QQQ", checkpoint_date: TODAY },
    ]);
    // missing for QQQ (today only)
    mockQuery.mockResolvedValueOnce([{ d: TODAY }]);
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices(undefined);

    expect(result.historical_coverage_issues).toHaveLength(0);
    expect(result.current_day_missing).toHaveLength(1);
    expect(result.current_day_missing[0].ticker).toBe("QQQ");
  });
});
