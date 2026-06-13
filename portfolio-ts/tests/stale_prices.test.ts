import { describe, expect, test, mock } from "bun:test";

const TODAY = "2026-05-31";
const NINETY_DAYS_AGO = "2026-03-02";

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

describe("health staleness via stale_tickers_sql", () => {
  test("with max-age: reports stale ticker from SQL, no TS math", async () => {
    // needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    // service_state
    mockQuery.mockResolvedValueOnce([]);
    // coverage checkpoints (empty = no coverage issues)
    mockQuery.mockResolvedValueOnce([]);
    // stale_tickers_sql(30) returns MSFT (90 days old)
    mockQuery.mockResolvedValueOnce([
      { ticker: "MSFT", last_price_date: NINETY_DAYS_AGO, age_days: 90 },
    ]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(30);

    expect(result.stale_price_tickers).toHaveLength(1);
    expect(result.stale_price_tickers[0]).toEqual({
      ticker: "MSFT",
      last_price_date: NINETY_DAYS_AGO,
      age_days: 90,
    });
    expect(result.stale_tickers).toContain("MSFT");
    expect(result.status).toBe("degraded");
  });

  test("without max-age: no stale tickers (backward compat)", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result.stale_price_tickers).toHaveLength(0);
    expect(result.stale_tickers).toHaveLength(0);
    expect(result.status).toBe("ok");
  });

  test("with max-age 0: skipped (no staleness check)", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(0);

    expect(result.stale_price_tickers).toHaveLength(0);
  });

  test("health outputs JSON with stale ticker info (CLI snapshot)", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([
      {
        state_key: "last_successful_price_refresh",
        state_value: "2026-05-30T12:00:00Z",
      },
      { state_key: "last_successful_recalc", state_value: "2026-05-30T12:00:00Z" },
    ]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([
      { ticker: "MSFT", last_price_date: NINETY_DAYS_AGO, age_days: 90 },
    ]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(30);

    expect(result.status).toBe("degraded");
    expect(result.stale_price_tickers[0].ticker).toBe("MSFT");
    expect(result.stale_price_tickers[0].age_days).toBe(90);
    expect(result.last_successful_price_refresh).toBe("2026-05-30T12:00:00Z");
  });
});

describe("verify_prices staleness via stale_tickers_sql", () => {
  test("with max-age: reports stale ticker from SQL, no TS math", async () => {
    // price stats
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 100,
      min_date: "2025-01-01",
      max_date: NINETY_DAYS_AGO,
    });
    // distinct tickers
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }, { ticker: "MSFT" }]);
    // required tickers
    mockQuery.mockResolvedValueOnce([
      { ticker: "AAPL", ticker_category: "asset" },
      { ticker: "MSFT", ticker_category: "asset" },
    ]);
    // checkpoints (empty = no coverage issues)
    mockQuery.mockResolvedValueOnce([]);
    // stale_tickers_sql(30) returns MSFT
    mockQuery.mockResolvedValueOnce([
      { ticker: "MSFT", last_price_date: NINETY_DAYS_AGO, age_days: 90 },
    ]);
    // needs_recalc
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices(30);

    expect(result.stale_tickers).toHaveLength(1);
    expect(result.stale_tickers[0]).toEqual({
      ticker: "MSFT",
      last_price_date: NINETY_DAYS_AGO,
      age_days: 90,
    });
  });

  test("without max-age: no stale tickers (backward compat)", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 100,
      min_date: "2025-01-01",
      max_date: TODAY,
    });
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL", ticker_category: "asset" }]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices(undefined);

    expect(result.stale_tickers).toHaveLength(0);
  });
});

describe("regression: price_asof_sql backward compat", () => {
  test("health without max-age has same structure as before", async () => {
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const { getHealth } = await import("../src/commands/health.js");
    const result = await getHealth(undefined);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("db_reachable", true);
    expect(result).toHaveProperty("needs_recalc", false);
    expect(result).toHaveProperty("price_coverage_issues");
    expect(result).toHaveProperty("coverage_issue_tickers");
    expect(result).toHaveProperty("stale_price_tickers");
    expect(result).toHaveProperty("stale_tickers");
    expect(result).toHaveProperty("last_successful_price_refresh");
    expect(result).toHaveProperty("last_successful_recalc");
  });

  test("verify_prices without max-age has same structure as before", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      total_rows: 100,
      min_date: "2025-01-01",
      max_date: TODAY,
    });
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL" }]);
    mockQuery.mockResolvedValueOnce([{ ticker: "AAPL", ticker_category: "asset" }]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { verifyPrices } = await import("../src/commands/verify_prices.js");
    const result = await verifyPrices(undefined);

    expect(result).toHaveProperty("total_rows");
    expect(result).toHaveProperty("unique_tickers");
    expect(result).toHaveProperty("date_range");
    expect(result).toHaveProperty("required_tickers");
    expect(result).toHaveProperty("coverage_issues");
    expect(result).toHaveProperty("stale_tickers");
    expect(result).toHaveProperty("needs_recalc");
    expect(result.stale_tickers).toHaveLength(0);
  });
});
