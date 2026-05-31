import { describe, expect, test, mock } from "bun:test";
import { ValidationError, STALE_MAX_AGE_DAYS } from "../src/validators.js";

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

describe("recalculateDryRun", () => {
  test("returns dry_run state without executing SQL", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ force: false });
    expect(result.dry_run).toBe(true);
    expect(result.from_date).toBe("beginning");
    expect(result.forced).toBe(false);
    expect(result.needs_recalc).toBe(true);
  });

  test("parses DD-MM-YYYY from-date (legacy)", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ fromDateStr: "15-01-2026", force: true });
    expect(result.from_date).toBe("2026-01-15");
    expect(result.forced).toBe(true);
  });

  test("accepts ISO YYYY-MM-DD from-date", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ fromDateStr: "2026-01-15", force: true });
    expect(result.from_date).toBe("2026-01-15");
    expect(result.forced).toBe(true);
  });

  test("throws on invalid date format", async () => {
    mockQuery.mockResolvedValue([]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    await expect(
      recalculateDryRun({ fromDateStr: "15/01/2026", force: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("reports stale prices when required tickers have no recent price", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([{ ticker: "AAPL" }, { ticker: "EURUSD=X" }]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ force: false, maxAgeDays: 3 });
    expect(result.prices_stale).toBe(true);
    expect(result.stale_tickers).toContain("AAPL");
    expect(result.stale_tickers).toContain("EURUSD=X");
  });

  test("reports clean prices when all tickers are fresh", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([]);
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ force: false });
    expect(result.prices_stale).toBe(false);
    expect(result.stale_tickers).toEqual([]);
  });
});

describe("checkPricesStale", () => {
  test("returns stale=true with tickers when prices are missing", async () => {
    mockQuery.mockResolvedValue([{ ticker: "SPY" }]);
    const { checkPricesStale } = await import("../src/commands/recalculate.js");
    const result = await checkPricesStale(3);
    expect(result.stale).toBe(true);
    expect(result.tickers).toEqual(["SPY"]);
  });

  test("returns stale=false with empty tickers when all prices are fresh", async () => {
    mockQuery.mockResolvedValue([]);
    const { checkPricesStale } = await import("../src/commands/recalculate.js");
    const result = await checkPricesStale(3);
    expect(result.stale).toBe(false);
    expect(result.tickers).toEqual([]);
  });

  test("uses default STALE_MAX_AGE_DAYS when no maxAgeDays provided", async () => {
    mockQuery.mockResolvedValue([]);
    const { checkPricesStale } = await import("../src/commands/recalculate.js");
    await checkPricesStale();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [STALE_MAX_AGE_DAYS]);
  });
});

describe("recalculate", () => {
  test("calls refresh_daily_returns_sql and returns rows_affected", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery
      .mockResolvedValueOnce([]) // checkPricesStale
      .mockResolvedValue([{ refresh_daily_returns_sql: 42 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: false });
    expect(result.rows_affected).toBe(42);
    expect(result.recalc_type).toBe("full");
    expect(result.from_date).toBeNull();
  });

  test("skips recalc when not needed", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: false });
    expect(result.rows_affected).toBe(0);
  });

  test("force=true bypasses needs_recalc check and stale check", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([{ refresh_daily_returns_sql: 42 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: true });
    expect(result.rows_affected).toBe(42);
  });

  test("blocks recalc when prices are stale and not forced", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([{ ticker: "AAPL" }]); // stale
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: false, maxAgeDays: 3 });
    expect(result.rows_affected).toBe(0);
    expect(result.prices_stale).toBe(true);
    expect(result.stale_tickers).toEqual(["AAPL"]);
  });

  test("force=true bypasses stale price check and runs recalc", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([{ refresh_daily_returns_sql: 99 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: true, maxAgeDays: 3 });
    expect(result.rows_affected).toBe(99);
    expect(result.prices_stale).toBeUndefined();
  });

  test("partial recalc when from_date provided", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery
      .mockResolvedValueOnce([]) // checkPricesStale
      .mockResolvedValue([{ refresh_daily_returns_sql: 10 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ fromDateStr: "01-01-2026", force: false });
    expect(result.recalc_type).toBe("partial");
    expect(result.from_date).toBe("2026-01-01");
  });
});
